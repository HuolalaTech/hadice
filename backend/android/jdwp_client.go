package android

import (
	"fmt"
	"net"
	"sync"
	"time"
)

type JDWPClient struct {
	conn   net.Conn
	nextID int32
	mu     sync.Mutex
}

func NewJDWPClient(host string, port int) (*JDWPClient, error) {
	addr := fmt.Sprintf("%s:%d", host, port)
	conn, err := net.DialTimeout("tcp", addr, 10*time.Second)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to JDWP: %w", err)
	}

	if err := Handshake(conn); err != nil {
		conn.Close()
		return nil, fmt.Errorf("JDWP handshake failed: %w", err)
	}

	return &JDWPClient{conn: conn}, nil
}

func (c *JDWPClient) LoadAgent(agentPath string, options string) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.nextID++

	data := BuildLoadAgentData(agentPath, options)

	cmd := JDWPCommand{
		ID:         c.nextID,
		Flags:      0,
		CommandSet: CommandSetVirtualMachine,
		Command:    CommandLoadAgent,
		Data:       data,
	}

	if err := SendCommand(c.conn, cmd); err != nil {
		return fmt.Errorf("failed to send LoadAgent command: %w", err)
	}

	reply, err := ReadReply(c.conn)
	if err != nil {
		return fmt.Errorf("failed to read LoadAgent reply: %w", err)
	}

	if reply.ErrorCode != 0 {
		return fmt.Errorf("LoadAgent failed with error code: %d", reply.ErrorCode)
	}

	return nil
}

func (c *JDWPClient) GetVersion() (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.nextID++

	cmd := JDWPCommand{
		ID:         c.nextID,
		Flags:      0,
		CommandSet: CommandSetVirtualMachine,
		Command:    CommandVersion,
		Data:       nil,
	}

	if err := SendCommand(c.conn, cmd); err != nil {
		return "", fmt.Errorf("failed to send Version command: %w", err)
	}

	reply, err := ReadReply(c.conn)
	if err != nil {
		return "", fmt.Errorf("failed to read Version reply: %w", err)
	}

	if reply.ErrorCode != 0 {
		return "", fmt.Errorf("Version command failed with error code: %d", reply.ErrorCode)
	}

	return ParseVersion(reply.Data)
}

func (c *JDWPClient) Close() error {
	if c.conn != nil {
		return c.conn.Close()
	}
	return nil
}
