package hdc

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"time"
)

// LogLevel 日志级别
type LogLevel string

const (
	LogLevelDebug   LogLevel = "D"
	LogLevelInfo    LogLevel = "I"
	LogLevelWarning LogLevel = "W"
	LogLevelError   LogLevel = "E"
	LogLevelFatal   LogLevel = "F"
	LogLevelAll     LogLevel = "ALL"
)

// LogEntry 日志条目
type LogEntry struct {
	Timestamp int64  `json:"timestamp"` // 时间戳（毫秒）
	Time      string `json:"time"`      // 时间字符串
	Pid       int    `json:"pid"`       // PID
	Tid       int    `json:"tid"`       // TID
	Level     string `json:"level"`     // 级别
	Tag       string `json:"tag"`       // Tag
	Message   string `json:"message"`   // 消息
	Raw       string `json:"raw"`       // 原始日志行
}

// HilogOptions 日志流选项
type HilogOptions struct {
	Level  *LogLevel `json:"level,omitempty"`  // 日志级别过滤
	Tag    string    `json:"tag,omitempty"`    // Tag 过滤 (支持多个tag，逗号分隔)
	Domain string    `json:"domain,omitempty"` // Domain 过滤
	Pid    string    `json:"pid,omitempty"`    // PID 过滤 (支持多个pid，逗号分隔)
	Regex  string    `json:"regex,omitempty"`  // 正则表达式过滤
}

// hilogStream 日志流
type hilogStream struct {
	connectKey string
	cmd        *exec.Cmd
	cancel     context.CancelFunc
	ctx        context.Context
}

var (
	activeHilogStreams = make(map[string]*hilogStream)
	hilogMutex         sync.RWMutex
)

// StartHilogStream 启动 hilog 日志流
func StartHilogStream(connectKey string, options *HilogOptions, onLogLine func(*LogEntry, error)) error {
	hilogMutex.Lock()
	defer hilogMutex.Unlock()

	// 如果已有活跃的流，先停止
	if stream, exists := activeHilogStreams[connectKey]; exists {
		stream.cancel()
		delete(activeHilogStreams, connectKey)
	}

	// 确保 HDC 可执行文件存在
	if err := EnsureHdcExecutable(); err != nil {
		return fmt.Errorf("HDC executable not found: %v", err)
	}

	// 获取 HDC 路径
	hdcPath := GetHdcPath()
	if hdcPath == "" {
		return fmt.Errorf("HDC path not set")
	}

	// 构建命令参数
	// 固定参数：-v color -v time -v msec -v wrap
	args := []string{"-t", connectKey, "shell", "hilog", "-v", "color", "-v", "time", "-v", "msec", "-v", "wrap"}

	// 添加过滤选项
	if options != nil {
		if options.Level != nil && *options.Level != LogLevelAll {
			args = append(args, "-L", string(*options.Level))
		}
		if options.Tag != "" {
			args = append(args, "-T", options.Tag)
		}
		if options.Domain != "" {
			args = append(args, "-D", options.Domain)
		}
		if options.Pid != "" {
			args = append(args, "-P", options.Pid)
		}
		if options.Regex != "" {
			args = append(args, "-e", options.Regex)
		}
	}

	// 创建上下文
	ctx, cancel := context.WithCancel(context.Background())

	// 创建命令
	cmd := exec.CommandContext(ctx, hdcPath, args...)

	// Windows 下隐藏子进程窗口，防止终端闪烁
	if runtime.GOOS == "windows" {
		HideWindowsConsoleWindow(cmd)
	}

	// 设置环境变量
	env := os.Environ()
	// Windows 不需要设置 DLL 路径，因为 libusb_shared.dll 和 hdc.exe 在同一目录
	if runtime.GOOS != "windows" {
		libusbPath := GetLibusbPath()
		if libusbPath != "" {
			if runtime.GOOS == "darwin" {
				env = append(env, fmt.Sprintf("DYLD_LIBRARY_PATH=%s", libusbPath))
			} else {
				env = append(env, fmt.Sprintf("LD_LIBRARY_PATH=%s", libusbPath))
			}
		}
	}
	cmd.Env = env

	// 创建流对象
	stream := &hilogStream{
		connectKey: connectKey,
		cmd:        cmd,
		cancel:     cancel,
		ctx:        ctx,
	}

	// 获取标准输出
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		cancel()
		return fmt.Errorf("failed to create stdout pipe: %v", err)
	}

	stderr, err := cmd.StderrPipe()
	if err != nil {
		cancel()
		return fmt.Errorf("failed to create stderr pipe: %v", err)
	}

	// 启动命令
	if err := cmd.Start(); err != nil {
		cancel()
		return fmt.Errorf("failed to start hilog command: %v", err)
	}

	// 存储流
	activeHilogStreams[connectKey] = stream

	// 处理标准输出
	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			select {
			case <-ctx.Done():
				return
			default:
				line := scanner.Text()
				if line == "" {
					continue
				}

				// 解析日志行
				entry := parseLogLine(line)
				if onLogLine != nil {
					onLogLine(entry, nil)
				}
			}
		}
		if err := scanner.Err(); err != nil {
			if onLogLine != nil {
				onLogLine(nil, err)
			}
		}
	}()

	// 处理标准错误
	go func() {
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			select {
			case <-ctx.Done():
				return
			default:
				line := scanner.Text()
				if line == "" {
					continue
				}

				// 将 stderr 输出也作为日志行发送
				entry := &LogEntry{
					Timestamp: time.Now().UnixMilli(),
					Time:      "",
					Pid:       0,
					Tid:       0,
					Level:     string(LogLevelWarning),
					Tag:       "stderr",
					Message:   "",
					Raw:       line,
				}
				if onLogLine != nil {
					onLogLine(entry, nil)
				}
			}
		}
		if err := scanner.Err(); err != nil {
			if onLogLine != nil {
				onLogLine(nil, err)
			}
		}
	}()

	// 等待命令退出
	go func() {
		err := cmd.Wait()
		hilogMutex.Lock()
		defer hilogMutex.Unlock()

		// 确保从活跃流列表中移除
		if activeHilogStreams[connectKey] == stream {
			delete(activeHilogStreams, connectKey)
		}

		// 只在异常退出时通知
		if err != nil && ctx.Err() == nil {
			if onLogLine != nil {
				onLogLine(nil, fmt.Errorf("进程异常退出: %v", err))
			}
		}
	}()

	return nil
}

// StopHilogStream 停止 hilog 日志流
func StopHilogStream(connectKey string) error {
	hilogMutex.Lock()
	defer hilogMutex.Unlock()

	stream, exists := activeHilogStreams[connectKey]
	if !exists {
		return nil
	}

	// 取消上下文
	stream.cancel()

	// 尝试优雅终止
	if stream.cmd.Process != nil {
		stream.cmd.Process.Kill()
	}

	// 从活跃流列表中移除
	delete(activeHilogStreams, connectKey)

	return nil
}

// StopAllHilogStreams 停止所有活跃的日志流
func StopAllHilogStreams() {
	hilogMutex.Lock()
	defer hilogMutex.Unlock()

	for connectKey, stream := range activeHilogStreams {
		stream.cancel()
		if stream.cmd.Process != nil {
			stream.cmd.Process.Kill()
		}
		delete(activeHilogStreams, connectKey)
	}
}

// parseLogLine 解析日志行
// 格式: MM-DD HH:mm:ss.mmm  PID   TID LEVEL Tag: message
func parseLogLine(line string) *LogEntry {
	entry := &LogEntry{
		Timestamp: time.Now().UnixMilli(),
		Raw:       line,
	}

	// 简单解析：提取基本信息
	// 这里可以根据实际格式进行更详细的解析
	parts := strings.Fields(line)
	if len(parts) >= 5 {
		// 尝试解析时间
		if len(parts) >= 2 {
			entry.Time = parts[0] + " " + parts[1]
		}
		// 尝试解析 PID 和 TID
		if len(parts) >= 4 {
			fmt.Sscanf(parts[2], "%d", &entry.Pid)
			fmt.Sscanf(parts[3], "%d", &entry.Tid)
		}
		// 尝试解析级别
		if len(parts) >= 5 {
			entry.Level = parts[4]
		}
		// 尝试解析 Tag 和 Message
		if len(parts) >= 6 {
			tagAndMsg := strings.Join(parts[5:], " ")
			if idx := strings.Index(tagAndMsg, ":"); idx >= 0 {
				entry.Tag = strings.TrimSpace(tagAndMsg[:idx])
				entry.Message = strings.TrimSpace(tagAndMsg[idx+1:])
			} else {
				entry.Message = tagAndMsg
			}
		}
	}

	return entry
}
