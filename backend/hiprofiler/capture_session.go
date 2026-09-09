package hiprofiler

import (
	"context"
	"fmt"
	"io"
	"log"
	"net"
	"strconv"
	"strings"
	"sync"
	"time"

	"Hadice/backend/hdc"
	pb "Hadice/backend/hiprofiler/proto"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/protobuf/encoding/protowire"
)

const (
	grpcDevicePort = 50051 // hiprofilerd 监听端口
)

// HiProfilerCaptureSession HiProfiler gRPC 抓包会话
type HiProfilerCaptureSession struct {
	DeviceID    string
	PID         int
	BundleName  string
	ProcessName string
	stopCh      chan struct{}
	fetchDone   chan struct{}
	emitEvent   func(eventName string, data interface{})

	localPort  int // 本地端口转发端口
	sessionID  uint32
	client     pb.IProfilerServiceClient
	grpcConn   *grpc.ClientConn
	mu         sync.RWMutex
	isRunning  bool
	stopReason string
	stopOnce   sync.Once
}

type HiProfilerRestartWatcher struct {
	DeviceID    string
	OldPID      int
	BundleName  string
	ProcessName string
	emitEvent   func(eventName string, data interface{})
	stopCh      chan struct{}
	stopOnce    sync.Once
}

var (
	captureSessions = make(map[string]*HiProfilerCaptureSession) // key: deviceID:pid
	restartWatchers = make(map[string]*HiProfilerRestartWatcher) // key: deviceID:processName
	sessionsMutex   sync.RWMutex
	startMutex      sync.Mutex
)

// CaptureConfig 抓包配置
type CaptureConfig struct {
	DeviceID    string
	PID         int
	BundleName  string
	ProcessName string
	EmitEvent   func(eventName string, data interface{})
}

// StartCapture 启动 HiProfiler gRPC 流式抓包
func StartCapture(config CaptureConfig) error {
	return startCapture(config, true, nil)
}

func startCapture(config CaptureConfig, cleanExisting bool, cancelCh <-chan struct{}) error {
	startMutex.Lock()
	defer startMutex.Unlock()

	if cancelCh != nil {
		select {
		case <-cancelCh:
			return fmt.Errorf("已停止等待进程重启")
		default:
		}
	}

	key := sessionKey(config.DeviceID, config.PID)

	sessionsMutex.RLock()
	if _, exists := captureSessions[key]; exists {
		sessionsMutex.RUnlock()
		return fmt.Errorf("该进程已在抓包中: PID=%d", config.PID)
	}
	sessionsMutex.RUnlock()

	if cleanExisting {
		// 用户主动开始时先收敛当前设备由 Hadice 管理的残留会话和等待器。
		StopAllCaptures(config.DeviceID)
	}
	emitCaptureState(config.EmitEvent, config.DeviceID, config.PID, config.BundleName, config.ProcessName, "starting", "")
	removeProfilerPortForwards(config.DeviceID)

	// 1. 重启 hiprofilerd（确保干净状态）
	if err := restartHiProfilerd(config.DeviceID); err != nil {
		emitCaptureState(config.EmitEvent, config.DeviceID, config.PID, config.BundleName, config.ProcessName, "error", err.Error())
		return fmt.Errorf("启动 hiprofilerd 失败: %w", err)
	}

	// 2. 找一个空闲本地端口
	localPort, err := getFreePort()
	if err != nil {
		emitCaptureState(config.EmitEvent, config.DeviceID, config.PID, config.BundleName, config.ProcessName, "error", err.Error())
		return fmt.Errorf("获取空闲端口失败: %w", err)
	}

	// 3. 设置端口转发
	if err := setupPortForward(config.DeviceID, localPort); err != nil {
		emitCaptureState(config.EmitEvent, config.DeviceID, config.PID, config.BundleName, config.ProcessName, "error", err.Error())
		return fmt.Errorf("端口转发失败: %w", err)
	}
	// 等待端口转发生效
	time.Sleep(500 * time.Millisecond)

	// 4. gRPC 连接
	addr := fmt.Sprintf("127.0.0.1:%d", localPort)
	conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		removePortForward(config.DeviceID, localPort)
		emitCaptureState(config.EmitEvent, config.DeviceID, config.PID, config.BundleName, config.ProcessName, "error", err.Error())
		return fmt.Errorf("gRPC 连接失败: %w", err)
	}

	client := pb.NewIProfilerServiceClient(conn)
	ctx := context.Background()

	// 5. CreateSession (ONLINE 模式)
	configData := buildNetworkProfilerConfigData(config.PID)
	createResp, err := client.CreateSession(ctx, &pb.CreateSessionRequest{
		RequestId: 1,
		SessionConfig: &pb.ProfilerSessionConfig{
			Buffers:     []*pb.ProfilerSessionConfig_BufferConfig{{Pages: 16384}},
			SessionMode: pb.ProfilerSessionConfig_ONLINE,
		},
		PluginConfigs: []*pb.ProfilerPluginConfig{
			{
				Name: "network-profiler",
				// streaming 插件要求非零值；该值不控制 network-profiler
				// 内部 HTTP 事件的聚合 flush，不能消除设备侧尾批延迟。
				SampleInterval: 10,
				ConfigData:     configData,
			},
		},
	})
	if err != nil {
		conn.Close()
		removePortForward(config.DeviceID, localPort)
		emitCaptureState(config.EmitEvent, config.DeviceID, config.PID, config.BundleName, config.ProcessName, "error", err.Error())
		return fmt.Errorf("CreateSession 失败: %w", err)
	}
	sessionID := createResp.GetSessionId()

	// 6. StartSession
	_, err = client.StartSession(ctx, &pb.StartSessionRequest{
		RequestId: 2,
		SessionId: sessionID,
	})
	if err != nil {
		// 尝试清理
		client.DestroySession(context.Background(), &pb.DestroySessionRequest{SessionId: sessionID})
		conn.Close()
		removePortForward(config.DeviceID, localPort)
		emitCaptureState(config.EmitEvent, config.DeviceID, config.PID, config.BundleName, config.ProcessName, "error", err.Error())
		return fmt.Errorf("StartSession 失败: %w", err)
	}

	session := &HiProfilerCaptureSession{
		DeviceID:    config.DeviceID,
		PID:         config.PID,
		BundleName:  config.BundleName,
		ProcessName: config.ProcessName,
		stopCh:      make(chan struct{}),
		fetchDone:   make(chan struct{}),
		emitEvent:   config.EmitEvent,
		localPort:   localPort,
		sessionID:   sessionID,
		client:      client,
		grpcConn:    conn,
		isRunning:   true,
	}

	sessionsMutex.Lock()
	if _, exists := captureSessions[key]; exists {
		sessionsMutex.Unlock()
		session.stop("replaced")
		return fmt.Errorf("该进程已在抓包中: PID=%d", config.PID)
	}
	captureSessions[key] = session
	sessionsMutex.Unlock()
	go session.fetchDataLoop(client, sessionID)
	go session.monitorProcess()
	session.emitState("capturing", "")

	log.Printf("[HiProfiler] gRPC 抓包已启动: device=%s, pid=%d, session=%d, localPort=%d",
		config.DeviceID, config.PID, sessionID, localPort)
	return nil
}

// StopCapture 停止 HiProfiler 抓包
func StopCapture(deviceID string, pid int) error {
	key := sessionKey(deviceID, pid)

	sessionsMutex.RLock()
	session, exists := captureSessions[key]
	var watcher *HiProfilerRestartWatcher
	if !exists {
		for _, candidate := range restartWatchers {
			if candidate.DeviceID == deviceID && candidate.OldPID == pid {
				watcher = candidate
				break
			}
		}
	}
	sessionsMutex.RUnlock()
	if !exists {
		if watcher != nil {
			watcher.stop()
		}
		return nil
	}

	session.stop("manual")
	return nil
}

// StopAllCaptures 停止指定设备的全部 HiProfiler 会话。
// deviceID 为空时停止当前进程管理的全部会话，用于应用退出清理。
func StopAllCaptures(deviceID string) int {
	sessionsMutex.RLock()
	sessions := make([]*HiProfilerCaptureSession, 0)
	watchers := make([]*HiProfilerRestartWatcher, 0)
	deviceIDs := make(map[string]struct{})
	for _, session := range captureSessions {
		if deviceID == "" || session.DeviceID == deviceID {
			sessions = append(sessions, session)
			deviceIDs[session.DeviceID] = struct{}{}
		}
	}
	for _, watcher := range restartWatchers {
		if deviceID == "" || watcher.DeviceID == deviceID {
			watchers = append(watchers, watcher)
			deviceIDs[watcher.DeviceID] = struct{}{}
		}
	}
	sessionsMutex.RUnlock()

	for _, watcher := range watchers {
		watcher.stop()
	}
	for _, session := range sessions {
		session.stop("manual")
	}
	if deviceID != "" {
		deviceIDs[deviceID] = struct{}{}
	}
	for id := range deviceIDs {
		removeProfilerPortForwards(id)
	}
	return len(sessions) + len(watchers)
}

// GetCaptureStatus 获取指定设备当前的 HiProfiler 抓包状态。
func GetCaptureStatus(deviceID string) map[string]interface{} {
	sessionsMutex.RLock()
	defer sessionsMutex.RUnlock()

	for _, session := range captureSessions {
		if session.DeviceID != deviceID {
			continue
		}
		running := session.running()
		state := "idle"
		if running {
			state = "capturing"
		}
		return map[string]interface{}{
			"state":       state,
			"isCapturing": running,
			"pid":         session.PID,
			"bundleName":  session.BundleName,
			"processName": session.ProcessName,
			"localPort":   session.localPort,
		}
	}
	for _, watcher := range restartWatchers {
		if watcher.DeviceID != deviceID {
			continue
		}
		return map[string]interface{}{
			"state":       "waiting",
			"isCapturing": false,
			"pid":         0,
			"bundleName":  watcher.BundleName,
			"processName": watcher.ProcessName,
			"reason":      "processExited",
		}
	}
	return map[string]interface{}{
		"state":       "idle",
		"isCapturing": false,
	}
}

// fetchDataLoop 持续从 FetchData 流读取数据
func (s *HiProfilerCaptureSession) fetchDataLoop(client pb.IProfilerServiceClient, sessionID uint32) {
	defer close(s.fetchDone)

	err := s.fetchOnce(client, sessionID)
	if !s.running() {
		return
	}
	if err == nil {
		err = fmt.Errorf("FetchData 数据流已结束")
	}
	log.Printf("[HiProfiler] FetchData 错误: %v", err)
	s.emitEvent("networkCapture:error", map[string]interface{}{
		"deviceId": s.DeviceID,
		"error":    err.Error(),
	})
	s.emitEvent("hiprofiler:captureError", map[string]interface{}{
		"deviceId": s.DeviceID,
		"error":    err.Error(),
	})
	s.stop("streamError")
}

// fetchOnce 执行一次 FetchData 流读取
func (s *HiProfilerCaptureSession) fetchOnce(client pb.IProfilerServiceClient, sessionID uint32) error {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	stream, err := client.FetchData(ctx, &pb.FetchDataRequest{
		RequestId: 10,
		SessionId: sessionID,
	})
	if err != nil {
		return fmt.Errorf("FetchData 失败: %w", err)
	}

	for {
		select {
		case <-s.stopCh:
			return nil
		default:
		}

		resp, err := stream.Recv()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return fmt.Errorf("Recv 错误: %w", err)
		}

		// 解析并推送数据
		for _, pd := range resp.GetPluginData() {
			if pd.GetName() == "network-profiler" && len(pd.GetData()) > 0 {
				requests := parseNetworkProfilerStreamData(pd.GetData())
				for _, req := range requests {
					networkReq := convertToNetworkRequest(&req, s.DeviceID)
					s.emitEvent("networkCapture:requestReceived", map[string]interface{}{
						"deviceId": s.DeviceID,
						"request":  networkReq,
					})
				}
				if len(requests) > 0 {
					log.Printf("[HiProfiler] 推送 %d 个HTTP请求", len(requests))
				}
			}
		}
	}
}

// parseNetworkProfilerStreamData 解析 FetchData 返回的 network-profiler 数据
func parseNetworkProfilerStreamData(data []byte) []HTTPRequest {
	var requests []HTTPRequest

	buf := data
	for len(buf) > 0 {
		num, typ, n := protowire.ConsumeTag(buf)
		if n <= 0 {
			break
		}
		buf = buf[n:]
		if typ != protowire.BytesType || num != 1 {
			m := protowire.ConsumeFieldValue(num, typ, buf)
			if m <= 0 {
				break
			}
			buf = buf[m:]
			continue
		}
		eventGroupData, m := protowire.ConsumeBytes(buf)
		if m <= 0 {
			break
		}
		buf = buf[m:]

		req := parseEventGroup(eventGroupData)
		if req != nil && req.URL != "" {
			requests = append(requests, *req)
		}
	}
	return requests
}

// buildNetworkProfilerConfigData 构建 network-profiler 的 protobuf config_data
// 字段: 1=pid, 4=clock_id(BOOTTIME=1), 5=smb_pages, 6=flush_interval, 7=block
// flush_interval=1 只让目标进程及时通知 network-profiler 服务读取共享内存；
// 服务内部 NetworkProfilerHandle 的二次聚合 flush 不受该字段控制。
func buildNetworkProfilerConfigData(pid int) []byte {
	var buf []byte
	buf = append(buf, protowire.AppendTag(nil, 1, protowire.VarintType)...)
	buf = append(buf, protowire.AppendVarint(nil, uint64(pid))...)
	buf = append(buf, protowire.AppendTag(nil, 4, protowire.VarintType)...)
	buf = append(buf, protowire.AppendVarint(nil, 1)...) // clock_id=BOOTTIME
	buf = append(buf, protowire.AppendTag(nil, 5, protowire.VarintType)...)
	buf = append(buf, protowire.AppendVarint(nil, 16384)...) // smb_pages
	buf = append(buf, protowire.AppendTag(nil, 6, protowire.VarintType)...)
	buf = append(buf, protowire.AppendVarint(nil, 1)...) // flush_interval
	buf = append(buf, protowire.AppendTag(nil, 7, protowire.VarintType)...)
	buf = append(buf, protowire.AppendVarint(nil, 0)...) // block=false
	return buf
}

// restartHiProfilerd 重启 hiprofilerd（确保干净状态，避免残留会话）
func restartHiProfilerd(deviceID string) error {
	// 先 kill 所有 hiprofiler 相关进程
	killArgs := []string{"-t", deviceID, "shell", "killall", "hiprofiler_cmd", "hiprofilerd", "hiprofiler_plugins"}
	hdc.ExecuteHdcWithTimeout(killArgs, 5*time.Second)
	time.Sleep(500 * time.Millisecond)

	// 重新启动
	startArgs := []string{"-t", deviceID, "shell", "hiprofiler_cmd", "-s"}
	result, err := hdc.ExecuteHdcWithTimeout(startArgs, 10*time.Second)
	if err != nil {
		return fmt.Errorf("hiprofiler_cmd -s 失败: %w", err)
	}
	if !result.Success {
		return fmt.Errorf("hiprofiler_cmd -s 失败: %s", result.Error)
	}
	time.Sleep(1 * time.Second)

	// 验证已启动
	checkArgs := []string{"-t", deviceID, "shell", "hiprofiler_cmd", "-q"}
	checkResult, err := hdc.ExecuteHdcWithTimeout(checkArgs, 5*time.Second)
	if err != nil || !checkResult.Success || !strings.Contains(checkResult.Output, "OK") {
		return fmt.Errorf("hiprofilerd 未启动成功")
	}
	log.Printf("[HiProfiler] hiprofilerd 已重启")
	return nil
}

// getFreePort 获取一个空闲的本地端口
func getFreePort() (int, error) {
	addr, err := net.ResolveTCPAddr("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	l, err := net.ListenTCP("tcp", addr)
	if err != nil {
		return 0, err
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port, nil
}

// setupPortForward 设置 hdc 端口转发
func setupPortForward(deviceID string, localPort int) error {
	args := []string{"-t", deviceID, "fport", fmt.Sprintf("tcp:%d", localPort), fmt.Sprintf("tcp:%d", grpcDevicePort)}
	result, err := hdc.ExecuteHdcWithTimeout(args, 10*time.Second)
	if err != nil {
		return fmt.Errorf("hdc fport 失败: %w", err)
	}
	if !strings.Contains(result.Output, "OK") && !strings.Contains(result.Output, "Forwardport result:OK") {
		return fmt.Errorf("hdc fport 失败: %s", result.Output)
	}
	return nil
}

// removePortForward 移除 hdc 端口转发
func removePortForward(deviceID string, localPort int) {
	args := []string{"-t", deviceID, "fport", "rm", fmt.Sprintf("tcp:%d", localPort), fmt.Sprintf("tcp:%d", grpcDevicePort)}
	result, err := hdc.ExecuteHdcWithTimeout(args, 5*time.Second)
	if err != nil {
		log.Printf("[HiProfiler] 删除端口转发失败: device=%s, localPort=%d, error=%v", deviceID, localPort, err)
		return
	}
	if !result.Success {
		log.Printf("[HiProfiler] 删除端口转发失败: device=%s, localPort=%d, output=%s, error=%s",
			deviceID, localPort, result.Output, result.Error)
	}
}

// removeProfilerPortForwards 清理当前设备上所有指向 hiprofilerd 50051 的正向转发。
// hiprofilerd 是设备级独占服务，Hadice 启动时会重启该服务；这些规则即使来自
// 上一次异常退出，也已不再对应可恢复的会话。
func removeProfilerPortForwards(deviceID string) {
	args := []string{"-t", deviceID, "fport", "ls"}
	result, err := hdc.ExecuteHdcWithTimeout(args, 5*time.Second)
	if err != nil || !result.Success {
		if err != nil {
			log.Printf("[HiProfiler] 查询残留端口转发失败: device=%s, error=%v", deviceID, err)
		}
		return
	}

	for _, line := range strings.Split(result.Output, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 3 || !strings.Contains(line, "[Forward]") {
			continue
		}
		for i := 1; i < len(fields); i++ {
			if fields[i] != fmt.Sprintf("tcp:%d", grpcDevicePort) {
				continue
			}
			localField := fields[i-1]
			if !strings.HasPrefix(localField, "tcp:") {
				continue
			}
			localPort, parseErr := strconv.Atoi(strings.TrimPrefix(localField, "tcp:"))
			if parseErr != nil || localPort <= 0 {
				continue
			}
			removePortForward(deviceID, localPort)
			log.Printf("[HiProfiler] 已清理 profiler 端口转发: device=%s, localPort=%d", deviceID, localPort)
			break
		}
	}
}

// convertToNetworkRequest 将 HTTPRequest 转换为前端使用的 NetworkRequest 格式
func convertToNetworkRequest(req *HTTPRequest, deviceID string) map[string]interface{} {
	statusCode := req.StatusCode
	if statusCode == 0 {
		statusCode = extractStatusCode(req.ResponseHeaders)
	}
	return map[string]interface{}{
		"id":              fmt.Sprintf("hiprofiler-%d-%s", time.Now().UnixNano(), truncateString(req.URL, 50)),
		"timestamp":       time.Now().UnixMilli(),
		"method":          req.Method,
		"url":             truncateString(req.URL, 200),
		"fullUrl":         req.URL,
		"statusCode":      statusCode,
		"requestHeaders":  parseHeaderString(req.RequestHeaders),
		"responseHeaders": parseHeaderString(req.ResponseHeaders),
		"requestBody":     req.RequestBody,
		"responseBody":    req.ResponseBody,
		"direction":       "response",
	}
}

// parseHeaderString 将原始 header 字符串解析为 map
func parseHeaderString(headerStr string) map[string]string {
	if headerStr == "" {
		return nil
	}
	headers := make(map[string]string)
	for _, line := range strings.Split(headerStr, "\n") {
		line = strings.TrimSpace(line)
		if idx := strings.Index(line, ":"); idx > 0 {
			key := strings.TrimSpace(line[:idx])
			value := strings.TrimSpace(line[idx+1:])
			if key != "" {
				headers[key] = value
			}
		}
	}
	if len(headers) == 0 {
		return nil
	}
	return headers
}

// extractStatusCode 从响应头中提取状态码
func extractStatusCode(responseHeaders string) int {
	if strings.HasPrefix(responseHeaders, "HTTP/") {
		parts := strings.SplitN(responseHeaders, " ", 3)
		if len(parts) >= 2 {
			var code int
			fmt.Sscanf(parts[1], "%d", &code)
			return code
		}
	}
	return 0
}

// truncateString 截断字符串
func truncateString(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen]
}

func sessionKey(deviceID string, pid int) string {
	return fmt.Sprintf("%s:%d", deviceID, pid)
}

func restartWatcherKey(deviceID string, processName string) string {
	return fmt.Sprintf("%s:%s", deviceID, processName)
}

func startRestartWatcher(session *HiProfilerCaptureSession) {
	key := restartWatcherKey(session.DeviceID, session.ProcessName)
	watcher := &HiProfilerRestartWatcher{
		DeviceID:    session.DeviceID,
		OldPID:      session.PID,
		BundleName:  session.BundleName,
		ProcessName: session.ProcessName,
		emitEvent:   session.emitEvent,
		stopCh:      make(chan struct{}),
	}

	sessionsMutex.Lock()
	if _, exists := restartWatchers[key]; exists {
		sessionsMutex.Unlock()
		return
	}
	restartWatchers[key] = watcher
	sessionsMutex.Unlock()

	go watcher.run()
}

func (w *HiProfilerRestartWatcher) stop() {
	w.stopOnce.Do(func() {
		close(w.stopCh)
		key := restartWatcherKey(w.DeviceID, w.ProcessName)
		sessionsMutex.Lock()
		if current, exists := restartWatchers[key]; exists && current == w {
			delete(restartWatchers, key)
		}
		sessionsMutex.Unlock()
		emitCaptureState(w.emitEvent, w.DeviceID, 0, w.BundleName, w.ProcessName, "idle", "manual")
	})
}

func (w *HiProfilerRestartWatcher) run() {
	timer := time.NewTimer(500 * time.Millisecond)
	defer timer.Stop()

	for {
		select {
		case <-w.stopCh:
			return
		case <-timer.C:
		}

		pid, found, err := QueryPidByProcessName(w.DeviceID, w.ProcessName)
		if err != nil {
			log.Printf("[HiProfiler] 等待进程重启时查询失败: ProcessName=%s, error=%v", w.ProcessName, err)
			timer.Reset(1 * time.Second)
			continue
		}
		if !found || pid <= 0 {
			timer.Reset(500 * time.Millisecond)
			continue
		}

		select {
		case <-w.stopCh:
			return
		default:
		}

		emitCaptureState(w.emitEvent, w.DeviceID, pid, w.BundleName, w.ProcessName, "restarting", "newPidDetected")
		err = startCapture(CaptureConfig{
			DeviceID:    w.DeviceID,
			PID:         pid,
			BundleName:  w.BundleName,
			ProcessName: w.ProcessName,
			EmitEvent:   w.emitEvent,
		}, false, w.stopCh)
		if err != nil {
			log.Printf("[HiProfiler] 新 PID 自动恢复失败: ProcessName=%s, PID=%d, error=%v", w.ProcessName, pid, err)
			select {
			case <-w.stopCh:
				return
			default:
			}
			emitCaptureState(w.emitEvent, w.DeviceID, 0, w.BundleName, w.ProcessName, "waiting", err.Error())
			select {
			case <-w.stopCh:
				return
			case <-time.After(2 * time.Second):
			}
			timer.Reset(500 * time.Millisecond)
			continue
		}

		select {
		case <-w.stopCh:
			// 用户在自动重连期间停止等待；新会话若已创建也要立即收敛。
			_ = StopCapture(w.DeviceID, pid)
			return
		default:
		}

		key := restartWatcherKey(w.DeviceID, w.ProcessName)
		sessionsMutex.Lock()
		if current, exists := restartWatchers[key]; exists && current == w {
			delete(restartWatchers, key)
		}
		sessionsMutex.Unlock()
		log.Printf("[HiProfiler] 已自动切换到新 PID: ProcessName=%s, %d -> %d", w.ProcessName, w.OldPID, pid)
		return
	}
}

func (s *HiProfilerCaptureSession) running() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.isRunning
}

func (s *HiProfilerCaptureSession) markStopped(reason string) {
	s.mu.Lock()
	s.isRunning = false
	s.stopReason = reason
	s.mu.Unlock()
}

func (s *HiProfilerCaptureSession) stoppedFor(reason string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.stopReason == reason
}

func emitCaptureState(
	emitEvent func(eventName string, data interface{}),
	deviceID string,
	pid int,
	bundleName string,
	processName string,
	state string,
	reason string,
) {
	if emitEvent == nil {
		return
	}
	emitEvent("hiprofiler:captureStateChanged", map[string]interface{}{
		"deviceId":    deviceID,
		"pid":         pid,
		"bundleName":  bundleName,
		"processName": processName,
		"state":       state,
		"isCapturing": state == "capturing",
		"reason":      reason,
	})
}

func (s *HiProfilerCaptureSession) emitState(state string, reason string) {
	emitCaptureState(s.emitEvent, s.DeviceID, s.PID, s.BundleName, s.ProcessName, state, reason)
}

// stop 按协议顺序同步收敛会话。所有手动停止、进程退出、数据流异常路径共用此方法。
func (s *HiProfilerCaptureSession) stop(reason string) {
	s.stopOnce.Do(func() {
		s.markStopped(reason)
		if reason == "manual" {
			s.emitState("stopping", reason)
		}

		// StopSession 会要求 network-profiler 刷新尾批数据；在关闭 gRPC 连接前先执行。
		if s.client != nil && s.sessionID != 0 {
			stopCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			if _, err := s.client.StopSession(stopCtx, &pb.StopSessionRequest{SessionId: s.sessionID}); err != nil {
				log.Printf("[HiProfiler] StopSession 失败: device=%s, pid=%d, error=%v", s.DeviceID, s.PID, err)
			}
			cancel()
		}

		// 进程退出和手动停止时，StopSession 可能还会让 FetchData 返回最后一批请求。
		// 必须等数据流消费完成后再关闭连接，保证边界标记不会插到尾批请求之前。
		if reason == "processExited" || reason == "manual" {
			select {
			case <-s.fetchDone:
			case <-time.After(5 * time.Second):
				log.Printf("[HiProfiler] 等待 FetchData 尾批超时: device=%s, pid=%d", s.DeviceID, s.PID)
			}
		}

		close(s.stopCh)

		if s.client != nil && s.sessionID != 0 {
			destroyCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			if _, err := s.client.DestroySession(destroyCtx, &pb.DestroySessionRequest{SessionId: s.sessionID}); err != nil {
				log.Printf("[HiProfiler] DestroySession 失败: device=%s, pid=%d, error=%v", s.DeviceID, s.PID, err)
			}
			cancel()
		}
		if s.grpcConn != nil {
			if err := s.grpcConn.Close(); err != nil {
				log.Printf("[HiProfiler] 关闭 gRPC 连接失败: device=%s, pid=%d, error=%v", s.DeviceID, s.PID, err)
			}
		}
		removePortForward(s.DeviceID, s.localPort)

		key := sessionKey(s.DeviceID, s.PID)
		sessionsMutex.Lock()
		if current, exists := captureSessions[key]; exists && current == s {
			delete(captureSessions, key)
		}
		sessionsMutex.Unlock()

		finalState := "idle"
		if reason == "processExited" {
			// 等待状态必须在 restart watcher 注册完成后再发送，避免前端点击
			// “停止等待”时 watcher 尚未进入注册表。
			finalState = ""
		} else if reason == "streamError" {
			finalState = "error"
		}
		if finalState != "" {
			s.emitState(finalState, reason)
		}
		log.Printf("[HiProfiler] gRPC 抓包已停止: device=%s, pid=%d, reason=%s", s.DeviceID, s.PID, reason)
	})
}

// monitorProcess 后台监控进程是否存活，进程被杀时自动停止抓包并通知前端
func (s *HiProfilerCaptureSession) monitorProcess() {
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-s.stopCh:
			return
		case <-ticker.C:
			pid, found, err := QueryPidByProcessName(s.DeviceID, s.ProcessName)
			if err != nil {
				log.Printf("[HiProfiler] 查询进程状态失败: PID=%d, ProcessName=%s, error=%v", s.PID, s.ProcessName, err)
				continue
			}
			if !found || pid != s.PID {
				log.Printf("[HiProfiler] 进程已不存在: PID=%d, ProcessName=%s", s.PID, s.ProcessName)
				destroyedAt := time.Now()
				s.stop("processExited")
				if s.stoppedFor("processExited") {
					s.emitProcessKilledMarker(destroyedAt)
					startRestartWatcher(s)
					s.emitState("waiting", "processExited")
				}
				return
			}
		}
	}
}

// emitProcessKilledMarker 发送进程被销毁的边界标记事件
func (s *HiProfilerCaptureSession) emitProcessKilledMarker(destroyedAt time.Time) {
	emittedAt := time.Now()
	displayName := s.ProcessName
	if displayName == "" {
		displayName = s.BundleName
	}
	message := fmt.Sprintf("%s进程(PID:%d)被销毁 (%s)", displayName, s.PID, destroyedAt.Format("15:04:05"))

	boundaryMarker := map[string]interface{}{
		"id":                fmt.Sprintf("boundary-hiprofiler-%d", emittedAt.UnixMilli()),
		"timestamp":         emittedAt.UnixMilli(),
		"method":            "",
		"url":               "",
		"direction":         "boundary",
		"isSessionBoundary": true,
		"boundaryType":      "processKilled",
		"clientId":          fmt.Sprintf("hiprofiler-%d", s.PID),
		"boundaryMessage":   message,
	}

	s.emitEvent("networkCapture:boundaryMarker", map[string]interface{}{
		"deviceId":       s.DeviceID,
		"boundaryMarker": boundaryMarker,
	})

	// 同时发送 closed 事件，通知前端重置抓包状态
	s.emitEvent("networkCapture:closed", map[string]interface{}{
		"deviceId": s.DeviceID,
	})
}
