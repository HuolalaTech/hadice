package scrcpy

import (
	"encoding/binary"
	"net"
	"sync"
)

type ControlChannel struct {
	conn         net.Conn
	mu           sync.Mutex
	screenWidth  uint16
	screenHeight uint16
}

func NewControlChannel(conn net.Conn) *ControlChannel {
	return &ControlChannel{
		conn: conn,
	}
}

func (c *ControlChannel) SetScreenSize(width, height uint16) {
	c.screenWidth = width
	c.screenHeight = height
}

func (c *ControlChannel) SendKeyEvent(action, keycode int) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.conn == nil {
		return nil
	}

	buf := make([]byte, 14)
	buf[0] = ControlTypeInjectKeycode
	buf[1] = byte(action)
	binary.BigEndian.PutUint32(buf[2:6], uint32(keycode))
	binary.BigEndian.PutUint32(buf[6:10], 0)
	binary.BigEndian.PutUint32(buf[10:14], 0)

	_, err := c.conn.Write(buf)
	return err
}

func (c *ControlChannel) SendKeyEventWithMeta(action, keycode, metastate int) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.conn == nil {
		return nil
	}

	buf := make([]byte, 14)
	buf[0] = ControlTypeInjectKeycode
	buf[1] = byte(action)
	binary.BigEndian.PutUint32(buf[2:6], uint32(keycode))
	binary.BigEndian.PutUint32(buf[6:10], 0)
	binary.BigEndian.PutUint32(buf[10:14], uint32(metastate))

	_, err := c.conn.Write(buf)
	return err
}

func (c *ControlChannel) SendTouchEvent(action int, x, y int, pressure float32) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.conn == nil {
		return nil
	}

	buf := make([]byte, 32)
	buf[0] = ControlTypeInjectTouchEvent
	buf[1] = byte(action)
	binary.BigEndian.PutUint64(buf[2:10], 0)
	binary.BigEndian.PutUint32(buf[10:14], uint32(x))
	binary.BigEndian.PutUint32(buf[14:18], uint32(y))
	binary.BigEndian.PutUint16(buf[18:20], c.screenWidth)
	binary.BigEndian.PutUint16(buf[20:22], c.screenHeight)
	binary.BigEndian.PutUint16(buf[22:24], uint16(pressure*0xFFFF))
	binary.BigEndian.PutUint32(buf[24:28], 0)
	binary.BigEndian.PutUint32(buf[28:32], 0)

	_, err := c.conn.Write(buf)
	return err
}

func (c *ControlChannel) SendTouchEventWithSize(action int, x, y int, screenWidth, screenHeight uint16, pressure float32) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.conn == nil {
		return nil
	}

	buf := make([]byte, 32)
	buf[0] = ControlTypeInjectTouchEvent
	buf[1] = byte(action)
	binary.BigEndian.PutUint64(buf[2:10], 0)
	binary.BigEndian.PutUint32(buf[10:14], uint32(x))
	binary.BigEndian.PutUint32(buf[14:18], uint32(y))
	binary.BigEndian.PutUint16(buf[18:20], screenWidth)
	binary.BigEndian.PutUint16(buf[20:22], screenHeight)
	binary.BigEndian.PutUint16(buf[22:24], uint16(pressure*0xFFFF))
	binary.BigEndian.PutUint32(buf[24:28], 0)
	binary.BigEndian.PutUint32(buf[28:32], 0)

	_, err := c.conn.Write(buf)
	return err
}

func (c *ControlChannel) SendBackOrScreenOn(action int) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.conn == nil {
		return nil
	}

	buf := []byte{ControlTypeBackOrScreenOn, byte(action)}
	_, err := c.conn.Write(buf)
	return err
}

func (c *ControlChannel) SendScrollEvent(x, y int, hscroll, vscroll float32) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.conn == nil {
		return nil
	}

	buf := make([]byte, 21)
	buf[0] = ControlTypeInjectScrollEvent
	binary.BigEndian.PutUint32(buf[1:5], uint32(x))
	binary.BigEndian.PutUint32(buf[5:9], uint32(y))
	binary.BigEndian.PutUint16(buf[9:11], c.screenWidth)
	binary.BigEndian.PutUint16(buf[11:13], c.screenHeight)
	binary.BigEndian.PutUint16(buf[13:15], uint16(int16(hscroll*2048)))
	binary.BigEndian.PutUint16(buf[15:17], uint16(int16(vscroll*2048)))
	binary.BigEndian.PutUint32(buf[17:21], 0)

	_, err := c.conn.Write(buf)
	return err
}

func (c *ControlChannel) SendRotateDevice() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.conn == nil {
		return nil
	}

	buf := []byte{ControlTypeRotateDevice}
	_, err := c.conn.Write(buf)
	return err
}

func (c *ControlChannel) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.conn != nil {
		err := c.conn.Close()
		c.conn = nil
		return err
	}
	return nil
}
