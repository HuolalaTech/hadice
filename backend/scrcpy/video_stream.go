package scrcpy

import (
	"encoding/binary"
	"io"
	"log"
	"net"
	"sync"
)

type VideoStream struct {
	conn     net.Conn
	codec    *CodecMetadata
	mu       sync.Mutex
	closed   bool
	frameNum int64
}

type VideoFrame struct {
	Data     []byte
	Config   bool
	KeyFrame bool
	PTS      int64
}

func NewVideoStream(conn net.Conn, codec *CodecMetadata) *VideoStream {
	return &VideoStream{
		conn:  conn,
		codec: codec,
	}
}

func (v *VideoStream) ReadFrame() (*VideoFrame, error) {
	v.mu.Lock()
	defer v.mu.Unlock()

	if v.closed || v.conn == nil {
		return nil, io.ErrClosedPipe
	}

	header := make([]byte, 12)
	if _, err := io.ReadFull(v.conn, header); err != nil {
		log.Printf("[VideoStream] Failed to read header: %v", err)
		return nil, err
	}

	ptsAndFlags := binary.BigEndian.Uint64(header[0:8])
	packetSize := binary.BigEndian.Uint32(header[8:12])

	config := (ptsAndFlags>>63)&1 == 1
	keyframe := (ptsAndFlags>>62)&1 == 1
	pts := int64(ptsAndFlags & 0x3FFFFFFFFFFFFFFF)

	if packetSize > 10*1024*1024 {
		log.Printf("[VideoStream] Packet size too large: %d (header: %x)", packetSize, header)
		return nil, io.ErrShortBuffer
	}

	frame := &VideoFrame{
		Config:   config,
		KeyFrame: keyframe,
		PTS:      pts,
	}

	frame.Data = make([]byte, packetSize)
	if _, err := io.ReadFull(v.conn, frame.Data); err != nil {
		log.Printf("[VideoStream] Failed to read frame data (size=%d): %v", packetSize, err)
		return nil, err
	}

	v.frameNum++

	return frame, nil
}

func (v *VideoStream) Close() error {
	v.mu.Lock()
	defer v.mu.Unlock()

	v.closed = true
	if v.conn != nil {
		err := v.conn.Close()
		v.conn = nil
		log.Printf("[VideoStream] Closed, total frames: %d", v.frameNum)
		return err
	}
	return nil
}

func (v *VideoStream) Codec() *CodecMetadata {
	return v.codec
}

func (v *VideoStream) IsClosed() bool {
	v.mu.Lock()
	defer v.mu.Unlock()
	return v.closed
}
