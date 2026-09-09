package hdc

import (
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

// ExecuteHdc 执行 HDC 命令
// args: HDC 命令参数（不包含 hdc 本身）
func ExecuteHdc(args []string) (*HdcResult, error) {
	return ExecuteHdcWithTimeout(args, DefaultTimeout)
}

// ExecuteHdcWithTimeout 执行 HDC 命令（带自定义超时时间）
func ExecuteHdcWithTimeout(args []string, timeout time.Duration) (*HdcResult, error) {
	// 构建完整命令字符串用于日志
	fullCommand := fmt.Sprintf("hdc %s", strings.Join(args, " "))
	// log.Printf("[HDC] ========== 开始执行 HDC 命令 ==========")
	log.Printf("[HDC] 命令: %s", fullCommand)
	// log.Printf("[HDC] 超时时间: %v", timeout)

	// 确保 HDC 可执行文件存在且有执行权限
	if err := EnsureHdcExecutable(); err != nil {
		log.Printf("[HDC] ❌ HDC 可执行文件检查失败")
		// log.Printf("[HDC] HDC 路径: %s", hdcPath)
		// log.Printf("[HDC] 资源目录: %s", resourcesDir)
		log.Printf("[HDC] 错误: %v", err)

		// 尝试检查文件是否存在
		if fileInfo, statErr := os.Stat(hdcPath); statErr == nil {
			log.Printf("[HDC] 文件存在，但权限检查失败")
			log.Printf("[HDC] 文件权限: %s", fileInfo.Mode().String())
			log.Printf("[HDC] 文件大小: %d 字节", fileInfo.Size())
		} else {
			log.Printf("[HDC] 文件不存在: %v", statErr)
		}

		// log.Printf("[HDC] ========================================")
		return &HdcResult{
			Success: false,
			Output:  "",
			Error:   fmt.Sprintf("HDC executable check failed: %v", err),
		}, err
	}

	// 验证文件权限（额外检查）
	if runtime.GOOS != "windows" {
		if fileInfo, err := os.Stat(hdcPath); err == nil {
			mode := fileInfo.Mode()
			if mode&0111 == 0 {
				log.Printf("[HDC] ⚠️ 警告: HDC 文件没有执行权限 (mode: %s)", mode.String())
			} else {
				// log.Printf("[HDC] ✅ HDC 文件权限正常 (mode: %s)", mode.String())
			}
		}
	}

	// log.Printf("[HDC] ✅ HDC 可执行文件检查通过")
	// log.Printf("[HDC] HDC 路径: %s", hdcPath)
	// log.Printf("[HDC] 资源目录: %s", resourcesDir)
	// log.Printf("[HDC] libusb 路径: %s", libusbPath)

	// 创建上下文，设置超时
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	// 构建命令
	cmd := exec.CommandContext(ctx, hdcPath, args...)

	// Windows 下隐藏子进程窗口，防止终端闪烁
	if runtime.GOOS == "windows" {
		HideWindowsConsoleWindow(cmd)
	}

	// 设置环境变量
	env := os.Environ()

	// 添加 libusb 路径到库路径环境变量（仅 Unix 系统）
	// Windows 不需要设置 DLL 路径，因为 libusb_shared.dll 和 hdc.exe 在同一目录，
	// 通过 PATH 环境变量会自动找到
	if runtime.GOOS != "windows" {
		if runtime.GOOS == "darwin" {
			// macOS 使用 DYLD_LIBRARY_PATH
			libPathEnv := fmt.Sprintf("DYLD_LIBRARY_PATH=%s", libusbPath)
			env = append(env, libPathEnv)
			// log.Printf("[HDC] 设置环境变量: %s", libPathEnv)
		} else {
			// Linux 使用 LD_LIBRARY_PATH
			libPathEnv := fmt.Sprintf("LD_LIBRARY_PATH=%s", libusbPath)
			env = append(env, libPathEnv)
			// log.Printf("[HDC] 设置环境变量: %s", libPathEnv)
		}
	} else {
		log.Printf("[HDC] Windows 平台：DLL 将通过 PATH 自动加载")
	}

	// 将 hdc 目录添加到 PATH
	hdcBinDir := filepath.Dir(hdcPath)
	pathSeparator := ":"
	if runtime.GOOS == "windows" {
		pathSeparator = ";"
	}

	// 查找现有的 PATH 环境变量
	pathEnv := os.Getenv("PATH")
	if pathEnv != "" {
		pathEnv = fmt.Sprintf("%s%s%s", hdcBinDir, pathSeparator, pathEnv)
	} else {
		pathEnv = hdcBinDir
	}
	pathEnvStr := fmt.Sprintf("PATH=%s", pathEnv)
	env = append(env, pathEnvStr)
	// log.Printf("[HDC] 设置环境变量: PATH=%s", pathEnv)

	cmd.Env = env
	// log.Printf("[HDC] 工作目录: %s", cmd.Dir)
	// log.Printf("[HDC] 平台: %s/%s", runtime.GOOS, runtime.GOARCH)

	// 执行命令
	// log.Printf("[HDC] 开始执行命令...")
	// startTime := time.Now()
	output, err := cmd.CombinedOutput()
	// duration := time.Since(startTime)
	outputStr := strings.TrimSpace(string(output))
	// log.Printf("[HDC] 命令执行耗时: %v", duration)

	if err != nil {
		// 记录失败命令
		failedCommands = append(failedCommands, FailedCommand{
			Command:   fullCommand,
			Args:      args,
			Error:     err.Error(),
			Timestamp: time.Now(),
		})

		// 输出错误日志到终端
		log.Printf("[HDC] ❌ 命令执行失败")
		log.Printf("[HDC] 错误类型: %T", err)
		log.Printf("[HDC] 错误信息: %v", err)
		if outputStr != "" {
			log.Printf("[HDC] 命令输出: %s", truncateText(outputStr, 200))
		} else {
			log.Printf("[HDC] 命令输出: (空)")
		}

		// 检查是否是超时错误
		if ctx.Err() == context.DeadlineExceeded {
			log.Printf("[HDC] ⏱️ 命令执行超时")
			// log.Printf("[HDC] ========================================")
			return &HdcResult{
				Success: false,
				Output:  outputStr,
				Error:   "Command execution timeout",
			}, err
		}

		// 分离 stdout 和 stderr（如果可能）
		// 由于 CombinedOutput 合并了输出，我们尝试从错误信息中提取
		errorMsg := err.Error()
		if outputStr != "" {
			// 如果输出不为空，可能包含错误信息
			errorMsg = outputStr
		}

		// log.Printf("[HDC] ========================================")
		return &HdcResult{
			Success: false,
			Output:  outputStr,
			Error:   errorMsg,
		}, err
	}

	// 成功执行
	if outputStr != "" {
		log.Printf("[HDC] 命令输出: %s", truncateText(outputStr, 200))
	} else {
		log.Printf("[HDC] 命令输出: (空)")
	}
	// log.Printf("[HDC] ========================================")

	return &HdcResult{
		Success: true,
		Output:  outputStr,
		Error:   "",
	}, nil
}

// LogFailedCommandsSummary 输出失败命令清单（用于应用关闭时调用）
func LogFailedCommandsSummary() {
	if len(failedCommands) > 0 {
		log.Printf("[HDC] 共发现 %d 个失败的HDC命令:", len(failedCommands))
		for i, failed := range failedCommands {
			log.Printf("[HDC] 失败命令 %d: %s", i+1, failed.Command)
			log.Printf("[HDC]   错误: %s", truncateText(failed.Error, 200))
			log.Printf("[HDC]   时间: %s", failed.Timestamp.Format(time.RFC3339))
		}
	}
}

// ExecuteHdcWithStdin 执行 HDC 命令（带 stdin 输入）
// 用于需要通过标准输入传入数据的场景，如 hiprofiler_cmd 的配置文件
func ExecuteHdcWithStdin(args []string, stdinContent string, timeout time.Duration) (*HdcResult, error) {
	fullCommand := fmt.Sprintf("hdc %s", strings.Join(args, " "))
	log.Printf("[HDC] 命令(stdin): %s", fullCommand)

	if err := EnsureHdcExecutable(); err != nil {
		log.Printf("[HDC] ❌ HDC 可执行文件检查失败: %v", err)
		return &HdcResult{
			Success: false,
			Output:  "",
			Error:   fmt.Sprintf("HDC executable check failed: %v", err),
		}, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, hdcPath, args...)

	if runtime.GOOS == "windows" {
		HideWindowsConsoleWindow(cmd)
	}

	// 设置 stdin
	cmd.Stdin = strings.NewReader(stdinContent)

	// 设置环境变量
	env := os.Environ()
	if runtime.GOOS != "windows" {
		if runtime.GOOS == "darwin" {
			env = append(env, fmt.Sprintf("DYLD_LIBRARY_PATH=%s", libusbPath))
		} else {
			env = append(env, fmt.Sprintf("LD_LIBRARY_PATH=%s", libusbPath))
		}
	}

	hdcBinDir := filepath.Dir(hdcPath)
	pathSeparator := ":"
	if runtime.GOOS == "windows" {
		pathSeparator = ";"
	}
	pathEnv := os.Getenv("PATH")
	if pathEnv != "" {
		pathEnv = fmt.Sprintf("%s%s%s", hdcBinDir, pathSeparator, pathEnv)
	} else {
		pathEnv = hdcBinDir
	}
	env = append(env, fmt.Sprintf("PATH=%s", pathEnv))
	cmd.Env = env

	output, err := cmd.CombinedOutput()
	outputStr := strings.TrimSpace(string(output))

	if err != nil {
		log.Printf("[HDC] ❌ 命令执行失败: %v", err)
		if ctx.Err() == context.DeadlineExceeded {
			return &HdcResult{
				Success: false,
				Output:  outputStr,
				Error:   "Command execution timeout",
			}, err
		}
		errorMsg := err.Error()
		if outputStr != "" {
			errorMsg = outputStr
		}
		return &HdcResult{
			Success: false,
			Output:  outputStr,
			Error:   errorMsg,
		}, err
	}

	if outputStr != "" {
		log.Printf("[HDC] 命令输出: %s", truncateText(outputStr, 200))
	}

	return &HdcResult{
		Success: true,
		Output:  outputStr,
		Error:   "",
	}, nil
}

// truncateText 截断过长的文本
func truncateText(text string, maxLength int) string {
	if len(text) <= maxLength {
		return text
	}
	return text[:maxLength] + "... (truncated)"
}

// GetFailedCommandsCount 获取失败命令数量
func GetFailedCommandsCount() int {
	return len(failedCommands)
}
