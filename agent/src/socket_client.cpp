#include "socket_client.h"

#include <android/log.h>
#include <sys/socket.h>
#include <sys/select.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <arpa/inet.h>
#include <unistd.h>
#include <fcntl.h>
#include <cstring>
#include <cerrno>
#include <poll.h>

#define LOG_TAG "SocketClient"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)
#define LOGD(...) __android_log_print(ANDROID_LOG_DEBUG, LOG_TAG, __VA_ARGS__)
#define LOGW(...) __android_log_print(ANDROID_LOG_WARN, LOG_TAG, __VA_ARGS__)

namespace network_agent {

SocketClient* SocketClient::getInstance() {
    static SocketClient instance;
    return &instance;
}

SocketClient::SocketClient() {}

SocketClient::~SocketClient() {
    stopBackgroundThreads();
}

// ======================================================================
// 连接管理（仅 senderLoop 调用，无需加锁）
// ======================================================================

bool SocketClient::connectInternal(const std::string& host, int port, int timeoutMs) {
    if (connected_.load(std::memory_order_acquire) && socket_fd_ >= 0) {
        return true;
    }

    socket_fd_ = socket(AF_INET, SOCK_STREAM, 0);
    if (socket_fd_ < 0) {
        LOGE("Failed to create socket: %s", strerror(errno));
        return false;
    }

    struct sockaddr_in server_addr;
    memset(&server_addr, 0, sizeof(server_addr));
    server_addr.sin_family = AF_INET;
    server_addr.sin_port = htons(port);

    if (inet_pton(AF_INET, host.c_str(), &server_addr.sin_addr) <= 0) {
        LOGE("Invalid address: %s", host.c_str());
        close(socket_fd_);
        socket_fd_ = -1;
        return false;
    }

    // 设置非阻塞，用 poll 控制连接超时（避免阻塞 socket connect 命中
    // adb reverse 链路抖动时阻塞 20-30s 的内核 TCP 超时）
    int flags = fcntl(socket_fd_, F_GETFL, 0);
    fcntl(socket_fd_, F_SETFL, flags | O_NONBLOCK);

    int rc = ::connect(socket_fd_, (struct sockaddr*)&server_addr, sizeof(server_addr));
    if (rc < 0 && errno != EINPROGRESS) {
        LOGD("connect immediate fail: %s", strerror(errno));
        close(socket_fd_);
        socket_fd_ = -1;
        return false;
    }

    if (rc == 0) {
        // 立即连接成功
        fcntl(socket_fd_, F_SETFL, flags);  // 恢复阻塞模式
    } else {
        // 等待连接完成或超时
        struct pollfd pfd;
        pfd.fd = socket_fd_;
        pfd.events = POLLOUT;
        int prc = poll(&pfd, 1, timeoutMs);
        if (prc <= 0) {
            LOGD("connect timeout after %dms", timeoutMs);
            close(socket_fd_);
            socket_fd_ = -1;
            return false;
        }
        int sockErr = 0;
        socklen_t errLen = sizeof(sockErr);
        if (getsockopt(socket_fd_, SOL_SOCKET, SO_ERROR, &sockErr, &errLen) < 0 || sockErr != 0) {
            LOGD("connect failed: %s", sockErr ? strerror(sockErr) : strerror(errno));
            close(socket_fd_);
            socket_fd_ = -1;
            return false;
        }
        fcntl(socket_fd_, F_SETFL, flags);  // 恢复阻塞模式
    }

    // 连接成功，设置 socket 选项
    int keepalive = 1;
    setsockopt(socket_fd_, SOL_SOCKET, SO_KEEPALIVE, &keepalive, sizeof(keepalive));
    int nodelay = 1;
    setsockopt(socket_fd_, IPPROTO_TCP, TCP_NODELAY, &nodelay, sizeof(nodelay));

    // 发送超时（阻塞 send 时的上限，防止对端窗口满时无限阻塞）
    struct timeval tv;
    tv.tv_sec = 3;
    tv.tv_usec = 0;
    setsockopt(socket_fd_, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));

    connected_.store(true, std::memory_order_release);
    LOGI("Connected to %s:%d", host.c_str(), port);
    return true;
}

void SocketClient::disconnectInternal() {
    std::lock_guard<std::mutex> lock(conn_mutex_);
    if (socket_fd_ >= 0) {
        close(socket_fd_);
        socket_fd_ = -1;
    }
    connected_.store(false, std::memory_order_release);
}

// ======================================================================
// 后台 sender 线程：维护连接 + 发送队列消息
// ======================================================================

void SocketClient::senderLoop() {
    LOGI("senderLoop started");
    int backoffMs = 200;  // 连接失败重试间隔，递增到 1000ms 封顶
    const int maxBackoffMs = 1000;

    while (running_.load(std::memory_order_acquire)) {
        // 1. 确保已连接
        if (!connected_.load(std::memory_order_acquire) || socket_fd_ < 0) {
            if (!connectInternal(host_, port_, 500)) {
                // 连接失败，退避后重试
                struct timespec ts;
                ts.tv_sec = backoffMs / 1000;
                ts.tv_nsec = (backoffMs % 1000) * 1000000L;
                nanosleep(&ts, nullptr);
                if (backoffMs < maxBackoffMs) backoffMs += 200;
                continue;
            }
            // 连上了，重置退避
            backoffMs = 200;
            LOGI("Connection established, flushing pending messages");
        }

        // 2. 从队列取一条消息（等待，直到有消息或要停止）
        std::string msg;
        {
            std::unique_lock<std::mutex> lock(queue_mutex_);
            queue_cv_.wait(lock, [this] {
                return !running_.load(std::memory_order_acquire)
                    || !connected_.load(std::memory_order_acquire)
                    || !message_queue_.empty();
            });
            if (!running_.load(std::memory_order_acquire)) break;
            // readerLoop 发现旧连接断开后会唤醒这里；下一轮先恢复连接，
            // 不必等到新的 HTTP 消息入队才开始重连。
            if (!connected_.load(std::memory_order_acquire) || message_queue_.empty()) continue;
            msg = std::move(message_queue_.front());
            message_queue_.pop_front();
        }

        // 3. 发送（MSG_NOSIGNAL 防止对端断开时 SIGPIPE 杀死宿主 app）
        std::string msgWithNewline = msg + "\n";
        ssize_t sent = -1;
        {
            std::lock_guard<std::mutex> lock(conn_mutex_);
            if (socket_fd_ >= 0) {
                sent = send(socket_fd_, msgWithNewline.c_str(), msgWithNewline.length(), MSG_NOSIGNAL);
            } else {
                errno = ENOTCONN;
            }
        }
        if (sent < 0) {
            LOGE("send failed: %s — reconnecting", strerror(errno));
            disconnectInternal();
            // 把这条消息放回队首，等重连后补发（不丢）
            {
                std::lock_guard<std::mutex> lock(queue_mutex_);
                message_queue_.push_front(std::move(msg));
            }
            // 立即进入下一轮重连
            continue;
        }
    }

    LOGI("senderLoop exited");
}

void SocketClient::readerLoop() {
    LOGI("readerLoop started");
    std::string pending;
    char buffer[4096];

    while (running_.load(std::memory_order_acquire)) {
        if (!connected_.load(std::memory_order_acquire)) {
            struct timespec ts;
            ts.tv_sec = 0;
            ts.tv_nsec = 100 * 1000000L;
            nanosleep(&ts, nullptr);
            continue;
        }

        int fd = -1;
        {
            std::lock_guard<std::mutex> lock(conn_mutex_);
            fd = socket_fd_;
        }
        if (fd < 0) continue;

        fd_set readSet;
        FD_ZERO(&readSet);
        FD_SET(fd, &readSet);
        struct timeval timeout;
        timeout.tv_sec = 0;
        timeout.tv_usec = 200000;
        int rc = select(fd + 1, &readSet, nullptr, nullptr, &timeout);
        if (rc <= 0) continue;

        ssize_t n = recv(fd, buffer, sizeof(buffer), 0);
        if (n <= 0) {
            if (running_.load(std::memory_order_acquire)) {
                LOGW("recv failed or closed — reconnecting");
                disconnectInternal();
                queue_cv_.notify_one();
            }
            continue;
        }

        pending.append(buffer, n);
        size_t pos;
        while ((pos = pending.find('\n')) != std::string::npos) {
            std::string line = pending.substr(0, pos);
            pending.erase(0, pos + 1);
            if (!line.empty() && line.back() == '\r') line.pop_back();
            if (!line.empty() && message_handler_) {
                message_handler_(line);
            }
        }
    }

    LOGI("readerLoop exited");
}

void SocketClient::startBackgroundThreads() {
    if (running_.load(std::memory_order_acquire)) return;
    running_.store(true, std::memory_order_release);
    sender_thread_ = std::thread(&SocketClient::senderLoop, this);
    reader_thread_ = std::thread(&SocketClient::readerLoop, this);
    LOGI("Background socket threads started");
}

void SocketClient::stopBackgroundThreads() {
    if (!running_.load(std::memory_order_acquire)) return;
    running_.store(false, std::memory_order_release);
    queue_cv_.notify_all();
    if (sender_thread_.joinable()) {
        sender_thread_.join();
    }
    if (reader_thread_.joinable()) {
        reader_thread_.join();
    }
    disconnectInternal();
    LOGI("Background socket threads stopped");
}

void SocketClient::setMessageHandler(std::function<void(const std::string&)> handler) {
    message_handler_ = std::move(handler);
}

// ======================================================================
// 公共 API：入队（非阻塞）
// ======================================================================

void SocketClient::sendMessage(const std::string& message) {
    {
        std::lock_guard<std::mutex> lock(queue_mutex_);
        if (message_queue_.size() >= MAX_QUEUE_SIZE) {
            // 队列满：丢最旧一条腾位置，避免无限增长
            if (!dropping_.exchange(true)) {
                LOGW("Message queue full (%zu), dropping oldest", MAX_QUEUE_SIZE);
            }
            message_queue_.pop_front();
        } else {
            dropping_.store(false, std::memory_order_release);
        }
        message_queue_.push_back(message);
    }
    queue_cv_.notify_one();
}

void SocketClient::sendHeartbeat() {
    sendMessage("{\"type\":\"heartbeat\"}");
}

}
