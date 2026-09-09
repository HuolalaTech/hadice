package adb

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

type LogcatLogLevel string

const (
	LogcatLevelVerbose LogcatLogLevel = "V"
	LogcatLevelDebug   LogcatLogLevel = "D"
	LogcatLevelInfo    LogcatLogLevel = "I"
	LogcatLevelWarn    LogcatLogLevel = "W"
	LogcatLevelError   LogcatLogLevel = "E"
	LogcatLevelFatal   LogcatLogLevel = "F"
)

type LogcatEntry struct {
	Timestamp int64          `json:"timestamp"`
	Time      string         `json:"time"`
	Pid       int            `json:"pid"`
	Tid       int            `json:"tid"`
	Level     LogcatLogLevel `json:"level"`
	Tag       string         `json:"tag"`
	Message   string         `json:"message"`
	Raw       string         `json:"raw"`
}

type LogcatOptions struct {
	Level  *LogcatLogLevel `json:"level,omitempty"`
	Tag    string          `json:"tag,omitempty"`
	Pid    string          `json:"pid,omitempty"`
	Regex  string          `json:"regex,omitempty"`
	Format string          `json:"format,omitempty"`
}

type logcatStream struct {
	deviceId string
	cmd      *exec.Cmd
	cancel   context.CancelFunc
	ctx      context.Context
}

var (
	activeLogcatStreams = make(map[string]*logcatStream)
	logcatMutex         sync.RWMutex
)

func StartLogcatStream(deviceId string, options *LogcatOptions, onLogLine func(*LogcatEntry, error)) error {
	logcatMutex.Lock()
	defer logcatMutex.Unlock()

	if stream, exists := activeLogcatStreams[deviceId]; exists {
		stream.cancel()
		delete(activeLogcatStreams, deviceId)
	}

	if err := EnsureAdbExecutable(); err != nil {
		return fmt.Errorf("ADB executable not found: %v", err)
	}

	if adbPath == "" {
		return fmt.Errorf("ADB path not set")
	}

	args := []string{"-s", deviceId, "logcat", "-v", "threadtime"}

	if options != nil && options.Format != "" {
		args = []string{"-s", deviceId, "logcat", "-v", options.Format}
	}

	if options != nil && options.Pid != "" {
		args = append(args, "--pid", options.Pid)
	}

	if options != nil && options.Tag != "" && options.Level != nil {
		args = append(args, fmt.Sprintf("%s:%s", options.Tag, string(*options.Level)))
		args = append(args, "*:S")
	} else if options != nil && options.Level != nil {
		args = append(args, fmt.Sprintf("*:%s", string(*options.Level)))
	}

	ctx, cancel := context.WithCancel(context.Background())

	cmd := exec.CommandContext(ctx, adbPath, args...)

	if runtime.GOOS == "windows" {
		HideWindowsConsoleWindow(cmd)
	}

	env := os.Environ()
	adbBinDir := GetResourcesDir()
	pathSeparator := ":"
	if runtime.GOOS == "windows" {
		pathSeparator = ";"
	}

	pathEnv := os.Getenv("PATH")
	if pathEnv != "" {
		pathEnv = fmt.Sprintf("%s%s%s", adbBinDir, pathSeparator, pathEnv)
	} else {
		pathEnv = adbBinDir
	}
	env = append(env, fmt.Sprintf("PATH=%s", pathEnv))
	cmd.Env = env

	stream := &logcatStream{
		deviceId: deviceId,
		cmd:      cmd,
		cancel:   cancel,
		ctx:      ctx,
	}

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

	if err := cmd.Start(); err != nil {
		cancel()
		return fmt.Errorf("failed to start logcat command: %v", err)
	}

	activeLogcatStreams[deviceId] = stream

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

				entry := parseLogcatLine(line)
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

				entry := &LogcatEntry{
					Timestamp: time.Now().UnixMilli(),
					Time:      "",
					Pid:       0,
					Tid:       0,
					Level:     LogcatLevelWarn,
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

	go func() {
		err := cmd.Wait()
		logcatMutex.Lock()
		defer logcatMutex.Unlock()

		if activeLogcatStreams[deviceId] == stream {
			delete(activeLogcatStreams, deviceId)
		}

		if err != nil && ctx.Err() == nil {
			if onLogLine != nil {
				onLogLine(nil, fmt.Errorf("进程异常退出: %v", err))
			}
		}
	}()

	return nil
}

func StopLogcatStream(deviceId string) error {
	logcatMutex.Lock()
	defer logcatMutex.Unlock()

	stream, exists := activeLogcatStreams[deviceId]
	if !exists {
		return nil
	}

	stream.cancel()

	if stream.cmd.Process != nil {
		stream.cmd.Process.Kill()
	}

	delete(activeLogcatStreams, deviceId)

	return nil
}

func StopAllLogcatStreams() {
	logcatMutex.Lock()
	defer logcatMutex.Unlock()

	for deviceId, stream := range activeLogcatStreams {
		stream.cancel()
		if stream.cmd.Process != nil {
			stream.cmd.Process.Kill()
		}
		delete(activeLogcatStreams, deviceId)
	}
}

func parseLogcatLine(line string) *LogcatEntry {
	entry := &LogcatEntry{
		Timestamp: time.Now().UnixMilli(),
		Raw:       line,
	}

	parts := strings.Fields(line)
	if len(parts) >= 5 {
		if len(parts) >= 2 {
			entry.Time = parts[0] + " " + parts[1]
		}
		if len(parts) >= 3 {
			fmt.Sscanf(parts[2], "%d", &entry.Pid)
		}
		if len(parts) >= 4 {
			fmt.Sscanf(parts[3], "%d", &entry.Tid)
		}
		if len(parts) >= 5 {
			entry.Level = LogcatLogLevel(parts[4])
		}
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
