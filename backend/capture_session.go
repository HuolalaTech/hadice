package backend

import (
	"bufio"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/samber/lo"
)

// NetworkRequest 网络请求数据
type NetworkRequest struct {
	ID              string            `json:"id"`
	Timestamp       int64             `json:"timestamp"`
	Method          string            `json:"method"`
	URL             string            `json:"url"`
	FullURL         string            `json:"fullUrl,omitempty"`
	StatusCode      int               `json:"statusCode,omitempty"`
	RequestHeaders  map[string]string `json:"requestHeaders,omitempty"`
	ResponseHeaders map[string]string `json:"responseHeaders,omitempty"`
	RequestBody     string            `json:"requestBody,omitempty"`
	ResponseBody    string            `json:"responseBody,omitempty"`
	RawData         string            `json:"rawData,omitempty"`
	Direction       string            `json:"direction"` // request, response
	Extra           *HttpExtra        `json:"extra,omitempty"`
	// URL Query Parameters (来自 data.request.params)
	RequestParams map[string]interface{} `json:"requestParams,omitempty"`
	// 请求基础 URL (来自 data.request.baseURL)
	BaseURL string `json:"baseURL,omitempty"`
	// 会话边界标记相关字段
	IsSessionBoundary bool   `json:"isSessionBoundary,omitempty"` // 是否为会话边界标记
	BoundaryType      string `json:"boundaryType,omitempty"`      // 边界类型: "disconnect"
	ClientID          string `json:"clientId,omitempty"`          // 客户端ID
	BoundaryMessage   string `json:"boundaryMessage,omitempty"`   // 边界信息描述
}

// HttpExtra HTTP Extra信息
type HttpExtra struct {
	ID       int    `json:"id"`
	UID      string `json:"uid"`
	ReqTime  int64  `json:"reqTime"`
	RespTime int64  `json:"respTime"`
}

// createSessionBoundaryMarker 创建会话边界标记
func createSessionBoundaryMarker(clientID string, boundaryType string, timestamp int64) NetworkRequest {
	message := fmt.Sprintf("%s客户端已断开连接 (%s)",
		clientID,
		time.UnixMilli(timestamp).Format("15:04:05"))

	return NetworkRequest{
		ID:                fmt.Sprintf("boundary-%s-%d", clientID, timestamp),
		Timestamp:         timestamp,
		Method:            "",
		URL:               "",
		Direction:         "boundary",
		IsSessionBoundary: true,
		BoundaryType:      boundaryType,
		ClientID:          clientID,
		BoundaryMessage:   message,
	}
}

// ClientSession 客户端连接会话
type ClientSession struct {
	Conn              net.Conn
	DeviceID          string
	IsConnected       bool
	LastHeartbeatTime int64
	mu                sync.Mutex
}

// CaptureServer 抓包服务器（新架构：Hadice作为服务器）
type CaptureServer struct {
	DeviceID          string
	LocalPort         int // 本地监听端口
	DevicePort        int // 设备端口（用于rport配置）
	Server            net.Listener
	IsRunning         bool
	Clients           map[string]*ClientSession // 设备ID -> 客户端连接
	PortForward       PortForwardStatus
	HeartbeatTimer    *time.Ticker
	SessionBoundaries []NetworkRequest // 仅存储最近的会话边界标记
	mu                sync.Mutex
}

// CaptureSession 抓包会话（保留旧结构用于兼容）
type CaptureSession struct {
	DeviceID          string
	LocalPort         int // 本地端口
	DevicePort        int // 设备端口
	Socket            net.Conn
	IsCapturing       bool
	PortForward       PortForwardStatus
	Requests          []NetworkRequest
	HeartbeatTimer    *time.Ticker
	ReconnectTimer    *time.Timer
	ReconnectCount    int
	LastHeartbeatTime int64
	mu                sync.Mutex
}

var (
	// captureSessions 存储所有抓包会话（旧架构）
	captureSessions = make(map[string]*CaptureSession)
	captureMutex    sync.RWMutex

	// captureServers 存储所有抓包服务器（新架构）
	captureServers = make(map[string]*CaptureServer)
	serversMutex   sync.RWMutex

	// currentMockConfig 存储当前的 Mock 配置（全局）
	currentMockConfig   map[string]interface{}
	currentMockConfigMu sync.RWMutex
)

// DebugGetServerInfo 用于调试：获取服务器状态信息
func (a *App) DebugGetServerInfo() map[string]interface{} {
	serversMutex.RLock()
	defer serversMutex.RUnlock()

	info := make(map[string]interface{})
	servers := make([]map[string]interface{}, 0)

	for key, server := range captureServers {
		server.mu.Lock()
		servers = append(servers, map[string]interface{}{
			"key":         key,
			"deviceId":    server.DeviceID,
			"localPort":   server.LocalPort,
			"devicePort":  server.DevicePort,
			"isRunning":   server.IsRunning,
			"hasListener": server.Server != nil,
			"clientCount": len(server.Clients),
		})
		server.mu.Unlock()
	}

	info["servers"] = servers
	info["totalServers"] = len(captureServers)

	// 检查端口占用情况
	info["portCheck"] = map[string]interface{}{
		"port6100":  "check with lsof -i :6100",
		"port35201": "check with lsof -i :35201",
	}

	return info
}

// StartCapture 开始抓包
func (a *App) StartCapture(deviceId string, localPort int, devicePort int) (map[string]interface{}, error) {
	// 检查端口转发状态
	portStatusPtr, err := a.CheckPortForwardStatus(localPort, devicePort)
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		}, err
	}

	portStatus := *portStatusPtr

	if !portStatus.Configured {
		// 如果未配置，尝试配置
		newStatus, err := a.ConfigurePortForward(deviceId, localPort, devicePort, "Forward")
		if err != nil {
			return map[string]interface{}{
				"success": false,
				"error":   err.Error(),
			}, err
		}
		if !newStatus.Configured {
			return map[string]interface{}{
				"success": false,
				"error":   newStatus.Error,
			}, nil
		}
		portStatus = *newStatus
	}

	// 生成会话 key: deviceId:localPort
	sessionKey := fmt.Sprintf("%s:%d", deviceId, localPort)

	// 获取或创建会话
	captureMutex.Lock()
	session, ok := captureSessions[sessionKey]
	if !ok {
		session = &CaptureSession{
			DeviceID:    deviceId,
			LocalPort:   localPort,
			DevicePort:  devicePort,
			Socket:      nil,
			IsCapturing: false,
			PortForward: portStatus,
			Requests:    []NetworkRequest{},
		}
		captureSessions[sessionKey] = session
	} else {
		// 如果会话已存在，更新端口信息
		session.LocalPort = localPort
		session.DevicePort = devicePort
		session.PortForward = portStatus
	}
	captureMutex.Unlock()

	// 如果已有连接，先关闭
	session.mu.Lock()
	if session.Socket != nil {
		session.Socket.Close()
		session.Socket = nil
	}
	session.mu.Unlock()

	// 创建 Socket 连接
	log.Printf("[NetworkCapture] 正在连接本地端口: localhost:%d", localPort)
	conn, err := net.Dial("tcp", fmt.Sprintf("localhost:%d", localPort))
	if err != nil {
		log.Printf("[NetworkCapture] 连接失败: %v", err)
		return NewErrorResponseWithMsg(fmt.Sprintf("连接失败: %v", err)), err
	}

	// 设置 TCP 连接选项（保持连接活跃）
	if tcpConn, ok := conn.(*net.TCPConn); ok {
		tcpConn.SetKeepAlive(true)
		tcpConn.SetKeepAlivePeriod(60 * time.Second)
		tcpConn.SetNoDelay(true)
		log.Printf("[NetworkCapture] TCP 连接选项已设置: KeepAlive=true, NoDelay=true")
	}

	log.Printf("[NetworkCapture] Socket 连接成功: %s -> localhost:%d", deviceId, localPort)

	session.mu.Lock()
	session.Socket = conn
	session.IsCapturing = true
	session.PortForward = portStatus
	session.mu.Unlock()

	// 启动心跳定时器
	session.HeartbeatTimer = time.NewTicker(30 * time.Second)
	go func() {
		for range session.HeartbeatTimer.C {
			session.mu.Lock()
			if session.Socket != nil && session.IsCapturing {
				heartbeat := map[string]interface{}{
					"type":      "heartbeat",
					"timestamp": time.Now().UnixMilli(),
				}
				msgBytes, _ := json.Marshal(heartbeat)
				session.Socket.Write(append(msgBytes, '\n'))
				session.LastHeartbeatTime = time.Now().UnixMilli()
			}
			session.mu.Unlock()
		}
	}()

	// 启动读取 goroutine
	go a.readCaptureData(session, sessionKey)

	log.Printf("[NetworkCapture] Capture started: %s (%d -> %d)", sessionKey, localPort, devicePort)

	return NewSimpleSuccessResponse(), nil
}

// StopCapture 停止抓包（停止指定设备的所有端口抓包）
func (a *App) StopCapture(deviceId string) error {
	captureMutex.Lock()
	defer captureMutex.Unlock()

	// 使用lo.FilterKeys找到匹配的会话
	stoppedCount := 0
	for key, session := range captureSessions {
		if session.DeviceID == deviceId {
			session.mu.Lock()
			if session.Socket != nil {
				session.Socket.Close()
				session.Socket = nil
			}

			if session.HeartbeatTimer != nil {
				session.HeartbeatTimer.Stop()
				session.HeartbeatTimer = nil
			}

			if session.ReconnectTimer != nil {
				session.ReconnectTimer.Stop()
				session.ReconnectTimer = nil
			}

			session.IsCapturing = false
			session.mu.Unlock()

			delete(captureSessions, key)
			stoppedCount++
		}
	}

	if stoppedCount == 0 {
		return fmt.Errorf("capture session not found: %s", deviceId)
	}

	log.Printf("[NetworkCapture] Capture stopped: %s (stopped %d sessions)", deviceId, stoppedCount)
	return nil
}

// StopCapturePort 停止指定端口的抓包
func (a *App) StopCapturePort(deviceId string, localPort int) error {
	sessionKey := fmt.Sprintf("%s:%d", deviceId, localPort)
	captureMutex.Lock()
	session, ok := captureSessions[sessionKey]
	captureMutex.Unlock()

	if !ok {
		return fmt.Errorf("capture session not found: %s", sessionKey)
	}

	session.mu.Lock()
	defer session.mu.Unlock()

	if session.Socket != nil {
		session.Socket.Close()
		session.Socket = nil
	}

	if session.HeartbeatTimer != nil {
		session.HeartbeatTimer.Stop()
		session.HeartbeatTimer = nil
	}

	if session.ReconnectTimer != nil {
		session.ReconnectTimer.Stop()
		session.ReconnectTimer = nil
	}

	session.IsCapturing = false

	captureMutex.Lock()
	delete(captureSessions, sessionKey)
	captureMutex.Unlock()

	log.Printf("[NetworkCapture] Capture stopped: %s", sessionKey)
	return nil
}

// GetCaptureStatus 获取抓包状态（返回该设备所有端口的状态）
func (a *App) GetCaptureStatus(deviceId string) (map[string]interface{}, error) {
	captureMutex.RLock()
	defer captureMutex.RUnlock()

	// 使用lo.Filter过滤出匹配设备的会话
	sessions := lo.Filter(lo.Values(captureSessions), func(session *CaptureSession, _ int) bool {
		return session.DeviceID == deviceId
	})

	if len(sessions) == 0 {
		return map[string]interface{}{
			"isCapturing":  false,
			"requestCount": 0,
			"portForward": PortForwardStatus{
				Configured: false,
				Status:     "not_configured",
			},
			"sessions": []map[string]interface{}{},
		}, nil
	}

	totalRequests := 0
	isCapturing := false
	sessionStatuses := []map[string]interface{}{}

	for _, session := range sessions {
		session.mu.Lock()
		totalRequests += len(session.Requests)
		if session.IsCapturing {
			isCapturing = true
		}
		sessionStatuses = append(sessionStatuses, map[string]interface{}{
			"localPort":    session.LocalPort,
			"devicePort":   session.DevicePort,
			"isCapturing":  session.IsCapturing,
			"requestCount": len(session.Requests),
			"portForward":  session.PortForward,
		})
		session.mu.Unlock()
	}

	return map[string]interface{}{
		"isCapturing":  isCapturing,
		"requestCount": totalRequests,
		"sessions":     sessionStatuses,
	}, nil
}

// GetRequests 获取请求列表（合并该设备所有端口的请求）
func (a *App) GetRequests(deviceId string, limit int) ([]NetworkRequest, error) {
	captureMutex.RLock()
	defer captureMutex.RUnlock()

	// 使用lo.Filter和lo.Flatten合并所有请求
	allRequests := lo.Flatten(lo.Map(lo.Filter(lo.Values(captureSessions), func(session *CaptureSession, _ int) bool {
		return session.DeviceID == deviceId
	}), func(session *CaptureSession, _ int) []NetworkRequest {
		session.mu.Lock()
		defer session.mu.Unlock()
		return session.Requests
	}))

	// 按时间戳排序（最新的在前）
	sort.Slice(allRequests, func(i, j int) bool {
		return allRequests[i].Timestamp > allRequests[j].Timestamp
	})

	if limit > 0 && limit < len(allRequests) {
		allRequests = allRequests[:limit]
	}

	return allRequests, nil
}

// ClearRequests 清空请求列表（清空该设备所有端口的请求）
func (a *App) ClearRequests(deviceId string) error {
	captureMutex.RLock()
	defer captureMutex.RUnlock()

	clearedCount := 0
	for _, session := range captureSessions {
		if session.DeviceID == deviceId {
			session.mu.Lock()
			session.Requests = []NetworkRequest{}
			session.mu.Unlock()
			clearedCount++
		}
	}

	if clearedCount == 0 {
		return fmt.Errorf("capture session not found: %s", deviceId)
	}

	log.Printf("[NetworkCapture] Requests cleared: %s (cleared %d sessions)", deviceId, clearedCount)
	return nil
}

// readCaptureData 读取抓包数据
func (a *App) readCaptureData(session *CaptureSession, sessionKey string) {
	log.Printf("[NetworkCapture] 开始读取抓包数据: %s", sessionKey)
	scanner := bufio.NewScanner(session.Socket)
	buffer := ""
	lineCount := 0
	parseSuccessCount := 0
	parseErrorCount := 0

	for scanner.Scan() {
		line := scanner.Text()
		lineCount++
		trimmed := strings.TrimSpace(line)

		if trimmed == "" {
			log.Printf("[NetworkCapture] 收到空行，跳过")
			continue
		}

		log.Printf("[NetworkCapture] 收到数据 (第 %d 行, 长度: %d): %s", lineCount, len(trimmed), func() string {
			if len(trimmed) > 200 {
				return trimmed[:200] + "..."
			}
			return trimmed
		}())

		// 尝试解析 JSON 消息
		var msg map[string]interface{}
		if err := json.Unmarshal([]byte(trimmed), &msg); err != nil {
			log.Printf("[NetworkCapture] JSON 解析失败 (第 %d 行): %v, 原始数据: %s", lineCount, err, trimmed)
			parseErrorCount++
			buffer += line + "\n"
			continue
		}

		log.Printf("[NetworkCapture] JSON 解析成功 (第 %d 行), 消息类型: %v", lineCount, msg["type"])

		// 解析网络请求
		request := parseNetworkRequest(msg)
		if request != nil {
			parseSuccessCount++
			// log.Printf("[NetworkCapture] 成功解析网络请求 (第 %d 个): %s %s", parseSuccessCount, request.Method, request.URL)

			session.mu.Lock()
			session.Requests = append(session.Requests, *request)
			requestCount := len(session.Requests)
			session.mu.Unlock()

			log.Printf("[NetworkCapture] 当前请求总数: %d", requestCount)

			// 发送事件到前端
			if a.app != nil {
				a.app.Event.Emit("networkCapture:requestReceived", map[string]interface{}{
					"deviceId": session.DeviceID,
					"request":  request,
				})
			}
		} else {
			log.Printf("[NetworkCapture] parseNetworkRequest 返回 nil (第 %d 行), 消息类型: %v", lineCount, msg["type"])
			parseErrorCount++
		}

		buffer = ""
	}

	log.Printf("[NetworkCapture] 读取循环结束: 总行数=%d, 解析成功=%d, 解析失败=%d", lineCount, parseSuccessCount, parseErrorCount)

	// 处理错误
	if err := scanner.Err(); err != nil {
		log.Printf("[NetworkCapture] Scanner 错误: %v", err)
		if a.app != nil {
			a.app.Event.Emit("networkCapture:error", map[string]interface{}{
				"deviceId": session.DeviceID,
				"error":    err.Error(),
			})
		}
	}

	// 连接关闭
	session.mu.Lock()
	session.IsCapturing = false
	session.mu.Unlock()

	log.Printf("[NetworkCapture] 连接已关闭: %s", sessionKey)
	if a.app != nil {
		a.app.Event.Emit("networkCapture:closed", map[string]interface{}{
			"deviceId": session.DeviceID,
		})
	}
}

// ==================== 新架构：Hadice作为TCP服务器 ====================

// StartCaptureServer 开始抓包（新架构：Hadice作为服务器）
func (a *App) StartCaptureServer(deviceId string, localPort int, devicePort int) (map[string]interface{}, error) {
	sessionKey := fmt.Sprintf("%s:%d", deviceId, localPort)
	log.Printf("[NetworkCapture] StartCaptureServer called: deviceId=%s, localPort=%d, devicePort=%d", deviceId, localPort, devicePort)

	// 先清理所有可能的旧服务器（防止端口冲突）
	log.Printf("[NetworkCapture] 清理可能存在的旧服务器...")
	serversMutex.Lock()
	for key, server := range captureServers {
		if server.DeviceID == deviceId || server.LocalPort == localPort {
			log.Printf("[NetworkCapture] 发现旧服务器: %s, 正在清理...", key)
			if server.Server != nil {
				server.Server.Close()
			}
			if server.HeartbeatTimer != nil {
				server.HeartbeatTimer.Stop()
			}
			for _, client := range server.Clients {
				if client.Conn != nil {
					client.Conn.Close()
				}
			}
			delete(captureServers, key)
		}
	}
	serversMutex.Unlock()

	// 检查是否已存在服务器
	serversMutex.RLock()
	existingServer, exists := captureServers[sessionKey]
	serversMutex.RUnlock()

	if exists && existingServer.IsRunning {
		log.Printf("[NetworkCapture] 服务器已在运行: %s", sessionKey)
		// 检查端口是否真的在监听
		if existingServer.Server != nil {
			return NewSimpleSuccessResponse(), nil
		}
	}

	// 配置反向端口转发 (rport): 设备端口 -> 本地端口
	// hdc rport tcp:35201 tcp:6100
	// 效果：设备上 localhost:35201 会转发到 PC 上的 localhost:6100
	log.Printf("[NetworkCapture] 检查反向端口转发状态: localPort=%d, devicePort=%d", localPort, devicePort)
	portStatusPtr, err := a.CheckReversePortForwardStatus(deviceId, localPort, devicePort)
	if err != nil {
		log.Printf("[NetworkCapture] 检查端口转发状态失败: %v", err)
		return map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("检查端口转发状态失败: %v", err),
		}, err
	}

	portStatus := *portStatusPtr
	log.Printf("[NetworkCapture] 端转发状态: configured=%v", portStatus.Configured)

	if !portStatus.Configured {
		// 如果未配置，尝试配置反向转发
		log.Printf("[NetworkCapture] 尝试配置反向转发: rport tcp:%d tcp:%d", devicePort, localPort)
		newStatus, err := a.ConfigurePortForward(deviceId, localPort, devicePort, "Reverse")
		if err != nil {
			log.Printf("[NetworkCapture] 配置转发失败: %v", err)
			return map[string]interface{}{
				"success": false,
				"error":   fmt.Sprintf("配置端口转发失败: %v", err),
			}, err
		}
		if !newStatus.Configured {
			log.Printf("[NetworkCapture] 转发配置未成功: %s", newStatus.Error)
			return map[string]interface{}{
				"success": false,
				"error":   newStatus.Error,
			}, nil
		}
		portStatus = *newStatus
		log.Printf("[NetworkCapture] 端口转发配置成功")
	}

	// 创建TCP监听器
	listenAddr := fmt.Sprintf(":%d", localPort)
	log.Printf("[NetworkCapture] 尝试在 %s 上启动TCP服务器", listenAddr)
	listener, err := net.Listen("tcp", listenAddr)
	if err != nil {
		log.Printf("[NetworkCapture] 启动TCP服务器失败: %v", err)
		return map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("启动TCP服务器失败 (端口%d): %v", localPort, err),
		}, err
	}

	log.Printf("[NetworkCapture] TCP服务器已启动: localhost:%d", localPort)

	// 创建或更新服务器对象
	serversMutex.Lock()
	server, ok := captureServers[sessionKey]
	if !ok {
		server = &CaptureServer{
			DeviceID:          deviceId,
			LocalPort:         localPort,
			DevicePort:        devicePort,
			Server:            listener,
			IsRunning:         true,
			Clients:           make(map[string]*ClientSession),
			PortForward:       portStatus,
			SessionBoundaries: []NetworkRequest{},
		}
		captureServers[sessionKey] = server
	} else {
		server.Server = listener
		server.IsRunning = true
		server.PortForward = portStatus
	}
	serversMutex.Unlock()

	// 启动心跳定时器（向所有连接的客户端发送心跳 + 心跳超时检测）
	server.HeartbeatTimer = time.NewTicker(15 * time.Second) // 缩短到15秒，更频繁检测
	go func() {
		for range server.HeartbeatTimer.C {
			server.mu.Lock()
			if !server.IsRunning {
				server.mu.Unlock()
				return
			}

			currentTime := time.Now().UnixMilli()
			heartbeat := map[string]interface{}{
				"type":      "heartbeat",
				"timestamp": currentTime,
			}
			msgBytes, _ := json.Marshal(heartbeat)
			msgBytes = append(msgBytes, '\n')

			// 向所有客户端发送心跳并检测超时
			for deviceId, client := range server.Clients {
				if client.IsConnected && client.Conn != nil {
					// 检查心跳超时（超过60秒没有收到客户端心跳）
					timeSinceLastHeartbeat := currentTime - client.LastHeartbeatTime
					if timeSinceLastHeartbeat > 60000 {
						log.Printf("[NetworkCapture] 客户端 %s 心跳超时 (%d ms)，关闭连接", deviceId, timeSinceLastHeartbeat)
						client.IsConnected = false
						client.Conn.Close()
						continue
					}

					_, err := client.Conn.Write(msgBytes)
					if err != nil {
						log.Printf("[NetworkCapture] 发送心跳失败给客户端 %s: %v", deviceId, err)
						client.IsConnected = false
						client.Conn.Close()
					} else {
						log.Printf("[NetworkCapture] 发送心跳给客户端 %s (上次心跳: %d ms前)", deviceId, timeSinceLastHeartbeat)
					}
				}
			}
			server.mu.Unlock()
		}
	}()

	// 启动接受连接的goroutine
	go a.acceptConnections(server, sessionKey)

	// 启动连接状态监控goroutine（清理已断开的客户端）
	go a.monitorClientConnections(server, sessionKey)

	log.Printf("[NetworkCapture] 新架构抓包启动: %s (%d <- %d)", sessionKey, localPort, devicePort)

	return NewSimpleSuccessResponse(), nil
}

// monitorClientConnections 监控客户端连接状态，清理已断开的连接
func (a *App) monitorClientConnections(server *CaptureServer, sessionKey string) {
	log.Printf("[NetworkCapture] 启动连接状态监控: %s", sessionKey)

	// 每10秒检查一次连接状态
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		server.mu.Lock()
		if !server.IsRunning {
			server.mu.Unlock()
			log.Printf("[NetworkCapture] 服务器已停止，停止连接监控: %s", sessionKey)
			return
		}

		currentTime := time.Now().UnixMilli()
		clientsToClose := []string{}

		// 检查每个客户端的连接状态
		for deviceId, client := range server.Clients {
			if !client.IsConnected || client.Conn == nil {
				clientsToClose = append(clientsToClose, deviceId)
				continue
			}

			// 检查心跳超时
			timeSinceHeartbeat := currentTime - client.LastHeartbeatTime
			if timeSinceHeartbeat > 60000 {
				log.Printf("[NetworkCapture] 客户端 %s 心跳超时 (%d ms)，标记为待清理", deviceId, timeSinceHeartbeat)
				clientsToClose = append(clientsToClose, deviceId)
			}
		}

		// 关闭超时的客户端连接
		for _, deviceId := range clientsToClose {
			client := server.Clients[deviceId]
			if client != nil && client.Conn != nil {
				client.Conn.Close()
			}
			delete(server.Clients, deviceId)
			log.Printf("[NetworkCapture] 已清理客户端: %s", deviceId)
		}

		server.mu.Unlock()
	}
}

// acceptConnections 接受客户端连接
func (a *App) acceptConnections(server *CaptureServer, sessionKey string) {
	log.Printf("[NetworkCapture] 开始接受连接: %s", sessionKey)

	for {
		conn, err := server.Server.Accept()
		if err != nil {
			// 检查服务器是否还在运行
			server.mu.Lock()
			isRunning := server.IsRunning
			server.mu.Unlock()

			if !isRunning {
				log.Printf("[NetworkCapture] 服务器已停止接受连接: %s", sessionKey)
				return
			}

			log.Printf("[NetworkCapture] 接受连接失败: %v", err)
			continue
		}

		// 设置TCP连接选项（优化连接稳定性）
		if tcpConn, ok := conn.(*net.TCPConn); ok {
			// 启用KeepAlive，防止连接静默断开
			tcpConn.SetKeepAlive(true)
			tcpConn.SetKeepAlivePeriod(30 * time.Second) // 更频繁的KeepAlive探测

			// 禁用Nagle算法，减少延迟
			tcpConn.SetNoDelay(true)

			// 设置发送和接收缓冲区大小（防止缓冲区溢出导致断流）
			// 设置为8MB
			tcpConn.SetReadBuffer(8 * 1024 * 1024)
			tcpConn.SetWriteBuffer(8 * 1024 * 1024)

			log.Printf("[NetworkCapture] TCP连接优化完成: KeepAlive=30s, NoDelay=true, Buffer=8MB")
		}

		// 获取客户端设备ID（从连接信息或第一个消息）
		// 这里我们使用sessionKey中的deviceId
		deviceId := server.DeviceID

		// 创建客户端会话
		client := &ClientSession{
			Conn:              conn,
			DeviceID:          deviceId,
			IsConnected:       true,
			LastHeartbeatTime: time.Now().UnixMilli(),
		}

		server.mu.Lock()
		server.Clients[deviceId] = client
		server.mu.Unlock()

		// 发送客户端连接事件到前端
		if a.app != nil {
			a.app.Event.Emit("networkCapture:clientConnected", map[string]interface{}{
				"serverDeviceId": server.DeviceID,
				"clientDeviceId": deviceId,
			})
		}

		// 启动读取goroutine处理该客户端的消息
		go a.readClientData(server, sessionKey, client)
	}
}

// captureErrorThreshold 解析错误上报阈值
const captureErrorThreshold = 10

// readClientData 读取客户端发送的数据（新架构）
func (a *App) readClientData(server *CaptureServer, sessionKey string, client *ClientSession) {
	log.Printf("[NetworkCapture] 开始读取客户端数据: %s", sessionKey)

	scanner := bufio.NewScanner(client.Conn)
	// 增大扫描器缓冲区，防止大消息导致断流（默认64KB，增加到10MB）
	const maxCapacity = 10 * 1024 * 1024
	buf := make([]byte, 0, 64*1024)
	scanner.Buffer(buf, maxCapacity)

	lineCount := 0
	parseSuccessCount := 0
	parseErrorCount := 0
	continuousErrorCount := 0 // 连续错误计数

	for scanner.Scan() {
		line := scanner.Text()
		lineCount++
		trimmed := strings.TrimSpace(line)

		if trimmed == "" {
			continue
		}

		// 降低日志频率，只记录前50条和每100条记录一次，避免日志过多
		if lineCount <= 50 || lineCount%100 == 0 {
			log.Printf("[NetworkCapture] 收到数据 (第 %d 行, 长度: %d): %s", lineCount, len(trimmed), func() string {
				if len(trimmed) > 200 {
					return trimmed[:200] + "..."
				}
				return trimmed
			}())
		}

		// 尝试解析JSON消息
		var msg map[string]interface{}
		if err := json.Unmarshal([]byte(trimmed), &msg); err != nil {
			log.Printf("[NetworkCapture] JSON解析失败 (第 %d 行): %v, 原始数据: %s", lineCount, err, trimmed)
			parseErrorCount++
			continuousErrorCount++
			// 如果连续5次解析失败，可能是连接问题，关闭连接
			if continuousErrorCount >= 5 {
				log.Printf("[NetworkCapture] 连续%d次解析失败，可能连接异常，关闭连接", continuousErrorCount)
				break
			}
			continue
		}
		// 解析成功，重置连续错误计数
		continuousErrorCount = 0

		// 降低日志频率，只记录前100条和每100条记录一次
		if lineCount <= 100 || lineCount%100 == 0 {
			// log.Printf("[NetworkCapture] JSON解析成功 (第 %d 行), 消息类型: %v", lineCount, msg["type"])
		}

		// 更新客户端最后心跳时间
		client.mu.Lock()
		client.LastHeartbeatTime = time.Now().UnixMilli()
		client.mu.Unlock()

		// 检查是否是心跳包
		if msgType, hasType := msg["type"].(string); hasType && msgType == "heartbeat" {
			// 回复心跳响应
			go a.sendHeartbeatResponse(client)
			continue
		}

		// 检查是否是 Mock 配置拉取请求
		if msgType, hasType := msg["type"].(string); hasType && msgType == "mock_config_pull_request" {
			log.Printf("[NetworkCapture] 收到 Mock 配置拉取请求")
			// 发送 Mock 配置响应
			go a.sendMockConfigResponse(client)
			continue
		}

		// 解析网络请求
		request := parseNetworkRequest(msg)
		if request != nil {
			parseSuccessCount++
			log.Printf("[NetworkCapture] 成功解析网络请求 (第 %d 个): %s %s", parseSuccessCount, request.Method, request.URL)

			// 直接发送事件到前端，不再本地存储
			if a.app != nil {
				a.app.Event.Emit("networkCapture:requestReceived", map[string]interface{}{
					"deviceId": server.DeviceID,
					"request":  request,
				})
			}
			log.Printf("[NetworkCapture] 事件已发送到前端: networkCapture:requestReceived")
		} else {
			log.Printf("[NetworkCapture] parseNetworkRequest 返回 nil (第 %d 行), 消息类型: %v", lineCount, msg["type"])
			parseErrorCount++
		}
	}

	log.Printf("[NetworkCapture] 读取循环结束: 总行数=%d, 解析成功=%d, 解析失败=%d", lineCount, parseSuccessCount, parseErrorCount)

	// 处理错误
	if err := scanner.Err(); err != nil {
		log.Printf("[NetworkCapture] Scanner错误: %v", err)
		if a.app != nil {
			a.app.Event.Emit("networkCapture:error", map[string]interface{}{
				"deviceId": server.DeviceID,
				"error":    err.Error(),
			})
		}
	}

	// 连接关闭
	client.mu.Lock()
	client.IsConnected = false
	if client.Conn != nil {
		client.Conn.Close()
	}
	client.mu.Unlock()

	log.Printf("[NetworkCapture] 客户端连接已关闭: %s", sessionKey)

	// 在客户端断连时发送会话边界标记事件
	disconnectTime := time.Now().UnixMilli()
	boundaryMarker := createSessionBoundaryMarker(client.DeviceID, "disconnect", disconnectTime)

	// 发送边界标记事件到前端
	if a.app != nil {
		a.app.Event.Emit("networkCapture:boundaryMarker", map[string]interface{}{
			"deviceId":       server.DeviceID,
			"boundaryMarker": boundaryMarker,
		})
	}
	log.Printf("[NetworkCapture] 已发送断连标记事件: %s", boundaryMarker.BoundaryMessage)

	// 从服务器中移除客户端
	server.mu.Lock()
	delete(server.Clients, client.DeviceID)
	server.mu.Unlock()

	// 发送关闭事件
	if a.app != nil {
		a.app.Event.Emit("networkCapture:closed", map[string]interface{}{
			"deviceId": server.DeviceID,
		})
	}
}

// sendHeartbeatResponse 发送心跳响应给客户端
func (a *App) sendHeartbeatResponse(client *ClientSession) {
	if client == nil || !client.IsConnected || client.Conn == nil {
		log.Printf("[NetworkCapture] 客户端不存在或未连接，无法发送心跳响应")
		return
	}

	// 构建心跳响应
	response := map[string]interface{}{
		"version":   1,
		"timestamp": time.Now().UnixMilli(),
		"type":      "heartbeat_response",
		"data": map[string]interface{}{
			"status": "ok",
		},
	}

	jsonData, err := json.Marshal(response)
	if err != nil {
		log.Printf("[NetworkCapture] 心跳响应JSON序列化失败: %v", err)
		return
	}

	client.mu.Lock()
	defer client.mu.Unlock()

	// 发送数据
	_, err = client.Conn.Write(append(jsonData, '\n'))
	if err != nil {
		log.Printf("[NetworkCapture] 发送心跳响应失败: %v", err)
		client.IsConnected = false
	} else {
		// log.Printf("[NetworkCapture] 心跳响应已发送")
	}
}

// sendMockConfigResponse 发送 Mock 配置响应给客户端
func (a *App) sendMockConfigResponse(client *ClientSession) {
	if client == nil || !client.IsConnected || client.Conn == nil {
		log.Printf("[NetworkCapture] 客户端不存在或未连接，无法发送 Mock 配置响应")
		return
	}

	// 读取当前 Mock 配置
	currentMockConfigMu.RLock()
	config := currentMockConfig
	currentMockConfigMu.RUnlock()

	// 如果没有配置，发送空配置
	if config == nil {
		config = map[string]interface{}{
			"enabled": false,
			"rules":   []interface{}{},
		}
	}

	// 构建响应数据包
	response := map[string]interface{}{
		"version":   1,
		"timestamp": time.Now().UnixMilli(),
		"type":      "mock_config_update",
		"data":      config,
	}

	jsonData, err := json.Marshal(response)
	if err != nil {
		log.Printf("[NetworkCapture] Mock 配置响应 JSON 序列化失败: %v", err)
		return
	}

	client.mu.Lock()
	defer client.mu.Unlock()

	// 发送数据
	_, err = client.Conn.Write(append(jsonData, '\n'))
	if err != nil {
		log.Printf("[NetworkCapture] 发送 Mock 配置响应失败: %v", err)
		client.IsConnected = false
	} else {
		log.Printf("[NetworkCapture] Mock 配置响应已发送")
	}
}

// StopCaptureServer 停止抓包服务器（新架构）
// 注意：停止服务器时不会删除服务器对象，以保留历史请求记录
func (a *App) StopCaptureServer(deviceId string) error {
	serversMutex.Lock()
	defer serversMutex.Unlock()

	stoppedCount := 0
	for _, server := range captureServers {
		if server.DeviceID == deviceId {
			server.mu.Lock()

			// 停止心跳定时器
			if server.HeartbeatTimer != nil {
				server.HeartbeatTimer.Stop()
				server.HeartbeatTimer = nil
			}

			// 关闭所有客户端连接
			for _, client := range server.Clients {
				if client.Conn != nil {
					client.Conn.Close()
				}
			}

			// 关闭服务器监听器
			if server.Server != nil {
				server.Server.Close()
				server.Server = nil
			}

			// 清空客户端列表
			server.Clients = make(map[string]*ClientSession)

			server.IsRunning = false
			server.mu.Unlock()

			stoppedCount++
		}
	}

	if stoppedCount == 0 {
		return fmt.Errorf("capture server not found: %s", deviceId)
	}

	log.Printf("[NetworkCapture] 服务器已停止: %s (停止了 %d 个服务器，保留历史请求)", deviceId, stoppedCount)
	return nil
}

// stopCaptureServersByPort 关闭当前 Hadice 进程中占用指定端口的通用抓包服务器。
// Android 与 HarmonyOS 抓包共用本机 TCP 端口空间，启动前需要跨类型清理。
func (a *App) stopCaptureServersByPort(localPort int) int {
	serversMutex.Lock()
	defer serversMutex.Unlock()

	stoppedCount := 0
	for key, server := range captureServers {
		if server.LocalPort != localPort {
			continue
		}

		server.mu.Lock()
		if server.HeartbeatTimer != nil {
			server.HeartbeatTimer.Stop()
			server.HeartbeatTimer = nil
		}
		for _, client := range server.Clients {
			if client.Conn != nil {
				client.Conn.Close()
			}
		}
		if server.Server != nil {
			server.Server.Close()
			server.Server = nil
		}
		server.Clients = make(map[string]*ClientSession)
		server.IsRunning = false
		server.mu.Unlock()

		delete(captureServers, key)
		stoppedCount++
	}

	if stoppedCount > 0 {
		log.Printf("[NetworkCapture] 已清理本地端口 %d 上的 %d 个通用抓包服务器", localPort, stoppedCount)
	}
	return stoppedCount
}

// GetCaptureServerStatus 获取新架构抓包状态
func (a *App) GetCaptureServerStatus(deviceId string) (map[string]interface{}, error) {
	serversMutex.RLock()
	defer serversMutex.RUnlock()

	// 过滤出该设备的服务器
	servers := lo.Filter(lo.Values(captureServers), func(server *CaptureServer, _ int) bool {
		return server.DeviceID == deviceId
	})

	if len(servers) == 0 {
		return map[string]interface{}{
			"isCapturing": false,
			"portForward": PortForwardStatus{
				Configured: false,
				Status:     "not_configured",
			},
			"sessions": []map[string]interface{}{},
		}, nil
	}

	isCapturing := false
	sessionStatuses := []map[string]interface{}{}

	for _, server := range servers {
		server.mu.Lock()
		if server.IsRunning {
			isCapturing = true
		}

		// 统计连接数和心跳状态
		connectedCount := 0
		currentTime := time.Now().UnixMilli()
		heartbeatInfo := []map[string]interface{}{}

		for deviceId, client := range server.Clients {
			if client.IsConnected {
				connectedCount++
				timeSinceLastHeartbeat := currentTime - client.LastHeartbeatTime
				heartbeatInfo = append(heartbeatInfo, map[string]interface{}{
					"deviceId":           deviceId,
					"isConnected":        client.IsConnected,
					"timeSinceHeartbeat": timeSinceLastHeartbeat, // 距离上次心跳的毫秒数
					"heartbeatStatus": func() string {
						if timeSinceLastHeartbeat < 20000 {
							return "healthy"
						} else if timeSinceLastHeartbeat < 60000 {
							return "warning"
						} else {
							return "timeout"
						}
					}(),
				})
			}
		}

		sessionStatuses = append(sessionStatuses, map[string]interface{}{
			"localPort":      server.LocalPort,
			"devicePort":     server.DevicePort,
			"isRunning":      server.IsRunning,
			"portForward":    server.PortForward,
			"connectedCount": connectedCount,
			"clientCount":    len(server.Clients),
			"heartbeatInfo":  heartbeatInfo,
		})
		server.mu.Unlock()
	}

	return map[string]interface{}{
		"isCapturing": isCapturing,
		"sessions":    sessionStatuses,
	}, nil
}
