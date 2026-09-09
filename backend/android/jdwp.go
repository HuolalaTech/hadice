package android

import (
	"bytes"
	"encoding/binary"
	"errors"
	"io"
	"net"
	"time"
)

// jdwpIOTimeout 是 JDWP 读写单次操作的超时，防止 am attach-agent 失败回退到
// JDWP 时因目标进程无 JDWP 响应而永久阻塞。
const jdwpIOTimeout = 5 * time.Second

func Handshake(conn net.Conn) error {
	if err := conn.SetWriteDeadline(time.Now().Add(jdwpIOTimeout)); err != nil {
		return err
	}
	_, err := conn.Write([]byte(JDWPHandshake))
	if err != nil {
		return err
	}

	response := make([]byte, 14)
	if err := conn.SetReadDeadline(time.Now().Add(jdwpIOTimeout)); err != nil {
		return err
	}
	_, err = io.ReadFull(conn, response)
	if err != nil {
		return err
	}
	// 清除后续读写超时（命令交互由调用方控制）
	_ = conn.SetDeadline(time.Time{})

	if string(response) != JDWPHandshake {
		return errors.New("JDWP handshake failed: invalid response")
	}

	return nil
}

func SendCommand(conn net.Conn, cmd JDWPCommand) error {
	dataLen := len(cmd.Data)
	totalLen := int32(11 + dataLen)

	buf := new(bytes.Buffer)
	if err := binary.Write(buf, binary.BigEndian, totalLen); err != nil {
		return err
	}
	if err := binary.Write(buf, binary.BigEndian, cmd.ID); err != nil {
		return err
	}
	if err := buf.WriteByte(cmd.Flags); err != nil {
		return err
	}
	if err := buf.WriteByte(cmd.CommandSet); err != nil {
		return err
	}
	if err := buf.WriteByte(cmd.Command); err != nil {
		return err
	}
	if dataLen > 0 {
		if _, err := buf.Write(cmd.Data); err != nil {
			return err
		}
	}

	_, err := conn.Write(buf.Bytes())
	return err
}

func ReadReply(conn net.Conn) (*JDWPReply, error) {
	var length int32
	if err := binary.Read(conn, binary.BigEndian, &length); err != nil {
		return nil, err
	}

	if length < 11 {
		return nil, errors.New("invalid JDWP reply length")
	}

	data := make([]byte, length-4)
	if _, err := io.ReadFull(conn, data); err != nil {
		return nil, err
	}

	reply := &JDWPReply{
		ID:    int32(binary.BigEndian.Uint32(data[0:4])),
		Flags: data[4],
	}

	if reply.Flags&0x80 != 0 {
		if len(data) < 7 {
			return nil, errors.New("invalid JDWP error reply")
		}
		reply.ErrorCode = int16(binary.BigEndian.Uint16(data[5:7]))
		reply.Data = data[7:]
	} else {
		reply.ErrorCode = 0
		reply.Data = data[5:]
	}

	return reply, nil
}

func BuildLoadAgentData(agentPath string, options string) []byte {
	buf := new(bytes.Buffer)

	agentPathBytes := []byte(agentPath)
	binary.Write(buf, binary.BigEndian, int32(len(agentPathBytes)))
	buf.Write(agentPathBytes)

	optionsBytes := []byte(options)
	binary.Write(buf, binary.BigEndian, int32(len(optionsBytes)))
	buf.Write(optionsBytes)

	return buf.Bytes()
}

func ParseVersion(data []byte) (string, error) {
	if len(data) < 4 {
		return "", errors.New("invalid version data")
	}

	descLen := int(binary.BigEndian.Uint32(data[0:4]))
	if len(data) < 4+descLen {
		return "", errors.New("invalid version description length")
	}

	return string(data[4 : 4+descLen]), nil
}
