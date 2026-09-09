package android

import (
	"bufio"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"strings"
	"sync"
	"time"
)

var (
	androidCaptureServers = make(map[string]*AndroidCaptureServer)
	androidServersMutex   sync.RWMutex
)

type EventEmitFunc func(eventName string, data interface{})
type MockConfigProviderFunc func() interface{}

type CaptureConfig struct {
	DeviceID    string
	PackageName string
	PID         int
	LocalPort   int
	AgentPath   string
	EmitEvent   EventEmitFunc
	MockConfig  MockConfigProviderFunc
}

func StartAndroidCapture(config CaptureConfig) error {
	overallStart := time.Now()
	sessionKey := fmt.Sprintf("%s:%s", config.DeviceID, config.PackageName)
	_, processName := getPackageNameForPID(config.DeviceID, config.PID)
	if processName == "" {
		processName = config.PackageName
	}

	androidServersMutex.Lock()
	if existing, ok := androidCaptureServers[sessionKey]; ok && existing.IsRunning {
		androidServersMutex.Unlock()
		return fmt.Errorf("capture already running for %s", sessionKey)
	}
	androidServersMutex.Unlock()

	agentLoaded, err := IsAgentLoaded(config.DeviceID, config.PackageName, config.PID)
	if err != nil {
		return fmt.Errorf("failed to detect whether agent is loaded: %w", err)
	}

	appAgentPath := ""
	if agentLoaded {
		log.Printf("[AndroidCapture] Agent is already loaded in PID %d; restoring the previous connection", config.PID)
		if config.EmitEvent != nil {
			config.EmitEvent("androidCapture:restoreStarted", map[string]interface{}{
				"deviceId":    config.DeviceID,
				"packageName": config.PackageName,
				"pid":         config.PID,
			})
		}
	} else {
		agentMgr := NewAgentManager(config.AgentPath)

		// 仅首次注入时推送并复制 agent。已经加载的进程绝不能原地覆盖同一路径的 so。
		stepStart := time.Now()
		log.Printf("[AndroidCapture] Pushing latest agent to device...")
		if err := agentMgr.PushAgent(config.DeviceID, config.PID); err != nil {
			return fmt.Errorf("failed to push agent: %w", err)
		}

		// 将 agent 复制到应用私有目录（解决权限问题）
		appAgentPath, err = PushAgentToAppPrivateDir(config.DeviceID, config.PackageName)
		if err != nil {
			log.Printf("[AndroidCapture] Warning: failed to copy agent to app private dir: %v", err)
			// 如果失败，尝试使用临时目录路径
			appAgentPath = DefaultAgentRemotePath
		}
		log.Printf("[AndroidCapture] step[prepare agent] took %dms", time.Since(stepStart).Milliseconds())
	}

	// 1. 启动 TCP 服务器监听桌面端口
	listenAddr := fmt.Sprintf(":%d", config.LocalPort)
	listener, err := net.Listen("tcp", listenAddr)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "address already in use") {
			log.Printf("[AndroidCapture] Port %d is in use, cleaning all stale Android captures on this port and retrying once", config.LocalPort)
			StopAndroidCapturesByPort(config.LocalPort)
			time.Sleep(300 * time.Millisecond)
			listener, err = net.Listen("tcp", listenAddr)
		}
		if err != nil {
			if strings.Contains(strings.ToLower(err.Error()), "address already in use") {
				return fmt.Errorf("本地端口 %d 仍被占用，请关闭其他 Hadice 实例后重试", config.LocalPort)
			}
			return fmt.Errorf("failed to start TCP server: %w", err)
		}
	}

	server := &AndroidCaptureServer{
		DeviceID:     config.DeviceID,
		PackageName:  config.PackageName,
		ProcessName:  processName,
		PID:          config.PID,
		LocalPort:    config.LocalPort,
		Server:       listener,
		IsRunning:    true,
		Clients:      make(map[string]*ClientSession),
		MockConfig:   config.MockConfig,
		CaptureRunID: fmt.Sprintf("%d", overallStart.UnixNano()),
		MonitorWake:  make(chan struct{}, 1),
		MonitorStop:  make(chan struct{}),
	}

	androidServersMutex.Lock()
	androidCaptureServers[sessionKey] = server
	androidServersMutex.Unlock()

	// 2. 设置反向端口转发：手机端口 -> 桌面端口
	// Agent 连接手机的 127.0.0.1:localPort 会被转发到桌面的 localPort
	// 使用 adb reverse（不是 forward），因为 Agent 在手机上发起连接
	agentPort := config.LocalPort
	reverseStepStart := time.Now()
	log.Printf("[AndroidCapture] Setting up reverse port forward: tcp:%d (device) -> tcp:%d (desktop)", agentPort, config.LocalPort)
	if err := SetupReversePortForwardWithVerify(config.DeviceID, agentPort); err != nil {
		androidServersMutex.Lock()
		cleanupAndroidCaptureServerLocked(sessionKey, server, false)
		androidServersMutex.Unlock()
		return fmt.Errorf("failed to setup reverse port forward: %w", err)
	}
	log.Printf("[AndroidCapture] step[reverse port forward] took %dms", time.Since(reverseStepStart).Milliseconds())

	jdwpPort := config.LocalPort + 1
	if !agentLoaded {
		// 3. 设置 JDWP 端口转发（仅首次注入的 AM 失败回退需要）
		jdwpStepStart := time.Now()
		log.Printf("[AndroidCapture] Setting up JDWP forward: tcp:%d -> jdwp:%d", jdwpPort, config.PID)
		if err := SetupJDWPForward(config.DeviceID, jdwpPort, config.PID); err != nil {
			RemoveReversePortForward(config.DeviceID, agentPort)
			androidServersMutex.Lock()
			cleanupAndroidCaptureServerLocked(sessionKey, server, false)
			androidServersMutex.Unlock()
			return fmt.Errorf("failed to setup JDWP forward: %w", err)
		}
		log.Printf("[AndroidCapture] step[jdwp forward] took %dms", time.Since(jdwpStepStart).Milliseconds())
	}

	// 启动接受连接的 goroutine（必须在 attach agent 之前）
	go acceptAndroidConnections(server, config.EmitEvent)

	if agentLoaded {
		// 已加载的 agent 会在 reverse/server 恢复后自行重连；禁止覆盖 so 或再次 attach。
		if !waitForAndroidAgentConnection(sessionKey, server, 8*time.Second) {
			RemoveReversePortForward(config.DeviceID, agentPort)
			androidServersMutex.Lock()
			cleanupAndroidCaptureServerLocked(sessionKey, server, false)
			androidServersMutex.Unlock()
			return fmt.Errorf("恢复抓取失败，请重启目标APP再次抓包")
		}
		log.Printf("[AndroidCapture] Restored capture for %s (PID: %d), total took %dms",
			config.PackageName, config.PID, time.Since(overallStart).Milliseconds())
		startAndroidCaptureBackgroundServices(sessionKey, server, config)
		return nil
	}

	// 4. 加载 Agent（使用应用私有目录的路径）
	// 注意：agent 现在在后台线程异步连接，am attach-agent 不再阻塞等待连接完成
	attachStepStart := time.Now()
	attachErr := AttachAgentViaAM(config.DeviceID, config.PID, appAgentPath)
	if attachErr != nil {
		log.Printf("[AndroidCapture] am attach-agent failed, trying JDWP: %v", attachErr)
		attachErr = AttachAgentViaJDWP(config.DeviceID, config.PID, jdwpPort, appAgentPath)
		if attachErr != nil {
			RemovePortForward(config.DeviceID, jdwpPort)
			RemoveReversePortForward(config.DeviceID, agentPort)
			androidServersMutex.Lock()
			cleanupAndroidCaptureServerLocked(sessionKey, server, false)
			androidServersMutex.Unlock()
			return fmt.Errorf("failed to attach agent (both am and JDWP failed): %w", attachErr)
		}
	}
	log.Printf("[AndroidCapture] step[attach agent] took %dms", time.Since(attachStepStart).Milliseconds())

	// WebView uses Chromium DevTools Protocol rather than the JVMTI HTTP hooks.
	// Keep it as a parallel session and merge its records through the same event.
	startAndroidCaptureBackgroundServices(sessionKey, server, config)

	log.Printf("[AndroidCapture] Started capture for %s (PID: %d, Port: %d), total took %dms",
		config.PackageName, config.PID, config.LocalPort, time.Since(overallStart).Milliseconds())
	return nil
}

func startAndroidCaptureBackgroundServices(sessionKey string, server *AndroidCaptureServer, config CaptureConfig) {
	server.WebViewSession = StartWebViewCDPSession(config, server.CaptureRunID)
	go monitorAndroidCaptureProcess(sessionKey, server, config)
}

func monitorAndroidCaptureProcess(sessionKey string, server *AndroidCaptureServer, config CaptureConfig) {
	const (
		normalPollInterval  = 1 * time.Second
		waitingPollInterval = 500 * time.Millisecond
	)

	timer := time.NewTimer(normalPollInterval)
	defer timer.Stop()

	waitingForRestart := false
	for {
		select {
		case <-server.MonitorStop:
			return
		case <-server.MonitorWake:
		case <-timer.C:
		}

		pid, found, err := QueryPidByProcessName(server.DeviceID, server.ProcessName)
		if err != nil {
			log.Printf("[AndroidCapture] Process monitor query failed for %s: %v", server.ProcessName, err)
			resetAndroidProcessMonitorTimer(timer, normalPollInterval)
			continue
		}

		androidServersMutex.RLock()
		current, ok := androidCaptureServers[sessionKey]
		running := ok && current == server && current.IsRunning
		oldPID := server.PID
		androidServersMutex.RUnlock()
		if !running {
			return
		}

		if !found {
			if !waitingForRestart {
				waitingForRestart = true
				androidServersMutex.Lock()
				if current, ok := androidCaptureServers[sessionKey]; ok && current == server {
					current.WaitingForRestart = true
				}
				androidServersMutex.Unlock()
				emitAndroidProcessEvent(config.EmitEvent, "androidCapture:processExited", server, map[string]interface{}{
					"oldPid": oldPID,
				})
				log.Printf("[AndroidCapture] Process %s (PID %d) exited; waiting for restart", server.ProcessName, oldPID)
			}
			resetAndroidProcessMonitorTimer(timer, waitingPollInterval)
			continue
		}

		if !waitingForRestart && pid == oldPID {
			resetAndroidProcessMonitorTimer(timer, normalPollInterval)
			continue
		}

		emitAndroidProcessEvent(config.EmitEvent, "androidCapture:processRestarting", server, map[string]interface{}{
			"oldPid": oldPID,
			"newPid": pid,
		})
		if err := reattachAndroidCaptureProcess(sessionKey, server, config, pid); err != nil {
			if !isAndroidCaptureServerActive(sessionKey, server) {
				return
			}
			log.Printf("[AndroidCapture] Failed to switch %s from PID %d to %d: %v", server.ProcessName, oldPID, pid, err)
			emitAndroidProcessEvent(config.EmitEvent, "androidCapture:processRestartFailed", server, map[string]interface{}{
				"oldPid": oldPID,
				"newPid": pid,
				"error":  err.Error(),
			})
			waitingForRestart = true
			resetAndroidProcessMonitorTimer(timer, waitingPollInterval)
			continue
		}

		switched := false
		androidServersMutex.Lock()
		if current, ok := androidCaptureServers[sessionKey]; ok && current == server && current.IsRunning {
			current.PID = pid
			current.WaitingForRestart = false
			current.PendingPID = 0
			current.PendingStartSeq = 0
			switched = true
		}
		androidServersMutex.Unlock()
		if !switched {
			return
		}

		emitAndroidProcessEvent(config.EmitEvent, "androidCapture:processRestarted", server, map[string]interface{}{
			"oldPid": oldPID,
			"newPid": pid,
		})
		log.Printf("[AndroidCapture] Automatically switched %s from PID %d to %d", server.ProcessName, oldPID, pid)
		waitingForRestart = false
		resetAndroidProcessMonitorTimer(timer, normalPollInterval)
	}
}

func isAndroidCaptureServerActive(sessionKey string, server *AndroidCaptureServer) bool {
	androidServersMutex.RLock()
	defer androidServersMutex.RUnlock()
	current, ok := androidCaptureServers[sessionKey]
	return ok && current == server && current.IsRunning
}

func resetAndroidProcessMonitorTimer(timer *time.Timer, interval time.Duration) {
	if !timer.Stop() {
		select {
		case <-timer.C:
		default:
		}
	}
	timer.Reset(interval)
}

func reattachAndroidCaptureProcess(sessionKey string, server *AndroidCaptureServer, config CaptureConfig, newPID int) error {
	androidServersMutex.Lock()
	current, ok := androidCaptureServers[sessionKey]
	if !ok || current != server || !current.IsRunning {
		androidServersMutex.Unlock()
		return fmt.Errorf("capture session stopped")
	}
	if current.PendingPID != newPID {
		current.PendingPID = newPID
		current.PendingStartSeq = current.NextConnectionSeq
	}
	connectionSeq := current.PendingStartSeq
	androidServersMutex.Unlock()

	if err := SetupReversePortForwardWithVerify(server.DeviceID, server.LocalPort); err != nil {
		return fmt.Errorf("failed to restore reverse port forward: %w", err)
	}

	agentLoaded, err := IsAgentLoaded(server.DeviceID, server.PackageName, newPID)
	if err != nil {
		return fmt.Errorf("failed to detect agent in new PID %d: %w", newPID, err)
	}

	jdwpPort := server.LocalPort + 1
	if !agentLoaded {
		agentMgr := NewAgentManager(config.AgentPath)
		if err := agentMgr.PushAgent(server.DeviceID, newPID); err != nil {
			return fmt.Errorf("failed to push agent for new PID %d: %w", newPID, err)
		}

		appAgentPath, copyErr := PushAgentToAppPrivateDir(server.DeviceID, server.PackageName)
		if copyErr != nil {
			log.Printf("[AndroidCapture] Warning: failed to copy agent for new PID %d: %v", newPID, copyErr)
			appAgentPath = DefaultAgentRemotePath
		}

		_ = RemovePortForward(server.DeviceID, jdwpPort)
		if err := SetupJDWPForward(server.DeviceID, jdwpPort, newPID); err != nil {
			return fmt.Errorf("failed to setup JDWP forward for new PID %d: %w", newPID, err)
		}

		attachErr := AttachAgentViaAM(server.DeviceID, newPID, appAgentPath)
		if attachErr != nil {
			log.Printf("[AndroidCapture] am attach-agent failed for new PID %d, trying JDWP: %v", newPID, attachErr)
			if err := AttachAgentViaJDWP(server.DeviceID, newPID, jdwpPort, appAgentPath); err != nil {
				return fmt.Errorf("failed to attach agent to new PID %d (AM: %v, JDWP: %w)", newPID, attachErr, err)
			}
		}
	}

	if !waitForAndroidAgentConnectionAfter(sessionKey, server, connectionSeq, 8*time.Second) {
		return fmt.Errorf("new PID %d did not connect within 8 seconds", newPID)
	}

	return restartAndroidWebViewSession(sessionKey, server, config, newPID)
}

func restartAndroidWebViewSession(sessionKey string, server *AndroidCaptureServer, config CaptureConfig, newPID int) error {
	androidServersMutex.Lock()
	oldWebView := server.WebViewSession
	server.WebViewSession = nil
	androidServersMutex.Unlock()
	if oldWebView != nil {
		oldWebView.Stop()
	}

	newConfig := config
	newConfig.PID = newPID
	newWebView := StartWebViewCDPSession(newConfig, server.CaptureRunID)
	androidServersMutex.Lock()
	if current, ok := androidCaptureServers[sessionKey]; ok && current == server && current.IsRunning {
		current.WebViewSession = newWebView
		androidServersMutex.Unlock()
	} else {
		androidServersMutex.Unlock()
		newWebView.Stop()
		return fmt.Errorf("capture session stopped")
	}
	return nil
}

func waitForAndroidAgentConnectionAfter(sessionKey string, server *AndroidCaptureServer, connectionSeq int64, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	for {
		androidServersMutex.RLock()
		current, ok := androidCaptureServers[sessionKey]
		connected := false
		if ok && current == server && current.IsRunning && current.NextConnectionSeq > connectionSeq {
			for _, client := range current.Clients {
				if client.IsConnected {
					connected = true
					break
				}
			}
		}
		androidServersMutex.RUnlock()
		if connected {
			return true
		}
		if time.Now().After(deadline) {
			return false
		}
		<-ticker.C
	}
}

func emitAndroidProcessEvent(emit EventEmitFunc, eventName string, server *AndroidCaptureServer, extra map[string]interface{}) {
	if emit == nil {
		return
	}
	data := map[string]interface{}{
		"deviceId":    server.DeviceID,
		"packageName": server.PackageName,
		"processName": server.ProcessName,
	}
	for key, value := range extra {
		data[key] = value
	}
	emit(eventName, data)
}

func waitForAndroidAgentConnection(sessionKey string, server *AndroidCaptureServer, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	for {
		androidServersMutex.RLock()
		current, ok := androidCaptureServers[sessionKey]
		connected := false
		if ok && current == server && current.IsRunning {
			for _, client := range current.Clients {
				if client.IsConnected {
					connected = true
					break
				}
			}
		}
		androidServersMutex.RUnlock()
		if connected {
			return true
		}
		if time.Now().After(deadline) {
			return false
		}
		<-ticker.C
	}
}

func acceptAndroidConnections(server *AndroidCaptureServer, emitEvent EventEmitFunc) {
	log.Printf("[AndroidCapture] acceptAndroidConnections started, listening on port %d", server.LocalPort)
	for {
		log.Printf("[AndroidCapture] Waiting for connection...")
		conn, err := server.Server.Accept()
		if err != nil {
			if server.IsRunning {
				log.Printf("[AndroidCapture] Accept error: %v", err)
			}
			return
		}

		log.Printf("[AndroidCapture] Accepted connection from: %s", conn.RemoteAddr().String())

		if tcpConn, ok := conn.(*net.TCPConn); ok {
			tcpConn.SetKeepAlive(true)
			tcpConn.SetKeepAlivePeriod(30 * time.Second)
			tcpConn.SetNoDelay(true)
		}

		sessionKey := fmt.Sprintf("%s:%s", server.DeviceID, server.PackageName)

		androidServersMutex.Lock()
		existing, ok := androidCaptureServers[sessionKey]
		if !ok || !existing.IsRunning {
			// Session was stopped between Accept() and now — discard this connection
			androidServersMutex.Unlock()
			log.Printf("[AndroidCapture] Discarding connection from %s (session stopped)", conn.RemoteAddr().String())
			conn.Close()
			continue
		}
		existing.NextConnectionSeq++
		connectionID := fmt.Sprintf("%d", existing.NextConnectionSeq)
		client := &ClientSession{
			Conn:         conn,
			DeviceID:     server.DeviceID,
			ConnectionID: connectionID,
			IsConnected:  true,
		}
		existing.Clients[connectionID] = client
		log.Printf("[AndroidCapture] Client added to session %s, total clients: %d", sessionKey, len(existing.Clients))
		androidServersMutex.Unlock()

		if emitEvent != nil {
			emitEvent("androidCapture:clientConnected", map[string]interface{}{
				"deviceId":    server.DeviceID,
				"packageName": server.PackageName,
			})
		}

		if configProvider := server.MockConfig; configProvider != nil {
			if err := pushMockConfigToClient(client, configProvider()); err != nil {
				log.Printf("[AndroidCapture] Failed to push initial mock config: %v", err)
			}
		}

		go readAndroidCaptureData(server, client, emitEvent)
	}
}

func readAndroidCaptureData(server *AndroidCaptureServer, client *ClientSession, emitEvent EventEmitFunc) {
	log.Printf("[AndroidCapture] readAndroidCaptureData started")
	scanner := bufio.NewScanner(client.Conn)
	const maxCapacity = 10 * 1024 * 1024
	buf := make([]byte, 0, 64*1024)
	scanner.Buffer(buf, maxCapacity)

	lineCount := 0

	for scanner.Scan() {
		line := scanner.Text()
		lineCount++
		log.Printf("[AndroidCapture] Received line %d: %s", lineCount, func() string {
			if len(line) > 200 {
				return line[:200] + "..."
			}
			return line
		}())

		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}

		var msg AgentMessage
		if err := json.Unmarshal([]byte(trimmed), &msg); err != nil {
			log.Printf("[AndroidCapture] Failed to parse JSON (line %d): %v", lineCount, err)
			continue
		}

		log.Printf("[AndroidCapture] Parsed message type: %s", msg.Type)

		if msg.Type == "heartbeat" {
			continue
		}

		if msg.Type == "agent_connected" {
			log.Printf("[AndroidCapture] Agent connected successfully!")
			continue
		}

		if msg.Type == "mock_debug" {
			log.Printf("[AndroidCapture][MockDebug] %v", msg.Data)
			continue
		}

		if msg.Type == "http_record" {
			request := convertToNetworkRequestForClient(&msg, server, client)
			if request != nil && emitEvent != nil {
				emitEvent("networkCapture:requestReceived", map[string]interface{}{
					"deviceId": server.DeviceID,
					"request":  request,
				})
			}
		}
	}

	if err := scanner.Err(); err != nil {
		log.Printf("[AndroidCapture] Scanner error: %v", err)
	}

	client.IsConnected = false
	if client.Conn != nil {
		client.Conn.Close()
	}

	if emitEvent != nil {
		emitEvent("androidCapture:clientDisconnected", map[string]interface{}{
			"deviceId":    server.DeviceID,
			"packageName": server.PackageName,
		})
	}
	select {
	case server.MonitorWake <- struct{}{}:
	default:
	}
}

func convertToNetworkRequest(msg *AgentMessage) map[string]interface{} {
	return convertToNetworkRequestForClient(msg, nil, nil)
}

func convertToNetworkRequestForClient(msg *AgentMessage, server *AndroidCaptureServer, client *ClientSession) map[string]interface{} {
	data, ok := msg.Data["request"].(map[string]interface{})
	if !ok {
		return nil
	}

	captureRunID := ""
	if server != nil {
		captureRunID = server.CaptureRunID
	}
	connectionID := ""
	if client != nil {
		connectionID = client.ConnectionID
	}

	result := map[string]interface{}{
		"id":        fmt.Sprintf("android-%d", msg.Timestamp),
		"timestamp": msg.Timestamp,
		"direction": "request",
	}

	if extra, ok := msg.Data["extra"].(map[string]interface{}); ok {
		if uid, ok := extra["uid"].(string); ok && uid != "" {
			result["id"] = buildAndroidRequestID(captureRunID, connectionID, uid)
		} else if id, ok := extra["id"]; ok {
			result["id"] = buildAndroidRequestID(captureRunID, connectionID, fmt.Sprintf("%v", id))
		}
	}

	if method, ok := data["method"].(string); ok {
		result["method"] = strings.ToUpper(method)
	} else {
		result["method"] = "GET"
	}

	if url, ok := data["url"].(string); ok {
		result["url"] = url
		result["fullUrl"] = url
	}
	if baseURL, ok := data["baseURL"].(string); ok {
		result["baseURL"] = baseURL
		if url, ok := result["url"].(string); ok {
			if !strings.HasPrefix(url, "http") {
				result["fullUrl"] = strings.TrimSuffix(baseURL, "/") + "/" + strings.TrimPrefix(url, "/")
			}
		}
	}

	if headers, ok := data["headers"].(map[string]interface{}); ok {
		result["requestHeaders"] = convertHeaders(headers)
	}

	if body, ok := data["body"].(string); ok {
		result["requestBody"] = body
	} else if bodyData, ok := data["data"]; ok {
		if bodyStr, ok := bodyData.(string); ok {
			result["requestBody"] = bodyStr
		} else if bodyBytes, err := json.Marshal(bodyData); err == nil {
			result["requestBody"] = string(bodyBytes)
		}
	}

	if respData, ok := msg.Data["response"].(map[string]interface{}); ok {
		result["direction"] = "response"

		if status, ok := respData["status"].(float64); ok {
			result["statusCode"] = int(status)
		}

		if respHeaders, ok := respData["headers"].(map[string]interface{}); ok {
			result["responseHeaders"] = convertHeaders(respHeaders)
		}

		if respBody, ok := respData["body"].(string); ok {
			result["responseBody"] = respBody
		} else if respBodyData, ok := respData["data"]; ok {
			if respBodyStr, ok := respBodyData.(string); ok {
				result["responseBody"] = respBodyStr
			} else if respBodyBytes, err := json.Marshal(respBodyData); err == nil {
				result["responseBody"] = string(respBodyBytes)
			}
		}
	}

	if extra, ok := msg.Data["extra"].(map[string]interface{}); ok {
		enrichedExtra := make(map[string]interface{}, len(extra)+2)
		for key, value := range extra {
			enrichedExtra[key] = value
		}
		if captureRunID != "" {
			enrichedExtra["captureRunId"] = captureRunID
		}
		if connectionID != "" {
			enrichedExtra["connectionId"] = connectionID
		}
		result["extra"] = enrichedExtra
	}

	return result
}

func buildAndroidRequestID(captureRunID, connectionID, requestID string) string {
	parts := []string{"android"}
	if captureRunID != "" {
		parts = append(parts, captureRunID)
	}
	if connectionID != "" {
		parts = append(parts, connectionID)
	}
	parts = append(parts, requestID)
	return strings.Join(parts, "-")
}

func convertHeaders(headers map[string]interface{}) map[string]string {
	result := make(map[string]string)
	for k, v := range headers {
		if str, ok := v.(string); ok {
			result[k] = str
		} else {
			result[k] = fmt.Sprintf("%v", v)
		}
	}
	return result
}

func defaultMockConfig(config interface{}) interface{} {
	if config != nil {
		return config
	}
	return map[string]interface{}{
		"enabled": false,
		"rules":   []interface{}{},
	}
}

func pushMockConfigToClient(client *ClientSession, config interface{}) error {
	if client == nil || !client.IsConnected || client.Conn == nil {
		return fmt.Errorf("android capture client is not connected")
	}

	packet := map[string]interface{}{
		"version":   1,
		"timestamp": time.Now().UnixMilli(),
		"type":      "mock_config_update",
		"data":      defaultMockConfig(config),
	}
	jsonData, err := json.Marshal(packet)
	if err != nil {
		return fmt.Errorf("failed to marshal Android mock config packet: %w", err)
	}

	client.mu.Lock()
	defer client.mu.Unlock()
	if _, err := client.Conn.Write(append(jsonData, '\n')); err != nil {
		client.IsConnected = false
		return fmt.Errorf("failed to write Android mock config packet: %w", err)
	}
	return nil
}

func PushMockConfigToAndroidCapture(deviceID, packageName string, config interface{}) error {
	sessionKey := fmt.Sprintf("%s:%s", deviceID, packageName)

	androidServersMutex.RLock()
	server, ok := androidCaptureServers[sessionKey]
	if !ok || server == nil || !server.IsRunning {
		androidServersMutex.RUnlock()
		return fmt.Errorf("android capture session not found: %s", sessionKey)
	}

	clients := make([]*ClientSession, 0, len(server.Clients))
	for _, client := range server.Clients {
		clients = append(clients, client)
	}
	webViewSession := server.WebViewSession
	androidServersMutex.RUnlock()

	webViewUpdated := false
	if webViewSession != nil {
		webViewSession.UpdateMockConfig(config)
		webViewUpdated = true
	}

	if len(clients) == 0 && !webViewUpdated {
		return fmt.Errorf("android capture session has no connected clients: %s", sessionKey)
	}

	successCount := 0
	var lastErr error
	for _, client := range clients {
		if err := pushMockConfigToClient(client, config); err != nil {
			lastErr = err
			continue
		}
		successCount++
	}
	if successCount == 0 && !webViewUpdated {
		if lastErr != nil {
			return lastErr
		}
		return fmt.Errorf("android mock config push failed: no connected clients")
	}
	log.Printf("[AndroidCapture] Mock config pushed to %s (%d agent clients, WebView=%v)",
		sessionKey, successCount, webViewUpdated)
	return nil
}

func StopAndroidCapture(deviceID, packageName string) error {
	sessionKey := fmt.Sprintf("%s:%s", deviceID, packageName)

	androidServersMutex.Lock()
	defer androidServersMutex.Unlock()

	server, ok := androidCaptureServers[sessionKey]
	if !ok {
		return fmt.Errorf("capture session not found: %s", sessionKey)
	}

	cleanupAndroidCaptureServerLocked(sessionKey, server, true)

	log.Printf("[AndroidCapture] Stopped capture for %s", sessionKey)
	return nil
}

func GetAndroidCaptureStatus(deviceID, packageName string) map[string]interface{} {
	sessionKey := fmt.Sprintf("%s:%s", deviceID, packageName)

	androidServersMutex.RLock()
	defer androidServersMutex.RUnlock()

	server, ok := androidCaptureServers[sessionKey]
	if !ok {
		log.Printf("[AndroidCapture] GetStatus: session %s not found", sessionKey)
		return map[string]interface{}{
			"isCapturing": false,
			"packageName": packageName,
		}
	}

	connectedCount := 0
	for id, client := range server.Clients {
		log.Printf("[AndroidCapture] GetStatus: client %s, isConnected=%v", id, client.IsConnected)
		if client.IsConnected {
			connectedCount++
		}
	}

	log.Printf("[AndroidCapture] GetStatus: session %s, isRunning=%v, clients=%d, connected=%d",
		sessionKey, server.IsRunning, len(server.Clients), connectedCount)

	return map[string]interface{}{
		"isCapturing":       server.IsRunning && !server.WaitingForRestart,
		"waitingForRestart": server.WaitingForRestart,
		"packageName":       server.PackageName,
		"processName":       server.ProcessName,
		"pid":               server.PID,
		"localPort":         server.LocalPort,
		"connectedCount":    connectedCount,
	}
}

func StopAllAndroidCaptures(deviceID string) int {
	androidServersMutex.Lock()
	defer androidServersMutex.Unlock()

	count := 0
	for key, server := range androidCaptureServers {
		if server.DeviceID == deviceID {
			cleanupAndroidCaptureServerLocked(key, server, true)
			count++
		}
	}

	return count
}

// StopAndroidCapturesByPort 清理占用指定本地端口的所有 Android 抓包会话。
// 本地监听端口是进程级资源，不能只按当前 deviceID 清理，否则设备重新连接后
// connectKey 变化会让旧会话继续占用端口。
func StopAndroidCapturesByPort(localPort int) int {
	androidServersMutex.Lock()
	defer androidServersMutex.Unlock()

	count := 0
	for key, server := range androidCaptureServers {
		if server.LocalPort == localPort {
			cleanupAndroidCaptureServerLocked(key, server, true)
			count++
		}
	}
	return count
}

func cleanupAndroidCaptureServerLocked(sessionKey string, server *AndroidCaptureServer, removeForwards bool) {
	if server == nil {
		delete(androidCaptureServers, sessionKey)
		return
	}

	server.IsRunning = false
	server.MonitorStopOnce.Do(func() {
		if server.MonitorStop != nil {
			close(server.MonitorStop)
		}
	})
	for _, client := range server.Clients {
		client.IsConnected = false
		if client.Conn != nil {
			client.Conn.Close()
		}
	}
	if server.Server != nil {
		server.Server.Close()
	}
	if server.WebViewSession != nil {
		server.WebViewSession.Stop()
		server.WebViewSession = nil
	}

	if removeForwards {
		agentPort := server.LocalPort
		jdwpPort := server.LocalPort + 1
		if err := RemovePortForward(server.DeviceID, jdwpPort); err != nil {
			log.Printf("[AndroidCapture] Failed to remove JDWP port forward tcp:%d: %v", jdwpPort, err)
		}
		if err := RemoveReversePortForward(server.DeviceID, agentPort); err != nil {
			log.Printf("[AndroidCapture] Failed to remove reverse port forward tcp:%d: %v", agentPort, err)
		}
	}

	delete(androidCaptureServers, sessionKey)
}
