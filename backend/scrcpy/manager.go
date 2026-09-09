package scrcpy

import (
	"context"
	"encoding/base64"
	"fmt"
	"log"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type Session struct {
	DeviceID        string
	server          *Server
	video           *VideoStream
	control         *ControlChannel
	mu              sync.Mutex
	running         bool
	onError         func(error)
	avcConfigRecord []byte // cached AVCDecoderConfigurationRecord built from SPS+PPS
}

type Manager struct {
	sessions map[string]*Session
	mu       sync.RWMutex
}

var defaultManager *Manager
var managerOnce sync.Once

func GetManager() *Manager {
	managerOnce.Do(func() {
		defaultManager = &Manager{
			sessions: make(map[string]*Session),
		}
	})
	return defaultManager
}

func (m *Manager) StartMirror(ctx context.Context, deviceID string, opts Options, onError func(error)) (*CodecMetadata, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if session, exists := m.sessions[deviceID]; exists {
		if session.running {
			log.Printf("[Scrcpy Manager] Session already running for device: %s", deviceID)
			return session.server.CodecMeta(), nil
		}
		delete(m.sessions, deviceID)
	}

	server := NewServer(deviceID, opts)
	session := &Session{
		DeviceID: deviceID,
		server:   server,
		onError:  onError,
	}

	m.sessions[deviceID] = session

	log.Printf("[Scrcpy Manager] Starting mirror for device: %s", deviceID)

	if err := server.Start(ctx); err != nil {
		delete(m.sessions, deviceID)
		return nil, fmt.Errorf("failed to start scrcpy server: %w", err)
	}

	session.video = NewVideoStream(server.VideoConn(), server.CodecMeta())
	session.control = NewControlChannel(server.ControlConn())

	if codec := server.CodecMeta(); codec != nil {
		session.control.SetScreenSize(uint16(codec.Width), uint16(codec.Height))
	}

	session.running = true

	log.Printf("[Scrcpy Manager] Mirror started successfully for device: %s", deviceID)
	return server.CodecMeta(), nil
}

func (m *Manager) StopMirror(deviceID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	session, exists := m.sessions[deviceID]
	if !exists {
		log.Printf("[Scrcpy Manager] No session found for device: %s", deviceID)
		return nil
	}

	log.Printf("[Scrcpy Manager] Stopping mirror for device: %s", deviceID)

	session.mu.Lock()
	session.running = false
	session.mu.Unlock()

	if session.video != nil {
		session.video.Close()
	}
	if session.control != nil {
		session.control.Close()
	}
	if session.server != nil {
		session.server.Stop()
	}

	delete(m.sessions, deviceID)
	log.Printf("[Scrcpy Manager] Session removed for device: %s", deviceID)
	return nil
}

func (m *Manager) ReadFrame(deviceID string) (*VideoFrame, error) {
	m.mu.RLock()
	session, exists := m.sessions[deviceID]
	m.mu.RUnlock()

	if !exists {
		return nil, fmt.Errorf("no session for device: %s", deviceID)
	}

	return session.video.ReadFrame()
}

func (m *Manager) GetControlChannel(deviceID string) *ControlChannel {
	m.mu.RLock()
	session, exists := m.sessions[deviceID]
	m.mu.RUnlock()

	if !exists {
		return nil
	}
	return session.control
}

func (m *Manager) GetCodecMeta(deviceID string) *CodecMetadata {
	m.mu.RLock()
	session, exists := m.sessions[deviceID]
	m.mu.RUnlock()

	if !exists {
		return nil
	}
	return session.server.CodecMeta()
}

func (m *Manager) IsRunning(deviceID string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if session, exists := m.sessions[deviceID]; exists {
		return session.running
	}
	return false
}

func (m *Manager) StopAll() {
	m.mu.Lock()
	defer m.mu.Unlock()

	for deviceID, session := range m.sessions {
		log.Printf("[Scrcpy Manager] Stopping session for device: %s", deviceID)
		if session.video != nil {
			session.video.Close()
		}
		if session.control != nil {
			session.control.Close()
		}
		if session.server != nil {
			session.server.Stop()
		}
		delete(m.sessions, deviceID)
	}
}

func EmitCodecMeta(deviceID string, codec *CodecMetadata) {
	app := application.Get()
	if app == nil || codec == nil {
		return
	}

	app.Event.Emit("screenMirror:codec", map[string]interface{}{
		"deviceSn":  deviceID,
		"transport": "h264",
		"codecId":   codec.CodecID,
		"width":     codec.Width,
		"height":    codec.Height,
	})
}

// EmitFrame converts H.264 Annex B data to AVCC format and emits to the frontend.
// Config frames are converted to AVCDecoderConfigurationRecord.
// Regular frames are converted from Annex B to AVCC (4-byte length-prefixed NALUs).
func (m *Manager) EmitFrame(deviceID string, frame *VideoFrame) {
	app := application.Get()
	if app == nil {
		log.Printf("[EmitFrame] ERROR: app is nil")
		return
	}

	if frame.Config {
		record, err := BuildAVCDecoderConfigRecord(frame.Data)
		if err != nil {
			log.Printf("[EmitFrame] ERROR: failed to build AVCDecoderConfigRecord for %s: %v", deviceID, err)
			return
		}

		m.mu.RLock()
		session := m.sessions[deviceID]
		m.mu.RUnlock()
		if session != nil {
			session.mu.Lock()
			session.avcConfigRecord = record
			session.mu.Unlock()
		}

		log.Printf("[EmitFrame] Config frame: deviceSn=%s, raw=%d bytes, record=%d bytes", deviceID, len(frame.Data), len(record))

		app.Event.Emit("screenMirror:frame", map[string]interface{}{
			"deviceSn":   deviceID,
			"transport":  "h264",
			"data":       base64.StdEncoding.EncodeToString(record),
			"isKeyframe": frame.KeyFrame,
			"isConfig":   true,
			"pts":        frame.PTS,
		})
		return
	}

	avccData, bitstreamKeyframe := AnnexBToAVCC(frame.Data)
	isKeyframe := frame.KeyFrame || bitstreamKeyframe

	app.Event.Emit("screenMirror:frame", map[string]interface{}{
		"deviceSn":   deviceID,
		"transport":  "h264",
		"data":       base64.StdEncoding.EncodeToString(avccData),
		"isKeyframe": isKeyframe,
		"isConfig":   false,
		"pts":        frame.PTS,
	})
}

// EmitFrame is the package-level wrapper that delegates to the default manager.
func EmitFrame(deviceID string, frame *VideoFrame) {
	GetManager().EmitFrame(deviceID, frame)
}

func EmitError(deviceID string, errMsg string) {
	app := application.Get()
	if app == nil {
		return
	}

	app.Event.Emit("screenMirror:error", map[string]interface{}{
		"deviceSn": deviceID,
		"error":    errMsg,
	})
}
