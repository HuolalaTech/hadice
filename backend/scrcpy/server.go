package scrcpy

import (
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"log"
	"math/rand"
	"net"
	"os/exec"
	"runtime"
	"sync"
	"time"

	"Hadice/backend/adb"
)

type Server struct {
	deviceID  string
	scid      int64
	localPort int
	opts      Options

	videoConn   net.Conn
	controlConn net.Conn

	cmd    *exec.Cmd
	cancel context.CancelFunc
	mu     sync.Mutex

	codecMeta  *CodecMetadata
	deviceName string

	running bool
}

func NewServer(deviceID string, opts Options) *Server {
	return &Server{
		deviceID:  deviceID,
		scid:      rand.Int63() & 0x7FFFFFFF,
		localPort: 27183 + int(rand.Int31n(1000)),
		opts:      opts,
	}
}

func (s *Server) Start(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.running {
		return fmt.Errorf("server already running")
	}

	ctx, cancel := context.WithCancel(ctx)
	s.cancel = cancel

	log.Printf("[Scrcpy Server] Starting for device: %s, scid: %d", s.deviceID, s.scid)

	// 0. Kill any leftover scrcpy server processes on device
	// (killing local adb shell does NOT guarantee the device-side app_process dies)
	s.killStaleServer()
	time.Sleep(300 * time.Millisecond)

	// 1. Push scrcpy-server to device
	if err := s.pushServer(ctx); err != nil {
		cancel()
		return fmt.Errorf("push server failed: %w", err)
	}

	// 2. Start server process on device FIRST, so the abstract socket is created
	if err := s.startServerProcess(ctx); err != nil {
		cancel()
		return fmt.Errorf("start server process failed: %w", err)
	}

	// 3. Wait for server to initialize (JVM startup + socket creation)
	time.Sleep(500 * time.Millisecond)

	// 4. Setup port forwarding AFTER server is running and socket is created
	if err := s.setupForward(ctx); err != nil {
		s.stopProcess()
		cancel()
		return fmt.Errorf("setup forward failed: %w", err)
	}

	// 5. Connect video and control sockets (has built-in retry)
	if err := s.connectSockets(ctx); err != nil {
		s.stopProcess()
		s.removeForward()
		cancel()
		return fmt.Errorf("connect sockets failed: %w", err)
	}

	s.running = true
	log.Printf("[Scrcpy Server] Started successfully for device: %s", s.deviceID)
	return nil
}

func (s *Server) pushServer(ctx context.Context) error {
	serverPath := GetScrcpyServerPath()
	if serverPath == "" {
		return fmt.Errorf("scrcpy-server path not set")
	}

	log.Printf("[Scrcpy Server] Pushing server from: %s", serverPath)

	adbPath := adb.GetAdbPath()
	args := []string{"-s", s.deviceID, "push", serverPath, "/data/local/tmp/scrcpy-server"}

	cmd := exec.CommandContext(ctx, adbPath, args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("adb push failed: %v, output: %s", err, string(output))
	}

	log.Printf("[Scrcpy Server] Server pushed successfully")
	return nil
}

func (s *Server) setupForward(ctx context.Context) error {
	adbPath := adb.GetAdbPath()
	socketName := fmt.Sprintf("scrcpy_%x", s.scid)
	args := []string{"-s", s.deviceID, "forward",
		fmt.Sprintf("tcp:%d", s.localPort),
		fmt.Sprintf("localabstract:%s", socketName)}

	cmd := exec.CommandContext(ctx, adbPath, args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("adb forward failed: %v, output: %s", err, string(output))
	}

	log.Printf("[Scrcpy Server] Port forward setup: tcp:%d -> localabstract:%s", s.localPort, socketName)
	return nil
}

func (s *Server) startServerProcess(ctx context.Context) error {
	adbPath := adb.GetAdbPath()

	serverArgs := s.opts.ToServerArgs(s.scid)
	args := []string{"-s", s.deviceID, "shell",
		"CLASSPATH=/data/local/tmp/scrcpy-server",
		"app_process", "/", "com.genymobile.scrcpy.Server"}
	args = append(args, serverArgs...)

	log.Printf("[Scrcpy Server] Starting server with args: %v", args)

	s.cmd = exec.CommandContext(ctx, adbPath, args...)

	stdout, err := s.cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("failed to create stdout pipe: %w", err)
	}

	stderr, err := s.cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("failed to create stderr pipe: %w", err)
	}

	if runtime.GOOS == "windows" {
		s.hideWindow()
	}

	if err := s.cmd.Start(); err != nil {
		return fmt.Errorf("failed to start server process: %w", err)
	}

	go func() {
		buf := make([]byte, 1024)
		for {
			n, err := stdout.Read(buf)
			if err != nil {
				return
			}
			log.Printf("[Scrcpy Server stdout] %s", string(buf[:n]))
		}
	}()

	go func() {
		buf := make([]byte, 1024)
		for {
			n, err := stderr.Read(buf)
			if err != nil {
				return
			}
			log.Printf("[Scrcpy Server stderr] %s", string(buf[:n]))
		}
	}()

	return nil
}

func (s *Server) connectSockets(ctx context.Context) error {
	addr := fmt.Sprintf("127.0.0.1:%d", s.localPort)
	log.Printf("[Scrcpy Server] Connecting to sockets at: %s", addr)

	s.videoConn = nil
	s.controlConn = nil

	var videoErr error
	for i := 0; i < 15; i++ {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		s.videoConn, videoErr = net.DialTimeout("tcp", addr, 2*time.Second)
		if videoErr == nil {
			log.Printf("[Scrcpy Server] Video socket connected on attempt %d", i+1)
			break
		}
		log.Printf("[Scrcpy Server] Video socket connection attempt %d failed: %v", i+1, videoErr)
		time.Sleep(300 * time.Millisecond)
	}
	if videoErr != nil {
		return fmt.Errorf("failed to connect video socket after 15 attempts: %w", videoErr)
	}

	time.Sleep(300 * time.Millisecond)

	var controlErr error
	for i := 0; i < 15; i++ {
		select {
		case <-ctx.Done():
			s.videoConn.Close()
			s.videoConn = nil
			return ctx.Err()
		default:
		}

		s.controlConn, controlErr = net.DialTimeout("tcp", addr, 2*time.Second)
		if controlErr == nil {
			log.Printf("[Scrcpy Server] Control socket connected on attempt %d", i+1)
			break
		}
		log.Printf("[Scrcpy Server] Control socket connection attempt %d failed: %v", i+1, controlErr)
		time.Sleep(300 * time.Millisecond)
	}
	if controlErr != nil {
		s.videoConn.Close()
		s.videoConn = nil
		return fmt.Errorf("failed to connect control socket after 15 attempts: %w", controlErr)
	}

	if err := s.readDeviceMeta(); err != nil {
		log.Printf("[Scrcpy Server] Warning: failed to read device meta: %v", err)
	}

	if err := s.readCodecMeta(); err != nil {
		log.Printf("[Scrcpy Server] Failed to read codec meta: %v, closing sockets", err)
		s.videoConn.Close()
		s.controlConn.Close()
		s.videoConn = nil
		s.controlConn = nil
		return fmt.Errorf("failed to read codec metadata: %w", err)
	}

	log.Printf("[Scrcpy Server] Sockets connected successfully")
	return nil
}

func (s *Server) readDeviceMeta() error {
	s.videoConn.SetReadDeadline(time.Now().Add(10 * time.Second))
	defer s.videoConn.SetReadDeadline(time.Time{})

	dummyBuf := make([]byte, 1)
	if _, err := io.ReadFull(s.videoConn, dummyBuf); err != nil {
		return fmt.Errorf("read dummy byte: %w", err)
	}
	log.Printf("[Scrcpy Server] Dummy byte received: 0x%02x", dummyBuf[0])

	nameBuf := make([]byte, 64)
	if _, err := io.ReadFull(s.videoConn, nameBuf); err != nil {
		return fmt.Errorf("read device name: %w", err)
	}

	var nameEnd int
	for i := 0; i < 64; i++ {
		if nameBuf[i] == 0 {
			nameEnd = i
			break
		}
	}
	if nameEnd == 0 {
		nameEnd = 64
	}
	s.deviceName = string(nameBuf[:nameEnd])
	log.Printf("[Scrcpy Server] Device name: %q (len: %d)", s.deviceName, nameEnd)

	return nil
}

func (s *Server) readCodecMeta() error {
	s.videoConn.SetReadDeadline(time.Now().Add(5 * time.Second))
	defer s.videoConn.SetReadDeadline(time.Time{})

	buf := make([]byte, 12)
	if _, err := io.ReadFull(s.videoConn, buf); err != nil {
		return fmt.Errorf("read codec metadata: %w", err)
	}

	log.Printf("[Scrcpy Server] Codec metadata bytes: %x", buf)

	codecStr := string(buf[0:4])
	width := binary.BigEndian.Uint32(buf[4:8])
	height := binary.BigEndian.Uint32(buf[8:12])

	var codecID uint32
	switch codecStr {
	case "h264":
		codecID = 0
	case "h265":
		codecID = 1
	case "av01":
		codecID = 2
	default:
		codecID = 0
	}

	s.codecMeta = &CodecMetadata{
		CodecID: codecID,
		Width:   width,
		Height:  height,
	}

	log.Printf("[Scrcpy Server] Codec: %s (id: %d), Size: %dx%d",
		codecStr, codecID, width, height)
	return nil
}

func (s *Server) Stop() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if !s.running {
		return nil
	}

	log.Printf("[Scrcpy Server] Stopping for device: %s", s.deviceID)

	if s.videoConn != nil {
		s.videoConn.Close()
		s.videoConn = nil
	}

	if s.controlConn != nil {
		s.controlConn.Close()
		s.controlConn = nil
	}

	s.stopProcess()
	s.removeForward()

	if s.cancel != nil {
		s.cancel()
		s.cancel = nil
	}

	s.running = false
	log.Printf("[Scrcpy Server] Stopped for device: %s", s.deviceID)
	return nil
}

func (s *Server) stopProcess() {
	if s.cmd != nil && s.cmd.Process != nil {
		s.cmd.Process.Kill()
		s.cmd.Wait()
		s.cmd = nil
	}
	// Also kill device-side server process to release encoder resources
	s.killStaleServer()
}

// killStaleServer kills any leftover scrcpy server processes on the device.
// Killing the local adb shell process does NOT guarantee the device-side app_process dies.
func (s *Server) killStaleServer() {
	adbPath := adb.GetAdbPath()
	args := []string{"-s", s.deviceID, "shell",
		"pkill -f com.genymobile.scrcpy.Server || true"}
	cmd := exec.Command(adbPath, args...)
	cmd.CombinedOutput()
	log.Printf("[Scrcpy Server] Killed stale server processes on device: %s", s.deviceID)
}

func (s *Server) removeForward() {
	adbPath := adb.GetAdbPath()
	args := []string{"-s", s.deviceID, "forward",
		"--remove", fmt.Sprintf("tcp:%d", s.localPort)}

	cmd := exec.Command(adbPath, args...)
	cmd.Run()

	log.Printf("[Scrcpy Server] Removed forward: tcp:%d", s.localPort)
}

func (s *Server) VideoConn() net.Conn {
	return s.videoConn
}

func (s *Server) ControlConn() net.Conn {
	return s.controlConn
}

func (s *Server) CodecMeta() *CodecMetadata {
	return s.codecMeta
}

func (s *Server) DeviceName() string {
	return s.deviceName
}

func (s *Server) IsRunning() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.running
}

func (s *Server) hideWindow() {
	if runtime.GOOS != "windows" {
		return
	}
}
