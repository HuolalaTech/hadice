package adb

import (
	"bytes"
	"context"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const (
	// DefaultTimeout 默认命令执行超时时间（30秒）
	DefaultTimeout = 30 * time.Second
)

// FailedCommand 记录失败的命令
type FailedCommand struct {
	Command   string    `json:"command"`
	Args      []string  `json:"args"`
	Error     string    `json:"error"`
	Timestamp time.Time `json:"timestamp"`
}

var (
	failedCommands []FailedCommand
)

// ExecuteAdb 执行 ADB 命令
// args: ADB 命令参数（不包含 adb 本身）
func ExecuteAdb(args []string) (*AdbResult, error) {
	return ExecuteAdbWithTimeout(args, DefaultTimeout)
}

// ExecuteAdbWithTimeout 执行 ADB 命令（带自定义超时时间）
func ExecuteAdbWithTimeout(args []string, timeout time.Duration) (*AdbResult, error) {
	// 构建完整命令字符串用于日志
	fullCommand := fmt.Sprintf("adb %s", strings.Join(args, " "))
	log.Printf("[ADB] 命令: %s", fullCommand)

	// 确保 ADB 可执行文件存在且有执行权限
	if err := EnsureAdbExecutable(); err != nil {
		log.Printf("[ADB] ❌ ADB 可执行文件检查失败")
		log.Printf("[ADB] ADB 路径: %s", adbPath)
		log.Printf("[ADB] 错误: %v", err)

		return &AdbResult{
			Success: false,
			Output:  "",
			Error:   fmt.Sprintf("ADB executable check failed: %v", err),
		}, err
	}

	// 验证文件权限（额外检查）
	if runtime.GOOS != "windows" {
		if fileInfo, err := os.Stat(adbPath); err == nil {
			mode := fileInfo.Mode()
			if mode&0111 == 0 {
				log.Printf("[ADB] ⚠️ 警告: ADB 文件没有执行权限 (mode: %s)", mode.String())
			}
		}
	}

	// 创建上下文，设置超时
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	// 构建命令
	cmd := exec.CommandContext(ctx, adbPath, args...)

	// Windows 下隐藏子进程窗口，防止终端闪烁
	if runtime.GOOS == "windows" {
		HideWindowsConsoleWindow(cmd)
	}

	// 设置环境变量
	env := os.Environ()

	// 将 adb 目录添加到 PATH
	adbBinDir := filepath.Dir(adbPath)
	pathSeparator := ":"
	if runtime.GOOS == "windows" {
		pathSeparator = ";"
	}

	// 查找现有的 PATH 环境变量
	pathEnv := os.Getenv("PATH")
	if pathEnv != "" {
		pathEnv = fmt.Sprintf("%s%s%s", adbBinDir, pathSeparator, pathEnv)
	} else {
		pathEnv = adbBinDir
	}
	pathEnvStr := fmt.Sprintf("PATH=%s", pathEnv)
	env = append(env, pathEnvStr)

	cmd.Env = env

	// 执行命令
	output, err := cmd.CombinedOutput()
	outputStr := strings.TrimSpace(string(output))

	if err != nil {
		// 记录失败命令
		failedCommands = append(failedCommands, FailedCommand{
			Command:   fullCommand,
			Args:      args,
			Error:     err.Error(),
			Timestamp: time.Now(),
		})

		// 输出错误日志到终端
		log.Printf("[ADB] ❌ 命令执行失败")
		log.Printf("[ADB] 错误类型: %T", err)
		log.Printf("[ADB] 错误信息: %v", err)
		if outputStr != "" {
			log.Printf("[ADB] 命令输出: %s", truncateText(outputStr, 200))
		} else {
			log.Printf("[ADB] 命令输出: (空)")
		}

		// 检查是否是超时错误
		if ctx.Err() == context.DeadlineExceeded {
			log.Printf("[ADB] ⏱️ 命令执行超时")
			return &AdbResult{
				Success: false,
				Output:  outputStr,
				Error:   "Command execution timeout",
			}, err
		}

		// 分离 stdout 和 stderr（如果可能）
		errorMsg := err.Error()
		if outputStr != "" {
			// 如果输出不为空，可能包含错误信息
			errorMsg = outputStr
		}

		return &AdbResult{
			Success: false,
			Output:  outputStr,
			Error:   errorMsg,
		}, err
	}

	// 成功执行
	if outputStr != "" {
		log.Printf("[ADB] 命令输出: %s", truncateText(outputStr, 200))
	} else {
		log.Printf("[ADB] 命令输出: (空)")
	}

	return &AdbResult{
		Success: true,
		Output:  outputStr,
		Error:   "",
	}, nil
}

// LogFailedCommandsSummary 输出失败命令清单（用于应用关闭时调用）
func LogFailedCommandsSummary() {
	if len(failedCommands) > 0 {
		log.Printf("[ADB] 共发现 %d 个失败的ADB命令:", len(failedCommands))
		for i, failed := range failedCommands {
			log.Printf("[ADB] 失败命令 %d: %s", i+1, failed.Command)
			log.Printf("[ADB]   错误: %s", truncateText(failed.Error, 200))
			log.Printf("[ADB]   时间: %s", failed.Timestamp.Format(time.RFC3339))
		}
	}
}

// truncateText 截断过长的文本
func truncateText(text string, maxLength int) string {
	if len(text) <= maxLength {
		return text
	}
	return text[:maxLength] + "... (truncated)"
}

// ExecuteShellCommand 执行复杂的 shell 命令（通过 stdin 传递）
// 这个函数用于处理包含特殊字符（如管道、引号等）的 shell 命令
func ExecuteShellCommand(deviceID, shellCommand string) (*AdbResult, error) {
	return ExecuteShellCommandWithTimeout(deviceID, shellCommand, DefaultTimeout)
}

// ExecuteShellCommandWithTimeout 执行复杂的 shell 命令（通过 stdin 传递，带超时）
func ExecuteShellCommandWithTimeout(deviceID, shellCommand string, timeout time.Duration) (*AdbResult, error) {
	log.Printf("[ADB] Shell 命令 (device: %s): %s", deviceID, shellCommand)

	if err := EnsureAdbExecutable(); err != nil {
		return &AdbResult{
			Success: false,
			Output:  "",
			Error:   fmt.Sprintf("ADB executable check failed: %v", err),
		}, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	// 使用 adb -s <deviceID> shell sh 作为命令，通过 stdin 传递实际的 shell 命令
	args := []string{"-s", deviceID, "shell", "sh"}
	cmd := exec.CommandContext(ctx, adbPath, args...)

	// 设置 stdin 为要执行的命令
	cmd.Stdin = strings.NewReader(shellCommand)

	// 设置环境变量
	env := os.Environ()
	adbBinDir := filepath.Dir(adbPath)
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
	cmd.Env = append(env, fmt.Sprintf("PATH=%s", pathEnv))

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	outputStr := strings.TrimSpace(stdout.String())
	stderrStr := strings.TrimSpace(stderr.String())

	if err != nil {
		log.Printf("[ADB] ❌ Shell 命令执行失败")
		log.Printf("[ADB] 错误: %v", err)
		if outputStr != "" {
			log.Printf("[ADB] 输出: %s", truncateText(outputStr, 200))
		}
		if stderrStr != "" {
			log.Printf("[ADB] stderr: %s", truncateText(stderrStr, 200))
		}

		errorMsg := err.Error()
		if stderrStr != "" {
			errorMsg = stderrStr
		} else if outputStr != "" {
			errorMsg = outputStr
		}

		return &AdbResult{
			Success: false,
			Output:  outputStr,
			Error:   errorMsg,
		}, err
	}

	if outputStr != "" {
		log.Printf("[ADB] 输出: %s", truncateText(outputStr, 200))
	} else {
		log.Printf("[ADB] 输出: (空)")
	}

	return &AdbResult{
		Success: true,
		Output:  outputStr,
		Error:   "",
	}, nil
}

// GetFailedCommandsCount 获取失败命令数量
func GetFailedCommandsCount() int {
	return len(failedCommands)
}
