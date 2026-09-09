package backend

import (
	"context"
	"encoding/base64"
	"fmt"
	"log"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"

	"Hadice/backend/adb"
	"Hadice/backend/device"
	"Hadice/backend/hdc"
	"Hadice/backend/hypium"
	"Hadice/backend/scrcpy"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// DisplaySize 屏幕尺寸
type DisplaySize struct {
	Width  int `json:"width"`
	Height int `json:"height"`
}

// ScreenMirrorSession 屏幕投屏会话
type ScreenMirrorSession struct {
	DeviceID    string
	IsStreaming bool
	Transport   string
	DisplaySize DisplaySize
	mu          sync.Mutex
	stopChan    chan struct{}
	ticker      *time.Ticker
	tempDir     string
	// hypium-driver 相关
	device        *hypium.Device
	rpcClient     *hypium.RpcClient
	screenCapture *hypium.ScreenCapture
	h264Capture   *hypium.H264Capture
	gesture       *hypium.GestureChannel
	powerAwake    bool
}

var (
	// screenMirrorSessions 存储所有投屏会话
	screenMirrorSessions = make(map[string]*ScreenMirrorSession)
	screenMirrorMutex    sync.RWMutex
)

// StartScreenMirror 开始投屏
//
// HarmonyOS 实现方式：使用 hypium-driver + agent.so + RPC 模式
// Android 实现方式：使用 scrcpy + FFmpeg 管道模式
// scale: 缩放比例（0.0-1.0），默认 0.6
func (a *App) StartScreenMirror(deviceSn string, scale float64) (map[string]interface{}, error) {
	log.Printf("[ScreenMirror] StartScreenMirror called for device: %s, scale: %.1f", deviceSn, scale)

	platform := deviceManager.GetDevicePlatform(deviceSn)
	log.Printf("[ScreenMirror] Device platform: %s", platform)

	if platform == device.PlatformAndroid {
		return a.startAndroidScreenMirror(deviceSn, scale)
	}

	return a.startHarmonyOSScreenMirror(deviceSn, scale)
}

// startAndroidScreenMirror 启动 Android 设备投屏（使用 scrcpy）
func (a *App) startAndroidScreenMirror(deviceSn string, scale float64) (map[string]interface{}, error) {
	log.Printf("[ScreenMirror] Starting Android screen mirror with scrcpy: %s", deviceSn)

	manager := scrcpy.GetManager()

	if manager.IsRunning(deviceSn) {
		log.Printf("[ScreenMirror] Android mirror already running for device: %s", deviceSn)
		return map[string]interface{}{"success": true}, nil
	}

	maxSize := int(1920 * scale)
	if maxSize <= 0 || maxSize > 1920 {
		maxSize = 1920
	}

	opts := scrcpy.DefaultOptions()
	opts.MaxSize = maxSize

	onError := func(err error) {
		log.Printf("[ScreenMirror] scrcpy error for device %s: %v", deviceSn, err)
		scrcpy.EmitError(deviceSn, err.Error())
	}

	// Retry up to 3 times: device-side app_process may linger after local adb shell is killed,
	// holding encoder resources. Each retry kills stale processes first.
	var lastErr error
	for attempt := 1; attempt <= 3; attempt++ {
		codec, err := manager.StartMirror(context.Background(), deviceSn, opts, onError)
		if err == nil {
			if codec != nil {
				scrcpy.EmitCodecMeta(deviceSn, codec)
			}
			go a.readAndroidFrames(deviceSn)
			log.Printf("[ScreenMirror] Android screen mirror started successfully: %s (attempt %d)", deviceSn, attempt)
			return map[string]interface{}{"success": true}, nil
		}
		lastErr = err
		log.Printf("[ScreenMirror] Attempt %d failed for %s: %v", attempt, deviceSn, err)
		if attempt < 3 {
			time.Sleep(time.Duration(attempt) * time.Second)
		}
	}

	log.Printf("[ScreenMirror] All attempts failed for %s", deviceSn)
	return map[string]interface{}{
		"success": false,
		"error":   fmt.Sprintf("启动 scrcpy 失败: %v", lastErr),
	}, lastErr
}

func (a *App) readAndroidFrames(deviceSn string) {
	manager := scrcpy.GetManager()

	for manager.IsRunning(deviceSn) {
		frame, err := manager.ReadFrame(deviceSn)
		if err != nil {
			log.Printf("[ScreenMirror] Error reading frame for device %s: %v", deviceSn, err)
			break
		}
		if frame != nil {
			scrcpy.EmitFrame(deviceSn, frame)
		}
	}

	log.Printf("[ScreenMirror] Frame reading stopped for device: %s", deviceSn)
}

// startHarmonyOSScreenMirror 启动 HarmonyOS 设备投屏（使用 hypium-driver）
func (a *App) startHarmonyOSScreenMirror(deviceSn string, scale float64) (map[string]interface{}, error) {
	log.Printf("[ScreenMirror] Starting HarmonyOS screen mirror with hypium-driver: %s", deviceSn)

	screenMirrorMutex.Lock()
	defer screenMirrorMutex.Unlock()

	// 检查是否已有会话
	if session, ok := screenMirrorSessions[deviceSn]; ok {
		log.Printf("[ScreenMirror] Found existing session for device: %s, IsStreaming: %v", deviceSn, session.IsStreaming)
		if session.IsStreaming {
			log.Printf("[ScreenMirror] Session is already streaming, returning success")
			return map[string]interface{}{
				"success": true,
			}, nil
		}
		// 如果会话存在但不在流式传输，先清理旧会话
		log.Printf("[ScreenMirror] Cleaning up stale session for device: %s", deviceSn)
		session.mu.Lock()
		if session.h264Capture != nil {
			_ = session.h264Capture.Stop()
		}
		if session.gesture != nil {
			_ = session.gesture.Close()
		}
		if session.screenCapture != nil {
			log.Printf("[ScreenMirror] Stopping old screen capture for device: %s", deviceSn)
			session.screenCapture.StopCaptureScreen()
		}
		if session.device != nil {
			log.Printf("[ScreenMirror] Closing old device connection for device: %s", deviceSn)
			session.device.Close()
		}
		session.mu.Unlock()
		delete(screenMirrorSessions, deviceSn)
		log.Printf("[ScreenMirror] Stale session cleaned up for device: %s", deviceSn)
		// 等待一小段时间确保资源完全释放
		time.Sleep(200 * time.Millisecond)
	}

	// 创建新会话
	session := &ScreenMirrorSession{
		DeviceID:    deviceSn,
		IsStreaming: false,
		DisplaySize: DisplaySize{Width: 0, Height: 0},
		stopChan:    make(chan struct{}),
	}

	screenMirrorSessions[deviceSn] = session

	// 初始化 hypium-driver 设备
	device := hypium.NewDevice(deviceSn)
	if err := device.InitDevice(); err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("初始化设备失败: %v", err),
		}, err
	}
	// 投屏期间避免设备因超时进入休眠；停止时恢复原始超时策略。
	if _, err := hdc.ExecuteHdc([]string{"-t", deviceSn, "shell", "power-shell", "timeout", "-o", "60000"}); err == nil {
		if _, err := hdc.ExecuteHdc([]string{"-t", deviceSn, "shell", "power-shell", "wakeup"}); err == nil {
			session.powerAwake = true
		}
	}

	// 创建 RPC 客户端
	rpcClient := hypium.NewRpcClient(device)

	// 创建屏幕捕获管理器。JPEG 仍作为 H.264 启动失败时的兼容回退。
	screenCapture := hypium.NewScreenCapture(device, rpcClient)

	session.device = device
	session.rpcClient = rpcClient
	session.screenCapture = screenCapture

	// 获取屏幕尺寸
	size, err := a.GetDisplaySize(deviceSn)
	if err == nil && size != nil {
		session.DisplaySize = *size
	}

	log.Printf("[ScreenMirror] Starting screen mirror with hypium-driver: %s", deviceSn)

	// 触摸通道与视频通道独立建立；触摸通道失败时本轮会话降级为 uiInput。
	gesture, gestureErr := hypium.NewGestureChannel(device)
	if gestureErr != nil {
		log.Printf("[ScreenMirror] GestureChannel unavailable, fallback to uiInput: %v", gestureErr)
	} else {
		session.gesture = gesture
	}

	// H.264 事件沿用 Android 已有 screenMirror:frame 事件格式，新增 transport 元数据。
	emitH264Frame := func(frame hypium.H264Frame) {
		app := application.Get()
		if app == nil {
			return
		}
		if frame.IsConfig {
			record, err := scrcpy.BuildAVCDecoderConfigRecord(frame.Data)
			if err != nil {
				log.Printf("[ScreenMirror] H.264 配置帧解析失败: %v", err)
				return
			}
			app.Event.Emit("screenMirror:frame", map[string]interface{}{
				"deviceSn":   deviceSn,
				"transport":  "h264",
				"data":       base64.StdEncoding.EncodeToString(record),
				"isKeyframe": true,
				"isConfig":   true,
				"pts":        frame.PTS,
			})
		}
		avccData, detectedKeyframe := scrcpy.AnnexBToAVCC(frame.Data)
		app.Event.Emit("screenMirror:frame", map[string]interface{}{
			"deviceSn":   deviceSn,
			"transport":  "h264",
			"data":       base64.StdEncoding.EncodeToString(avccData),
			"isKeyframe": frame.IsKeyframe || detectedKeyframe,
			"isConfig":   false,
			"pts":        frame.PTS,
		})
	}

	// 先尝试 DevEco 验证过的屏幕扩展 + H.264 gRPC 流。
	h264Capture := hypium.NewH264Capture(device)
	if err := h264Capture.Start(emitH264Frame); err == nil {
		session.h264Capture = h264Capture
		session.Transport = "h264"
		if size := session.DisplaySize; size.Width > 0 && size.Height > 0 {
			app := application.Get()
			if app != nil {
				app.Event.Emit("screenMirror:codec", map[string]interface{}{
					"deviceSn":  deviceSn,
					"transport": "h264",
					"codecId":   0,
					"width":     size.Width,
					"height":    size.Height,
				})
			}
		}
		log.Printf("[ScreenMirror] HarmonyOS H.264 mirror started: %s", deviceSn)
	} else {
		log.Printf("[ScreenMirror] H.264 unavailable, fallback to JPEG capture: %v", err)
		frameCallback := func(frameData []byte) {
			app := application.Get()
			if app == nil {
				return
			}
			app.Event.Emit("screenMirror:frame", map[string]interface{}{
				"deviceSn":  deviceSn,
				"transport": "jpeg",
				"data":      base64.StdEncoding.EncodeToString(frameData),
			})
		}
		if err := screenCapture.StartCaptureScreen(scale, frameCallback); err != nil {
			log.Printf("[ScreenMirror] ERROR: StartCaptureScreen failed: %v", err)
			if session.gesture != nil {
				_ = session.gesture.Close()
			}
			_ = device.Close()
			if session.powerAwake {
				_, _ = hdc.ExecuteHdc([]string{"-t", deviceSn, "shell", "power-shell", "timeout", "-r"})
			}
			delete(screenMirrorSessions, deviceSn)
			return map[string]interface{}{"success": false, "error": fmt.Sprintf("启动屏幕捕获失败: %v", err)}, err
		}
		session.Transport = "jpeg"
		log.Printf("[ScreenMirror] HarmonyOS JPEG fallback started: %s", deviceSn)
	}

	session.mu.Lock()
	session.IsStreaming = true
	session.mu.Unlock()

	log.Printf("[ScreenMirror] Screen mirror started successfully: %s", deviceSn)

	return map[string]interface{}{
		"success":   true,
		"transport": session.Transport,
	}, nil
}

// StopScreenMirror 停止投屏
func (a *App) StopScreenMirror(deviceSn string) (map[string]interface{}, error) {
	log.Printf("[ScreenMirror] StopScreenMirror called for device: %s", deviceSn)

	platform := deviceManager.GetDevicePlatform(deviceSn)
	log.Printf("[ScreenMirror] Device platform: %s", platform)

	if platform == device.PlatformAndroid {
		return a.stopAndroidScreenMirror(deviceSn)
	}

	return a.stopHarmonyOSScreenMirror(deviceSn)
}

// stopAndroidScreenMirror 停止 Android 设备投屏
func (a *App) stopAndroidScreenMirror(deviceSn string) (map[string]interface{}, error) {
	log.Printf("[ScreenMirror] Stopping Android screen mirror: %s", deviceSn)

	manager := scrcpy.GetManager()
	if err := manager.StopMirror(deviceSn); err != nil {
		log.Printf("[ScreenMirror] Error stopping Android mirror: %v", err)
		return map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		}, err
	}

	log.Printf("[ScreenMirror] Android screen mirror stopped successfully: %s", deviceSn)
	return map[string]interface{}{"success": true}, nil
}

// stopHarmonyOSScreenMirror 停止 HarmonyOS 设备投屏
func (a *App) stopHarmonyOSScreenMirror(deviceSn string) (map[string]interface{}, error) {
	log.Printf("[ScreenMirror] Stopping HarmonyOS screen mirror: %s", deviceSn)

	screenMirrorMutex.Lock()
	defer screenMirrorMutex.Unlock()

	session, ok := screenMirrorSessions[deviceSn]
	if !ok {
		log.Printf("[ScreenMirror] WARNING: Session not found for device: %s", deviceSn)
		return map[string]interface{}{
			"success": false,
			"error":   "Session not found",
		}, nil
	}

	log.Printf("[ScreenMirror] Found session for device: %s, IsStreaming: %v", deviceSn, session.IsStreaming)

	session.mu.Lock()
	defer session.mu.Unlock()

	if !session.IsStreaming {
		log.Printf("[ScreenMirror] Session is not streaming, returning success")
		return map[string]interface{}{
			"success": true,
		}, nil
	}

	log.Printf("[ScreenMirror] Stopping screen capture for device: %s", deviceSn)

	// 停止屏幕捕获
	if session.h264Capture != nil {
		log.Printf("[ScreenMirror] Stopping H.264 capture for device: %s", deviceSn)
		if err := session.h264Capture.Stop(); err != nil {
			log.Printf("[ScreenMirror] H.264 stop failed: %v", err)
		}
		session.h264Capture = nil
	}
	if session.screenCapture != nil {
		log.Printf("[ScreenMirror] Calling StopCaptureScreen for device: %s", deviceSn)
		if err := session.screenCapture.StopCaptureScreen(); err != nil {
			log.Printf("[ScreenMirror] ERROR: StopCaptureScreen failed for device %s: %v", deviceSn, err)
		} else {
			log.Printf("[ScreenMirror] StopCaptureScreen succeeded for device: %s", deviceSn)
		}
	} else {
		log.Printf("[ScreenMirror] WARNING: screenCapture is nil for device: %s", deviceSn)
	}
	if session.gesture != nil {
		if err := session.gesture.Close(); err != nil {
			log.Printf("[ScreenMirror] GestureChannel close failed: %v", err)
		}
		session.gesture = nil
	}
	if session.powerAwake {
		_, _ = hdc.ExecuteHdc([]string{"-t", deviceSn, "shell", "power-shell", "timeout", "-r"})
		session.powerAwake = false
	}

	// 停止定时器（如果存在）
	if session.ticker != nil {
		log.Printf("[ScreenMirror] Stopping ticker for device: %s", deviceSn)
		session.ticker.Stop()
		session.ticker = nil
	}

	// 关闭 stopChan
	if session.stopChan != nil {
		log.Printf("[ScreenMirror] Closing stopChan for device: %s", deviceSn)
		select {
		case <-session.stopChan:
			// 已经关闭
		default:
			close(session.stopChan)
		}
	}

	session.IsStreaming = false
	log.Printf("[ScreenMirror] Set IsStreaming=false for device: %s", deviceSn)

	// 清理临时目录
	if session.tempDir != "" {
		log.Printf("[ScreenMirror] Removing temp directory: %s", session.tempDir)
		if err := os.RemoveAll(session.tempDir); err != nil {
			log.Printf("[ScreenMirror] ERROR: Failed to remove temp directory %s: %v", session.tempDir, err)
		}
		session.tempDir = ""
	}

	// 关闭设备连接
	if session.device != nil {
		log.Printf("[ScreenMirror] Closing device connection for device: %s", deviceSn)
		if err := session.device.Close(); err != nil {
			log.Printf("[ScreenMirror] ERROR: Close device failed for device %s: %v", deviceSn, err)
		} else {
			log.Printf("[ScreenMirror] Device connection closed successfully for device: %s", deviceSn)
		}
		session.device = nil
	} else {
		log.Printf("[ScreenMirror] WARNING: device is nil for device: %s", deviceSn)
	}

	// 清理其他引用
	session.rpcClient = nil
	session.screenCapture = nil

	// 从会话列表中移除
	delete(screenMirrorSessions, deviceSn)
	log.Printf("[ScreenMirror] Session removed from map for device: %s", deviceSn)

	log.Printf("[ScreenMirror] HarmonyOS screen mirror stopped successfully: %s", deviceSn)

	return map[string]interface{}{
		"success": true,
	}, nil
}

// GetDisplaySize 获取屏幕尺寸
func (a *App) GetDisplaySize(deviceSn string) (*DisplaySize, error) {
	platform := deviceManager.GetDevicePlatform(deviceSn)

	if platform == device.PlatformAndroid {
		return a.getAndroidDisplaySize(deviceSn)
	}

	return a.getHarmonyOSDisplaySize(deviceSn)
}

// getAndroidDisplaySize 获取 Android 设备屏幕尺寸
func (a *App) getAndroidDisplaySize(deviceSn string) (*DisplaySize, error) {
	// 使用 adb shell wm size 获取屏幕尺寸
	result, err := adb.ExecuteAdb([]string{"-s", deviceSn, "shell", "wm", "size"})
	if err == nil && result.Success && result.Output != "" {
		log.Printf("[GetDisplaySize] Android wm size 输出: %s", result.Output)
		re := regexp.MustCompile(`(\d+)x(\d+)`)
		matches := re.FindStringSubmatch(result.Output)
		if len(matches) >= 3 {
			var width, height int
			fmt.Sscanf(matches[1], "%d", &width)
			fmt.Sscanf(matches[2], "%d", &height)
			if width > 0 && height > 0 {
				log.Printf("[GetDisplaySize] Android 使用 wm size 获取尺寸: %dx%d", width, height)
				return &DisplaySize{
					Width:  width,
					Height: height,
				}, nil
			}
		}
	}

	log.Printf("[GetDisplaySize] Android 获取尺寸失败，返回默认尺寸 1080x1920")
	return &DisplaySize{
		Width:  1080,
		Height: 1920,
	}, nil
}

// getHarmonyOSDisplaySize 获取 HarmonyOS 设备屏幕尺寸
func (a *App) getHarmonyOSDisplaySize(deviceSn string) (*DisplaySize, error) {
	// 方法1：优先使用 param 命令获取 cover_window_size
	// hdc -t <deviceSn> shell param get const.product.cover_window_size
	// 输出格式: x1,y1,x2,y2（例如：806,0,1260,2720），提取最后两位作为宽高
	result, err := hdc.ExecuteHdc([]string{"-t", deviceSn, "shell", "param", "get", "const.product.cover_window_size"})
	if err == nil && result.Success && result.Output != "" {
		log.Printf("[GetDisplaySize] param 输出: %s", result.Output)
		// 解析输出格式: x1,y1,x2,y2（例如：806,0,1260,2720）
		output := strings.TrimSpace(result.Output)
		parts := strings.Split(output, ",")
		if len(parts) >= 4 {
			var width, height int
			fmt.Sscanf(strings.TrimSpace(parts[2]), "%d", &width)
			fmt.Sscanf(strings.TrimSpace(parts[3]), "%d", &height)
			if width > 0 && height > 0 {
				log.Printf("[GetDisplaySize] 使用 param get const.product.cover_window_size 获取尺寸: %dx%d", width, height)
				return &DisplaySize{
					Width:  width,
					Height: height,
				}, nil
			}
		}
	}

	// 方法2：回退到 hidumper 命令
	// hdc -t <deviceSn> shell hidumper -s DisplayManagerService -a '-a'
	result2, err := hdc.ExecuteHdc([]string{"-t", deviceSn, "shell", "hidumper", "-s", "DisplayManagerService", "-a", "-a"})
	if err == nil && result2.Success && result2.Output != "" {
		// 解析输出格式:
		// Density:                      3.25
		// Bounds<L,T,W,H>:              0, 0, 1260, 2720,

		lines := strings.Split(result2.Output, "\n")
		var width, height int

		for _, line := range lines {
			line = strings.TrimSpace(line)
			if strings.HasPrefix(line, "Bounds<L,T,W,H>:") {
				// 提取 "0, 0, 1260, 2720" 中的后两个数字
				boundsStr := strings.TrimPrefix(line, "Bounds<L,T,W,H>:")
				boundsStr = strings.TrimSpace(boundsStr)
				parts := strings.Split(boundsStr, ",")
				if len(parts) >= 4 {
					fmt.Sscanf(strings.TrimSpace(parts[2]), "%d", &width)
					fmt.Sscanf(strings.TrimSpace(parts[3]), "%d", &height)
					if width > 0 && height > 0 {
						log.Printf("[GetDisplaySize] 使用 hidumper 获取尺寸: %dx%d", width, height)
						return &DisplaySize{
							Width:  width,
							Height: height,
						}, nil
					}
				}
			}
		}
	}

	// 方法3：回退到 wm size 命令
	// hdc -t <deviceSn> shell wm size
	result3, err := hdc.ExecuteHdc([]string{"-t", deviceSn, "shell", "wm", "size"})
	if err == nil && result3.Success && result3.Output != "" {
		log.Printf("[GetDisplaySize] wm size 输出: %s", result3.Output)
		// 解析输出格式: Physical size: 1080x1920 或类似格式
		re := regexp.MustCompile(`(\d+)x(\d+)`)
		matches := re.FindStringSubmatch(result3.Output)
		if len(matches) >= 3 {
			var width, height int
			fmt.Sscanf(matches[1], "%d", &width)
			fmt.Sscanf(matches[2], "%d", &height)
			if width > 0 && height > 0 {
				log.Printf("[GetDisplaySize] 使用 wm size 获取尺寸: %dx%d", width, height)
				return &DisplaySize{
					Width:  width,
					Height: height,
				}, nil
			}
		}
	}

	log.Printf("[GetDisplaySize] 所有方法都失败，返回默认尺寸 1080x1920")
	// 如果所有方法都失败，返回默认尺寸
	return &DisplaySize{
		Width:  1080,
		Height: 1920,
	}, nil
}

// emitFrame 发送视频帧到前端（内部方法）
func emitFrame(ctx context.Context, deviceSn string, frameData []byte) {
	base64Data := base64.StdEncoding.EncodeToString(frameData)
	app := application.Get()
	if app != nil {
		app.Event.Emit("screenMirror:frame", map[string]interface{}{
			"deviceSn": deviceSn,
			"data":     base64Data,
		})
	}
}

// emitError 发送错误到前端（内部方法）
func emitError(ctx context.Context, deviceSn string, errorMsg string) {
	app := application.Get()
	if app != nil {
		app.Event.Emit("screenMirror:error", map[string]interface{}{
			"deviceSn": deviceSn,
			"error":    errorMsg,
		})
	}
}
