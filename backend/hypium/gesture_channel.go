package hypium

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"sync"
	"time"
)

const gestureRPCModule = "com.ohos.devicetest.hypiumApiHelper"

// GestureChannel 是独立于 Device.rpcSock 的持久触摸通道。
// 一个通道只处理一个顺序请求，保证 Down -> Move -> Up 不会被其他 RPC 插入。
type GestureChannel struct {
	device    *Device
	localPort int
	remote    string
	conn      net.Conn
	mu        sync.Mutex
	active    bool
	lastX     int
	lastY     int
	closed    bool
}

// NewGestureChannel 创建并连接独立的 Gestures Socket。
func NewGestureChannel(device *Device) (*GestureChannel, error) {
	if device == nil {
		return nil, fmt.Errorf("device is nil")
	}
	if err := device.InitDevice(); err != nil {
		return nil, err
	}

	remote := "localabstract:uitest_socket"
	if !device.isNewUiTest {
		remote = fmt.Sprintf("tcp:%d", UITEST_SERVER_PORT)
	}
	port, err := device.getFreePort()
	if err != nil {
		return nil, fmt.Errorf("获取触摸通道端口失败: %w", err)
	}
	if err := device.createForward(fmt.Sprintf("tcp:%d", port), remote); err != nil {
		return nil, fmt.Errorf("创建触摸通道转发失败: %w", err)
	}

	channel := &GestureChannel{device: device, localPort: port, remote: remote}
	if err := channel.connectLocked(); err != nil {
		_ = device.removeForward(fmt.Sprintf("tcp:%d", port), remote)
		return nil, err
	}
	return channel, nil
}

func (g *GestureChannel) connectLocked() error {
	if g.closed {
		return fmt.Errorf("触摸通道已关闭")
	}
	conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", g.localPort), 5*time.Second)
	if err != nil {
		return fmt.Errorf("连接触摸通道失败: %w", err)
	}
	if tcpConn, ok := conn.(*net.TCPConn); ok {
		_ = tcpConn.SetNoDelay(true)
	}
	g.conn = conn
	return nil
}

func (g *GestureChannel) reconnectLocked() error {
	if g.conn != nil {
		_ = g.conn.Close()
		g.conn = nil
	}
	return g.connectLocked()
}

func buildGestureMessage(api string, x, y int) ([]byte, error) {
	return json.Marshal(map[string]interface{}{
		"module": gestureRPCModule,
		"method": "Gestures",
		"params": map[string]interface{}{
			"api":  api,
			"args": map[string]int{"x": x, "y": y},
		},
	})
}

func readGestureResponse(conn net.Conn) error {
	if err := conn.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
		return err
	}
	defer conn.SetReadDeadline(time.Time{})

	var response bytes.Buffer
	buffer := make([]byte, 4096)
	for response.Len() < 1<<20 {
		n, err := conn.Read(buffer)
		if n > 0 {
			response.Write(buffer[:n])
			var value map[string]interface{}
			if json.Unmarshal(response.Bytes(), &value) == nil {
				if exception, ok := value["exception"]; ok && exception != nil {
					return fmt.Errorf("Gestures 返回异常: %v", exception)
				}
				return nil
			}
		}
		if err != nil {
			if err == io.EOF {
				return fmt.Errorf("Gestures Socket 提前关闭")
			}
			return err
		}
	}
	return fmt.Errorf("Gestures 响应超过 1MB")
}

func (g *GestureChannel) sendLocked(api string, x, y int) error {
	message, err := buildGestureMessage(api, x, y)
	if err != nil {
		return err
	}
	if g.conn == nil {
		if err := g.connectLocked(); err != nil {
			return err
		}
	}
	if err := g.conn.SetWriteDeadline(time.Now().Add(5 * time.Second)); err != nil {
		return err
	}
	_, err = g.conn.Write(message)
	if err == nil {
		err = readGestureResponse(g.conn)
	}
	if err != nil {
		log.Printf("[GestureChannel] %s 失败，重连后重试: %v", api, err)
		if reconnectErr := g.reconnectLocked(); reconnectErr != nil {
			return fmt.Errorf("触摸通道重连失败: %w", reconnectErr)
		}
		if _, err = g.conn.Write(message); err != nil {
			return err
		}
		if err = readGestureResponse(g.conn); err != nil {
			return err
		}
	}
	return nil
}

func (g *GestureChannel) send(api string, x, y int) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.closed {
		return fmt.Errorf("触摸通道已关闭")
	}
	if err := g.sendLocked(api, x, y); err != nil {
		return err
	}
	switch api {
	case "touchDown":
		g.active = true
	case "touchMove", "touchUp":
		g.active = api != "touchUp"
	}
	g.lastX, g.lastY = x, y
	return nil
}

func (g *GestureChannel) TouchDown(x, y int) error { return g.send("touchDown", x, y) }
func (g *GestureChannel) TouchMove(x, y int) error { return g.send("touchMove", x, y) }
func (g *GestureChannel) TouchUp(x, y int) error   { return g.send("touchUp", x, y) }

// Close 关闭触摸通道。若仍有按下状态，先尽力发送 TouchUp。
func (g *GestureChannel) Close() error {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.closed {
		return nil
	}
	if g.active && g.conn != nil {
		if err := g.sendLocked("touchUp", g.lastX, g.lastY); err != nil {
			log.Printf("[GestureChannel] 清理 TouchUp 失败: %v", err)
		}
	}
	g.active = false
	g.closed = true
	if g.conn != nil {
		_ = g.conn.Close()
		g.conn = nil
	}
	if g.device != nil {
		return g.device.removeForward(fmt.Sprintf("tcp:%d", g.localPort), g.remote)
	}
	return nil
}

// IsClosed 供会话状态检查使用。
func (g *GestureChannel) IsClosed() bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.closed
}
