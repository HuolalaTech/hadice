package hypium

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"Hadice/backend/hdc"
	"Hadice/backend/hypium/scrcpyproto"
	"Hadice/backend/scrcpy"

	"google.golang.org/grpc"
)

const (
	harmonyScreenExtension = "libscreen_casting.z.so"
	harmonyScreenRemote    = "/data/local/tmp/" + harmonyScreenExtension
	harmonyScreenPort      = 5000
	harmonyScreenFPS       = 60
	harmonyScreenBitRate   = 30 * 1024 * 1024
)

type H264Frame struct {
	Data       []byte
	IsConfig   bool
	IsKeyframe bool
	PTS        int64
}

// H264Capture 管理 HarmonyOS 录屏扩展及 ScrcpyService gRPC 流。
type H264Capture struct {
	device       *Device
	localPort    int
	remoteAddr   string
	serverPath   string
	conn         *grpc.ClientConn
	client       scrcpyproto.ScrcpyServiceClient
	streamCtx    context.Context
	cancel       context.CancelFunc
	dispatchStop chan struct{}
	queue        chan H264Frame
	callback     func(H264Frame)
	mu           sync.Mutex
	stopped      bool
	configSent   bool
	startedAt    time.Time
}

func NewH264Capture(device *Device) *H264Capture {
	return &H264Capture{
		device:       device,
		dispatchStop: make(chan struct{}),
		queue:        make(chan H264Frame, 1),
	}
}

func (c *H264Capture) findServerPath() string {
	resourcesDir := hdc.GetResourcesDir()
	platformDir := filepath.Join("assets", runtime.GOOS, runtime.GOARCH, "bin")
	paths := []string{}
	if resourcesDir != "" {
		paths = append(paths,
			filepath.Join(resourcesDir, "screen-mirror", "libscrcpy_server.z.so"),
			filepath.Join(resourcesDir, "screen-mirror", "libscrcpy_server_old.z.so"),
		)
	}
	if cwd, err := os.Getwd(); err == nil {
		paths = append(paths,
			filepath.Join(cwd, platformDir, "screen-mirror", "libscrcpy_server.z.so"),
			filepath.Join(cwd, platformDir, "screen-mirror", "libscrcpy_server_old.z.so"),
			filepath.Join(cwd, "assets", runtime.GOOS, runtime.GOARCH, "bin", "screen-mirror", "libscrcpy_server.z.so"),
			filepath.Join(cwd, "assets", runtime.GOOS, runtime.GOARCH, "bin", "screen-mirror", "libscrcpy_server_old.z.so"),
		)
	}
	for _, path := range paths {
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			return path
		}
	}
	return ""
}

func (c *H264Capture) startExtension() error {
	if c.serverPath == "" {
		return fmt.Errorf("未找到 HarmonyOS H.264 录屏扩展")
	}
	if err := c.device.pushFile(c.serverPath, harmonyScreenRemote); err != nil {
		return fmt.Errorf("推送 H.264 录屏扩展失败: %w", err)
	}
	if result, err := hdc.ExecuteHdc([]string{"-t", c.device.deviceSn, "shell", "chmod", "755", harmonyScreenRemote}); err != nil || !result.Success {
		return fmt.Errorf("设置 H.264 录屏扩展权限失败: %v", err)
	}

	// 同一设备只保留当前屏幕扩展，避免上一轮异常退出占用编码器。
	c.stopExtension()
	args := []string{
		"-t", c.device.deviceSn, "shell", "uitest", "start-daemon", "singleness",
		"--extension-name", harmonyScreenExtension,
		"-scale", "1",
		"-frameRate", strconv.Itoa(harmonyScreenFPS),
		"-bitRate", strconv.Itoa(harmonyScreenBitRate),
		"-p", strconv.Itoa(harmonyScreenPort),
		"-screenId", "0",
		"-encodeType", "0",
		"-iFrameInterval", "500",
		"-repeatInterval", "16",
	}
	if _, err := hdc.ExecuteHdc(args); err != nil {
		return fmt.Errorf("启动 H.264 录屏扩展失败: %w", err)
	}
	for i := 0; i < 50; i++ {
		result, err := hdc.ExecuteHdc([]string{"-t", c.device.deviceSn, "shell", "grep", "-q", "scrcpy_grpc_socket", "/proc/net/unix"})
		if err == nil && result.Success {
			return nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	return fmt.Errorf("等待 scrcpy_grpc_socket 超时")
}

func (c *H264Capture) stopExtension() {
	result, err := hdc.ExecuteHdc([]string{"-t", c.device.deviceSn, "shell", "ps", "-ef"})
	if err == nil && result.Success {
		for _, line := range strings.Split(result.Output, "\n") {
			if !strings.Contains(line, "uitest start-daemon singleness") || !strings.Contains(line, harmonyScreenExtension) {
				continue
			}
			fields := strings.Fields(line)
			if len(fields) > 1 {
				_, _ = hdc.ExecuteHdc([]string{"-t", c.device.deviceSn, "shell", "kill", "-9", fields[1]})
			}
		}
	}
}

func (c *H264Capture) Start(callback func(H264Frame)) error {
	if c.device == nil {
		return fmt.Errorf("device is nil")
	}
	if err := c.device.InitDevice(); err != nil {
		return err
	}
	c.serverPath = c.findServerPath()
	if err := c.startExtension(); err != nil {
		_ = c.device.removeFile(harmonyScreenRemote)
		return err
	}

	c.remoteAddr = "localabstract:scrcpy_grpc_socket"
	if !c.device.isNewUiTest {
		c.remoteAddr = fmt.Sprintf("tcp:%d", harmonyScreenPort)
	}
	port, err := c.device.getFreePort()
	if err != nil {
		c.stopExtension()
		_ = c.device.removeFile(harmonyScreenRemote)
		return err
	}
	if err := c.device.createForward(fmt.Sprintf("tcp:%d", port), c.remoteAddr); err != nil {
		c.stopExtension()
		_ = c.device.removeFile(harmonyScreenRemote)
		return err
	}
	c.localPort = port
	address := fmt.Sprintf("127.0.0.1:%d", port)
	grpcConn, err := grpc.Dial(address,
		grpc.WithInsecure(),
		grpc.WithDefaultCallOptions(grpc.MaxCallRecvMsgSize(10*1024*1024)),
	)
	if err != nil {
		_ = c.device.removeForward(fmt.Sprintf("tcp:%d", port), c.remoteAddr)
		c.stopExtension()
		_ = c.device.removeFile(harmonyScreenRemote)
		return err
	}
	client := scrcpyproto.NewScrcpyServiceClient(grpcConn)
	ctx, cancel := context.WithCancel(context.Background())
	stream, err := client.OnStart(ctx, &scrcpyproto.Empty{})
	if err != nil {
		cancel()
		_ = grpcConn.Close()
		_ = c.device.removeForward(fmt.Sprintf("tcp:%d", port), c.remoteAddr)
		c.stopExtension()
		_ = c.device.removeFile(harmonyScreenRemote)
		return fmt.Errorf("启动 H.264 gRPC 流失败: %w", err)
	}

	c.mu.Lock()
	c.conn = grpcConn
	c.client = client
	c.streamCtx = ctx
	c.cancel = cancel
	c.callback = callback
	c.startedAt = time.Now()
	c.stopped = false
	c.configSent = false
	c.mu.Unlock()

	go c.dispatchFrames()
	go c.readStream(stream)
	return nil
}

// enqueueFrame 只保留最新视频帧，避免 Wails/前端短暂拥塞造成延迟不断累积。
func (c *H264Capture) enqueueFrame(frame H264Frame) {
	c.mu.Lock()
	stopped := c.stopped
	c.mu.Unlock()
	if stopped || frame.IsConfig {
		return
	}
	select {
	case <-c.dispatchStop:
		return
	default:
	}
	select {
	case c.queue <- frame:
	default:
		select {
		case <-c.queue:
		default:
		}
		select {
		case c.queue <- frame:
		default:
		}
	}
}

func (c *H264Capture) dispatchFrames() {
	for {
		select {
		case <-c.dispatchStop:
			return
		case frame := <-c.queue:
			c.mu.Lock()
			callback := c.callback
			c.mu.Unlock()
			if callback != nil {
				callback(frame)
			}
		}
	}
}

func (c *H264Capture) readStream(stream scrcpyproto.ScrcpyService_OnStartClient) {
	for {
		reply, err := stream.Recv()
		if err != nil {
			c.mu.Lock()
			stopped := c.stopped
			client := c.client
			streamCtx := c.streamCtx
			c.mu.Unlock()
			if stopped || client == nil || streamCtx == nil {
				return
			}
			log.Printf("[H264Capture] gRPC 流结束，尝试请求关键帧并重连: %v", err)
			for attempt := 1; attempt <= 3; attempt++ {
				select {
				case <-c.dispatchStop:
					return
				default:
				}
				time.Sleep(time.Duration(attempt) * 200 * time.Millisecond)
				requestCtx, cancelRequest := context.WithTimeout(context.Background(), 2*time.Second)
				_, _ = client.OnRequestIDRFrame(requestCtx, &scrcpyproto.Empty{})
				cancelRequest()
				newStream, reconnectErr := client.OnStart(streamCtx, &scrcpyproto.Empty{})
				if reconnectErr == nil {
					c.mu.Lock()
					c.configSent = false
					c.mu.Unlock()
					c.readStream(newStream)
					return
				}
				log.Printf("[H264Capture] gRPC 重连失败 (%d/3): %v", attempt, reconnectErr)
			}
			return
		}
		value, ok := reply.GetPayload()["data"]
		if !ok || value == nil || len(value.GetValBytes()) == 0 {
			continue
		}
		data := append([]byte(nil), value.GetValBytes()...)
		units := scrcpy.ParseAnnexBNALUnits(data)
		hasSPS, hasPPS, keyframe := false, false, false
		for _, nalu := range units {
			if len(nalu) == 0 {
				continue
			}
			switch nalu[0] & 0x1f {
			case 5:
				keyframe = true
			case 7:
				hasSPS = true
			case 8:
				hasPPS = true
			}
		}
		pts := time.Since(c.startedAt).Microseconds()
		c.mu.Lock()
		callback := c.callback
		configSent := c.configSent
		if hasSPS && hasPPS {
			c.configSent = true
		}
		c.mu.Unlock()
		if callback == nil {
			continue
		}
		if !configSent && hasSPS && hasPPS {
			callback(H264Frame{Data: data, IsConfig: true, IsKeyframe: true, PTS: pts})
		}
		c.enqueueFrame(H264Frame{Data: data, IsKeyframe: keyframe, PTS: pts})
	}
}

func (c *H264Capture) Stop() error {
	c.mu.Lock()
	if c.stopped {
		c.mu.Unlock()
		return nil
	}
	c.stopped = true
	cancel := c.cancel
	conn := c.conn
	localPort := c.localPort
	remoteAddr := c.remoteAddr
	client := c.client
	c.mu.Unlock()

	select {
	case <-c.dispatchStop:
	default:
		close(c.dispatchStop)
	}
	if client != nil {
		ctx, cancelEnd := context.WithTimeout(context.Background(), 2*time.Second)
		_, _ = client.OnEnd(ctx, &scrcpyproto.Empty{})
		cancelEnd()
	}
	if cancel != nil {
		cancel()
	}
	if conn != nil {
		_ = conn.Close()
	}
	if localPort != 0 {
		_ = c.device.removeForward(fmt.Sprintf("tcp:%d", localPort), remoteAddr)
	}
	c.stopExtension()
	_ = c.device.removeFile(harmonyScreenRemote)
	return nil
}
