#ifndef SOCKET_CLIENT_H
#define SOCKET_CLIENT_H

#include <string>
#include <mutex>
#include <condition_variable>
#include <deque>
#include <thread>
#include <atomic>
#include <memory>
#include <functional>

namespace network_agent {

class SocketClient {
public:
    static SocketClient* getInstance();

    // 非阻塞入队：OkHttp 拦截器线程调用，立即返回，不阻塞 app 请求
    // 内部由 sender 线程负责实际 send；断连期间消息缓冲，连上后补发
    void sendMessage(const std::string& message);
    void sendHeartbeat();

    // 由 Agent::initialize 启动后台连接+发送线程
    void startBackgroundThreads();
    // 由 Agent::shutdown 停止后台线程
    void stopBackgroundThreads();

    bool isConnected() const { return connected_.load(std::memory_order_acquire); }

    void setHost(const std::string& host) { host_ = host; }
    void setPort(int port) { port_ = port; }
    void setMessageHandler(std::function<void(const std::string&)> handler);

private:
    SocketClient();
    ~SocketClient();

    SocketClient(const SocketClient&) = delete;
    SocketClient& operator=(const SocketClient&) = delete;

    // 阻塞式连接（带 poll 超时），仅 senderLoop 内部调用
    // timeoutMs: 单次 connect 超时，默认 500ms
    bool connectInternal(const std::string& host, int port, int timeoutMs = 500);
    void disconnectInternal();

    // 后台线程入口：负责连接维护 + 队列消息发送
    void senderLoop();
    void readerLoop();

    // 配置
    std::string host_ = "127.0.0.1";
    int port_ = 6200;

    // 连接状态：仅 senderLoop 线程读写 socket_fd_；
    // connected_ 用 atomic 供外部 isConnected() 查询
    int socket_fd_ = -1;
    std::atomic<bool> connected_{false};
    std::mutex conn_mutex_;
    std::function<void(const std::string&)> message_handler_;

    // 消息队列：sendMessage 入队，senderLoop 出队发送
    std::mutex queue_mutex_;
    std::condition_variable queue_cv_;
    std::deque<std::string> message_queue_;
    static constexpr size_t MAX_QUEUE_SIZE = 200;
    std::atomic<bool> dropping_{false};  // 队列满时标记，用于日志去重

    // 后台线程控制
    std::atomic<bool> running_{false};
    std::thread sender_thread_;
    std::thread reader_thread_;
};

}

#endif
