package android

import (
	"bufio"
	"encoding/json"
	"net"
	"sync"
	"testing"
	"time"
)

func TestPushMockConfigToAndroidCaptureWritesUpdatePacket(t *testing.T) {
	agentConn, desktopConn := net.Pipe()
	defer agentConn.Close()
	defer desktopConn.Close()

	sessionKey := "device-1:com.example.app"
	androidServersMutex.Lock()
	androidCaptureServers = map[string]*AndroidCaptureServer{
		sessionKey: {
			DeviceID:    "device-1",
			PackageName: "com.example.app",
			IsRunning:   true,
			Clients: map[string]*ClientSession{
				"device-1": {
					Conn:        desktopConn,
					DeviceID:    "device-1",
					IsConnected: true,
				},
			},
		},
	}
	androidServersMutex.Unlock()
	defer func() {
		androidServersMutex.Lock()
		androidCaptureServers = map[string]*AndroidCaptureServer{}
		androidServersMutex.Unlock()
	}()

	config := map[string]interface{}{
		"enabled": true,
		"rules": []interface{}{
			map[string]interface{}{"id": "rule-1", "enabled": true},
		},
	}

	errCh := make(chan error, 1)
	go func() {
		errCh <- PushMockConfigToAndroidCapture("device-1", "com.example.app", config)
	}()

	line, err := bufio.NewReader(agentConn).ReadString('\n')
	if err != nil {
		t.Fatalf("failed to read pushed packet: %v", err)
	}
	if err := <-errCh; err != nil {
		t.Fatalf("PushMockConfigToAndroidCapture returned error: %v", err)
	}

	var packet map[string]interface{}
	if err := json.Unmarshal([]byte(line), &packet); err != nil {
		t.Fatalf("packet is not valid JSON: %v", err)
	}
	if packet["type"] != "mock_config_update" {
		t.Fatalf("type = %v, want mock_config_update", packet["type"])
	}
	if packet["version"].(float64) != 1 {
		t.Fatalf("version = %v, want 1", packet["version"])
	}
	data := packet["data"].(map[string]interface{})
	if data["enabled"] != true {
		t.Fatalf("data.enabled = %v, want true", data["enabled"])
	}
}

func TestPushMockConfigToAndroidCaptureReturnsErrorWhenSessionMissing(t *testing.T) {
	androidServersMutex.Lock()
	androidCaptureServers = map[string]*AndroidCaptureServer{}
	androidServersMutex.Unlock()

	err := PushMockConfigToAndroidCapture("missing-device", "missing.package", map[string]interface{}{})
	if err == nil {
		t.Fatal("expected error for missing Android capture session")
	}
}

func TestConvertToNetworkRequestIncludesCaptureConnectionInID(t *testing.T) {
	server := &AndroidCaptureServer{
		DeviceID:     "device-1",
		PackageName:  "com.example.app",
		CaptureRunID: "run-1",
	}
	client := &ClientSession{
		DeviceID:     "device-1",
		ConnectionID: "conn-2",
	}

	msg := &AgentMessage{
		Type:      "http_record",
		Timestamp: 1234,
		Data: map[string]interface{}{
			"extra": map[string]interface{}{
				"id":  float64(1),
				"uid": "req-1",
			},
			"request": map[string]interface{}{
				"method": "GET",
				"url":    "https://example.test/api",
			},
		},
	}

	request := convertToNetworkRequestForClient(msg, server, client)
	if request == nil {
		t.Fatal("request is nil")
	}
	if request["id"] != "android-run-1-conn-2-req-1" {
		t.Fatalf("id = %v, want android-run-1-conn-2-req-1", request["id"])
	}
	extra := request["extra"].(map[string]interface{})
	if extra["captureRunId"] != "run-1" {
		t.Fatalf("extra.captureRunId = %v, want run-1", extra["captureRunId"])
	}
	if extra["connectionId"] != "conn-2" {
		t.Fatalf("extra.connectionId = %v, want conn-2", extra["connectionId"])
	}
}

func TestCleanupAndroidCaptureServerRemovesSessionAndClosesResources(t *testing.T) {
	agentConn, desktopConn := net.Pipe()
	defer agentConn.Close()

	listener := &fakeAndroidCaptureListener{}

	sessionKey := "device-1:com.example.app"
	server := &AndroidCaptureServer{
		DeviceID:    "device-1",
		PackageName: "com.example.app",
		IsRunning:   true,
		Server:      listener,
		Clients: map[string]*ClientSession{
			"conn-1": {
				Conn:        desktopConn,
				DeviceID:    "device-1",
				IsConnected: true,
			},
		},
	}

	androidServersMutex.Lock()
	androidCaptureServers = map[string]*AndroidCaptureServer{sessionKey: server}
	cleanupAndroidCaptureServerLocked(sessionKey, server, false)
	_, stillPresent := androidCaptureServers[sessionKey]
	androidServersMutex.Unlock()

	if stillPresent {
		t.Fatal("session was not removed")
	}
	if server.IsRunning {
		t.Fatal("server is still marked running")
	}
	if server.Clients["conn-1"].IsConnected {
		t.Fatal("client is still marked connected")
	}
	if !listener.closed {
		t.Fatal("listener was not closed")
	}
}

type fakeAndroidCaptureListener struct {
	mu     sync.Mutex
	closed bool
}

func (l *fakeAndroidCaptureListener) Accept() (net.Conn, error) {
	for {
		l.mu.Lock()
		closed := l.closed
		l.mu.Unlock()
		if closed {
			return nil, net.ErrClosed
		}
		time.Sleep(time.Millisecond)
	}
}

func (l *fakeAndroidCaptureListener) Close() error {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.closed = true
	return nil
}

func (l *fakeAndroidCaptureListener) Addr() net.Addr {
	return fakeAndroidCaptureAddr("fake")
}

type fakeAndroidCaptureAddr string

func (a fakeAndroidCaptureAddr) Network() string { return string(a) }
func (a fakeAndroidCaptureAddr) String() string  { return string(a) }
