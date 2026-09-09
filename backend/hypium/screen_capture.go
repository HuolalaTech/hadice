package hypium

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"strings"
	"sync"
	"time"
)

const (
	// JPEG_START JPEG 文件头
	JPEG_START = "\xFF\xD8"
	// JPEG_END JPEG 文件尾
	JPEG_END = "\xFF\xD9"
	// MAX_JPEG_BUFFER_SIZE 最大 JPEG 缓冲区大小（10MB）
	MAX_JPEG_BUFFER_SIZE = 10 * 1024 * 1024
)

// ScreenCapture 屏幕捕获管理器
type ScreenCapture struct {
	device        *Device
	rpcClient     *RpcClient
	driverRef     string
	isStreaming   bool
	jpegBuffer    []byte
	frameCallback func([]byte)
	mu            sync.Mutex
	stopChan      chan struct{}
	dataReader    io.Reader
}

// NewScreenCapture 创建新的屏幕捕获管理器
func NewScreenCapture(device *Device, rpcClient *RpcClient) *ScreenCapture {
	return &ScreenCapture{
		device:    device,
		rpcClient: rpcClient,
		driverRef: "Driver#0",
		stopChan:  make(chan struct{}),
	}
}

// StartCaptureScreen 开始屏幕捕获
// scale: 缩放比例（0.0-1.0），默认 0.5
// callback: 接收 JPEG 图片数据的回调函数
func (sc *ScreenCapture) StartCaptureScreen(scale float64, callback func([]byte)) error {
	sc.mu.Lock()
	defer sc.mu.Unlock()

	if sc.isStreaming {
		return fmt.Errorf("屏幕捕获已在进行中")
	}

	// 先停止之前的捕获（如果存在）
	log.Printf("[ScreenCapture] Stopping previous capture if exists")
	sc.stopCaptureScreenInternal()

	// 等待一小段时间确保旧连接完全关闭
	time.Sleep(300 * time.Millisecond)

	// 检测 RPC 服务健康状态，不健康则自动恢复
	log.Printf("[ScreenCapture] Checking uitest service health...")
	if !sc.device.HealthCheck() {
		log.Printf("[ScreenCapture] uitest service unhealthy, attempting restart...")
		if err := sc.device.RestartUiTest(); err != nil {
			log.Printf("[ScreenCapture] ERROR: failed to restart uitest: %v", err)
			return fmt.Errorf("uitest 服务不健康且重启失败: %v", err)
		}
		// 重新初始化设备连接
		if err := sc.device.InitDevice(); err != nil {
			return fmt.Errorf("重新初始化设备失败: %v", err)
		}
		log.Printf("[ScreenCapture] uitest service restarted successfully")
	}

	// 重置状态
	sc.frameCallback = callback
	sc.isStreaming = true
	sc.jpegBuffer = make([]byte, 0)

	// 重置 stopChan
	if sc.stopChan != nil {
		select {
		case <-sc.stopChan:
			// 已经关闭
		default:
			close(sc.stopChan)
		}
	}
	sc.stopChan = make(chan struct{})

	log.Printf("[ScreenCapture] Starting new capture with scale: %.2f", scale)

	// 调用 startCaptureScreen API
	// 根据参考代码，应该使用 Captures API，而不是 Driver.startCaptureScreen
	// 方法1: 尝试通过 RpcClient 调用 Captures.startCaptureScreen
	params := map[string]interface{}{
		"options": map[string]interface{}{
			"scale": scale,
		},
	}

	_, err := sc.rpcClient.CallUiTest("Captures.startCaptureScreen", sc.driverRef, params)
	if err != nil {
		log.Printf("[ScreenCapture] CallUiTest Captures.startCaptureScreen 失败，尝试直接 RPC 调用: %v", err)

		// 方法2: 尝试通过 Device.rpc 直接调用，使用 method: "Captures"
		rpcMessage := map[string]interface{}{
			"module": "com.ohos.devicetest.hypiumApiHelper",
			"method": "Captures",
			"params": map[string]interface{}{
				"api": "startCaptureScreen",
				"args": map[string]interface{}{
					"options": map[string]interface{}{
						"scale": scale,
					},
				},
			},
			"request_id": fmt.Sprintf("%d", time.Now().UnixNano()),
		}

		msgBytes, err := json.Marshal(rpcMessage)
		if err != nil {
			return fmt.Errorf("序列化 RPC 消息失败: %v", err)
		}

		response, err := sc.device.Rpc(string(msgBytes))
		if err != nil {
			return fmt.Errorf("启动屏幕捕获失败: %v", err)
		}

		// 检查响应
		log.Printf("[ScreenCapture] RPC 调用响应: %s", response)

		// 尝试解析响应
		var rpcResponse map[string]interface{}
		if err := json.Unmarshal([]byte(response), &rpcResponse); err == nil {
			if exception, ok := rpcResponse["exception"]; ok && exception != nil {
				exceptionStr := fmt.Sprintf("%v", exception)
				log.Printf("[ScreenCapture] ERROR: RPC 调用返回异常: %v", exception)
				// 如果返回异常，说明启动失败，需要返回错误
				sc.isStreaming = false
				return fmt.Errorf("启动屏幕捕获失败: %s", exceptionStr)
			} else if result, ok := rpcResponse["result"]; ok {
				log.Printf("[ScreenCapture] RPC 调用成功: %v", result)
				// 检查 result 是否为 false 或 nil
				if result == nil || result == false {
					log.Printf("[ScreenCapture] ERROR: RPC 调用返回 false 或 nil")
					sc.isStreaming = false
					return fmt.Errorf("启动屏幕捕获失败: RPC 返回 false")
				}
			}
		} else {
			// 如果不是 JSON，可能是二进制数据，也认为成功
			log.Printf("[ScreenCapture] RPC 响应不是 JSON 格式，可能已开始接收图片数据")
		}
	}

	// 启动数据读取协程
	// 注意：在启动新捕获后，设备端可能会关闭旧的 RPC Socket 连接
	// 所以我们需要在 readFrameData 中重新获取连接
	go func() {
		// 等待一小段时间，让设备端建立新的数据流连接
		time.Sleep(500 * time.Millisecond)
		sc.readFrameData()
	}()

	log.Printf("[ScreenCapture] StartCaptureScreen completed successfully")
	return nil
}

// StopCaptureScreen 停止屏幕捕获
func (sc *ScreenCapture) StopCaptureScreen() error {
	sc.mu.Lock()
	defer sc.mu.Unlock()

	log.Printf("[ScreenCapture] StopCaptureScreen called, isStreaming: %v", sc.isStreaming)

	if !sc.isStreaming {
		log.Printf("[ScreenCapture] Not streaming, returning nil")
		return nil
	}

	log.Printf("[ScreenCapture] Stopping capture screen...")
	sc.isStreaming = false

	// 先关闭 stopChan 以停止数据读取协程，避免阻塞 RPC 调用
	if sc.stopChan != nil {
		select {
		case <-sc.stopChan:
			// 已经关闭
			log.Printf("[ScreenCapture] stopChan already closed")
		default:
			log.Printf("[ScreenCapture] Closing stopChan to stop data reading")
			close(sc.stopChan)
		}
		// 等待一小段时间让数据读取协程退出
		time.Sleep(100 * time.Millisecond)
		sc.stopChan = make(chan struct{})
	}

	// 然后调用 stopCaptureScreen API
	err := sc.stopCaptureScreenInternal()
	if err != nil {
		log.Printf("[ScreenCapture] ERROR: stopCaptureScreenInternal failed: %v", err)
		// 即使失败也继续，因为数据读取已经停止
	}

	log.Printf("[ScreenCapture] StopCaptureScreen completed")
	return err
}

// stopCaptureScreenInternal 内部停止方法（不加锁）
func (sc *ScreenCapture) stopCaptureScreenInternal() error {
	log.Printf("[ScreenCapture] stopCaptureScreenInternal called")

	if sc.rpcClient == nil {
		log.Printf("[ScreenCapture] ERROR: rpcClient is nil")
		return fmt.Errorf("rpcClient is nil")
	}

	if sc.device == nil {
		log.Printf("[ScreenCapture] ERROR: device is nil")
		return fmt.Errorf("device is nil")
	}

	// 使用 goroutine 和 channel 来实现超时机制
	done := make(chan error, 1)

	go func() {
		// 方法1: 尝试通过 RpcClient 调用 Captures.stopCaptureScreen
		log.Printf("[ScreenCapture] Attempting CallUiTest stopCaptureScreen")
		_, err := sc.rpcClient.CallUiTest("Captures.stopCaptureScreen", sc.driverRef)
		if err != nil {
			log.Printf("[ScreenCapture] CallUiTest stopCaptureScreen 失败: %v", err)

			// 方法2: 尝试通过 Device.rpc 直接调用，使用 method: "Captures"
			log.Printf("[ScreenCapture] Attempting direct RPC call stopCaptureScreen")
			rpcMessage := map[string]interface{}{
				"module": "com.ohos.devicetest.hypiumApiHelper",
				"method": "Captures",
				"params": map[string]interface{}{
					"api":  "stopCaptureScreen",
					"args": map[string]interface{}{},
				},
				"request_id": fmt.Sprintf("%d", time.Now().UnixNano()),
			}

			msgBytes, marshalErr := json.Marshal(rpcMessage)
			if marshalErr != nil {
				log.Printf("[ScreenCapture] ERROR: Failed to marshal RPC message: %v", marshalErr)
				done <- fmt.Errorf("failed to marshal RPC message: %v", marshalErr)
				return
			}

			rpcResponse, rpcErr := sc.device.Rpc(string(msgBytes))
			if rpcErr != nil {
				log.Printf("[ScreenCapture] ERROR: Direct RPC call failed: %v", rpcErr)
				done <- fmt.Errorf("direct RPC call failed: %v", rpcErr)
				return
			}
			log.Printf("[ScreenCapture] Direct RPC call response: %s", rpcResponse)
			done <- nil
		} else {
			log.Printf("[ScreenCapture] CallUiTest stopCaptureScreen succeeded")
			done <- nil
		}
	}()

	// 设置超时时间为 3 秒
	select {
	case err := <-done:
		return err
	case <-time.After(3 * time.Second):
		log.Printf("[ScreenCapture] WARNING: stopCaptureScreenInternal timeout after 3 seconds")
		return fmt.Errorf("stopCaptureScreen timeout")
	}
}

// readFrameData 读取视频帧数据
// 从 RPC Socket 读取数据，分离 JPEG 图片和 JSON 响应
func (sc *ScreenCapture) readFrameData() {
	log.Printf("[ScreenCapture] readFrameData goroutine started")
	defer log.Printf("[ScreenCapture] readFrameData goroutine exited")

	// 获取设备的 RPC Socket
	rpcSock, err := sc.device.GetRpcSocket()
	if err != nil {
		log.Printf("[ScreenCapture] ERROR: 获取 RPC Socket 失败: %v", err)
		return
	}

	if rpcSock == nil {
		log.Printf("[ScreenCapture] ERROR: RPC Socket 未连接")
		return
	}

	log.Printf("[ScreenCapture] RPC Socket obtained successfully")

	buffer := make([]byte, 4096)
	reconnectAttempts := 0
	maxReconnectAttempts := 3

	for {
		select {
		case <-sc.stopChan:
			log.Printf("[ScreenCapture] Stop signal received, exiting readFrameData")
			return
		default:
			// 设置读取超时
			rpcSock.SetReadDeadline(time.Now().Add(100 * time.Millisecond))

			n, err := rpcSock.Read(buffer)
			if err != nil {
				if netErr, ok := err.(interface{ Timeout() bool }); ok && netErr.Timeout() {
					// 超时，继续循环
					reconnectAttempts = 0 // 重置重连计数
					continue
				}
				// 检查是否是 EOF 错误或连接关闭
				if err == io.EOF {
					log.Printf("[ScreenCapture] RPC Socket 连接已关闭 (EOF)")
					return
				}

				// 检查是否是连接关闭错误
				if strings.Contains(err.Error(), "use of closed network connection") {
					log.Printf("[ScreenCapture] ERROR: RPC Socket 连接已关闭: %v", err)
					// 尝试重新获取连接
					if reconnectAttempts < maxReconnectAttempts {
						reconnectAttempts++
						log.Printf("[ScreenCapture] Attempting to reconnect RPC Socket (attempt %d/%d)", reconnectAttempts, maxReconnectAttempts)
						time.Sleep(500 * time.Millisecond)
						newSock, sockErr := sc.device.GetRpcSocket()
						if sockErr != nil {
							log.Printf("[ScreenCapture] ERROR: Failed to reconnect RPC Socket: %v", sockErr)
							time.Sleep(1 * time.Second)
							continue
						}
						rpcSock = newSock
						log.Printf("[ScreenCapture] RPC Socket reconnected successfully")
						reconnectAttempts = 0
						continue
					} else {
						log.Printf("[ScreenCapture] ERROR: Max reconnect attempts reached, exiting")
						return
					}
				}

				log.Printf("[ScreenCapture] ERROR: 读取数据失败: %v (type: %T)", err, err)
				// 检查是否因为停止而关闭
				select {
				case <-sc.stopChan:
					log.Printf("[ScreenCapture] Stop signal received, exiting readFrameData")
					return
				default:
				}
				// 尝试重新连接
				if reconnectAttempts < maxReconnectAttempts {
					reconnectAttempts++
					time.Sleep(1 * time.Second)
					newSock, sockErr := sc.device.GetRpcSocket()
					if sockErr == nil && newSock != nil {
						rpcSock = newSock
						reconnectAttempts = 0
					}
					continue
				} else {
					log.Printf("[ScreenCapture] ERROR: Max reconnect attempts reached, exiting")
					return
				}
			}

			if n == 0 {
				continue
			}

			data := make([]byte, n)
			copy(data, buffer[:n])
			sc.processData(data)
			reconnectAttempts = 0 // 重置重连计数
		}
	}
}

// processData 处理接收到的数据
// 分离 JPEG 图片数据和 JSON 响应
func (sc *ScreenCapture) processData(data []byte) {
	sc.mu.Lock()
	defer sc.mu.Unlock()

	// 检查是否是 JPEG 数据（以 \xFF\xD8 开头）
	isJpegStart := len(data) >= 2 && data[0] == 0xFF && data[1] == 0xD8
	hasJpegInBuffer := len(sc.jpegBuffer) >= 2 && sc.jpegBuffer[0] == 0xFF && sc.jpegBuffer[1] == 0xD8

	// 检查是否是 JSON 数据的开始（以 '{' 或 '[' 开头）
	isJsonStart := len(data) > 0 && (data[0] == '{' || data[0] == '[') && data[0] < 0x80

	if isJpegStart || hasJpegInBuffer {
		// 这是 JPEG 图片数据
		sc.jpegBuffer = append(sc.jpegBuffer, data...)
		sc.processJpegBuffer()
	} else if isJsonStart {
		// 这是 JSON 数据，忽略（RPC 响应）
		// 可以在这里解析 JSON 响应，但通常不需要
	} else {
		// 不确定的数据类型
		if len(sc.jpegBuffer) > 0 {
			// 缓冲区中有数据，可能是 JPEG 的继续
			sc.jpegBuffer = append(sc.jpegBuffer, data...)
			sc.processJpegBuffer()
		}
		// 否则忽略
	}
}

// processJpegBuffer 处理 JPEG 缓冲区，提取完整的 JPEG 图片
func (sc *ScreenCapture) processJpegBuffer() {
	for {
		// 查找 JPEG 起始标记 (FF D8)
		startIndex := bytes.Index(sc.jpegBuffer, []byte(JPEG_START))
		if startIndex == -1 {
			// 没有找到起始标记，保留部分数据
			if len(sc.jpegBuffer) > len(JPEG_START) {
				keepLength := len(JPEG_START) - 1
				sc.jpegBuffer = sc.jpegBuffer[len(sc.jpegBuffer)-keepLength:]
			}
			break
		}

		// 移除起始标记之前的数据
		if startIndex > 0 {
			sc.jpegBuffer = sc.jpegBuffer[startIndex:]
		}

		// 查找 JPEG 结束标记 (FF D9)
		endIndex := bytes.Index(sc.jpegBuffer[len(JPEG_START):], []byte(JPEG_END))
		if endIndex == -1 {
			// 没有找到结束标记，需要等待更多数据
			// 但如果缓冲区太大，可能是数据损坏，清空缓冲区
			if len(sc.jpegBuffer) > MAX_JPEG_BUFFER_SIZE {
				log.Printf("[ScreenCapture] JPEG 缓冲区过大，清空缓冲区")
				sc.jpegBuffer = make([]byte, 0)
			}
			break
		}

		// 提取完整的 JPEG 图片（包括起始和结束标记）
		endIndex += len(JPEG_START) // 调整索引
		jpegImage := make([]byte, endIndex+len(JPEG_END))
		copy(jpegImage, sc.jpegBuffer[:endIndex+len(JPEG_END)])

		// 发送图片数据
		if sc.frameCallback != nil && len(jpegImage) > 100 {
			sc.frameCallback(jpegImage)
		}

		// 移除已处理的 JPEG 图片
		sc.jpegBuffer = sc.jpegBuffer[endIndex+len(JPEG_END):]
	}
}
