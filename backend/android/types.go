package android

import (
	"net"
	"sync"
)

const (
	JDWPHandshake = "JDWP-Handshake"

	CommandSetVirtualMachine = 1
	CommandLoadAgent         = 15
	CommandVersion           = 1

	ReplyNoError = 0
)

type JDWPCommand struct {
	ID         int32
	Flags      byte
	CommandSet byte
	Command    byte
	Data       []byte
}

type JDWPReply struct {
	ID        int32
	Flags     byte
	ErrorCode int16
	Data      []byte
}

type AndroidApp struct {
	PackageName string `json:"packageName"`
	ProcessName string `json:"processName"`
	PID         int    `json:"pid"`
	Name        string `json:"name"`
	Debuggable  bool   `json:"debuggable"`
}

type AndroidCaptureSession struct {
	DeviceID    string
	PackageName string
	PID         int
	LocalPort   int
	AgentPath   string
	IsCapturing bool
	Conn        net.Conn
}

type AgentMessage struct {
	Version   int                    `json:"version"`
	Type      string                 `json:"type"`
	Timestamp int64                  `json:"timestamp"`
	Data      map[string]interface{} `json:"data"`
}

type ClientSession struct {
	Conn         net.Conn
	DeviceID     string
	ConnectionID string
	IsConnected  bool
	mu           sync.Mutex
}

type AndroidCaptureServer struct {
	DeviceID          string
	PackageName       string
	ProcessName       string
	PID               int
	LocalPort         int
	Server            net.Listener
	IsRunning         bool
	WaitingForRestart bool
	Clients           map[string]*ClientSession
	MockConfig        MockConfigProviderFunc
	WebViewSession    *WebViewCDPSession
	CaptureRunID      string
	NextConnectionSeq int64
	PendingPID        int
	PendingStartSeq   int64
	MonitorWake       chan struct{}
	MonitorStop       chan struct{}
	MonitorStopOnce   sync.Once
}
