package backend

import (
	"context"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	gos "runtime"
	"sync"
	"time"

	"Hadice/backend/hdc"

	"github.com/creack/pty"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// ShellProcess 表示一个 Shell 进程
type ShellProcess struct {
	ID       string
	Pty      *os.File
	Cmd      *exec.Cmd
	ctx      context.Context
	cancel   context.CancelFunc
	mu       sync.Mutex
	isClosed bool
}

var (
	// activeShells 存储所有活跃的 Shell 进程
	activeShells = make(map[string]*ShellProcess)
	shellMutex   sync.RWMutex
)

// StartShell 启动一个本地 Shell 终端
// shellId: Shell 进程的唯一标识符
func (a *App) StartShell(shellId string) (bool, error) {
	shellMutex.Lock()
	defer shellMutex.Unlock()

	// 如果已有活跃的进程，先停止
	if existing, ok := activeShells[shellId]; ok {
		existing.stop()
		delete(activeShells, shellId)
	}

	// 确定 shell 命令
	var shellCommand string
	var shellArgs []string

	if gos.GOOS == "windows" {
		// Windows 使用 cmd.exe
		shellCommand = os.Getenv("COMSPEC")
		if shellCommand == "" {
			shellCommand = "cmd.exe"
		}
		shellArgs = []string{}
	} else {
		// macOS/Linux 使用用户的默认 shell
		shellCommand = os.Getenv("SHELL")
		if shellCommand == "" {
			shellCommand = "/bin/bash"
		}
		shellArgs = []string{}
	}

	// 获取 hdc 二进制文件所在目录
	hdcBinDir := filepath.Dir(hdc.GetHdcPath())
	libusbPath := hdc.GetLibusbPath()

	// 构建环境变量
	env := os.Environ()
	pathSeparator := ":"
	if gos.GOOS == "windows" {
		pathSeparator = ";"
	}

	// 扩展 PATH 环境变量
	pathEnv := os.Getenv("PATH")
	if pathEnv != "" {
		pathEnv = fmt.Sprintf("%s%s%s", hdcBinDir, pathSeparator, pathEnv)
	} else {
		pathEnv = hdcBinDir
	}
	env = append(env, fmt.Sprintf("PATH=%s", pathEnv))

	// 设置库路径（macOS/Linux）
	if gos.GOOS != "windows" {
		env = append(env, fmt.Sprintf("DYLD_LIBRARY_PATH=%s", libusbPath))
		env = append(env, fmt.Sprintf("LD_LIBRARY_PATH=%s", libusbPath))
	}

	// 设置终端类型
	env = append(env, "TERM=xterm-256color")

	// 创建命令
	cmd := exec.Command(shellCommand, shellArgs...)
	cmd.Env = env

	// Windows 下隐藏子进程窗口，防止终端闪烁
	if gos.GOOS == "windows" {
		hdc.HideWindowsConsoleWindow(cmd)
	}

	// 获取用户主目录
	homeDir, err := hdc.GetUserHomeDirectory()
	if err != nil {
		homeDir = os.Getenv("HOME")
		if homeDir == "" {
			homeDir = os.Getenv("USERPROFILE")
		}
	}
	cmd.Dir = homeDir

	// 创建 PTY
	ptmx, err := pty.Start(cmd)
	if err != nil {
		log.Printf("[Shell] Failed to start PTY for %s: %v", shellId, err)
		return false, fmt.Errorf("failed to start PTY: %v", err)
	}

	// 设置初始大小
	pty.Setsize(ptmx, &pty.Winsize{
		Rows: 24,
		Cols: 80,
	})

	// 创建上下文用于取消
	ctx, cancel := context.WithCancel(context.Background())

	// 创建 ShellProcess
	shellProcess := &ShellProcess{
		ID:     shellId,
		Pty:    ptmx,
		Cmd:    cmd,
		ctx:    ctx,
		cancel: cancel,
	}

	// 存储进程
	activeShells[shellId] = shellProcess

	// 启动 goroutine 读取输出
	go shellProcess.readOutput(a.ctx, shellId)

	// 启动 goroutine 等待进程退出
	go shellProcess.waitForExit(a.ctx, shellId)

	log.Printf("[Shell] Shell started successfully: %s (PID: %d)", shellId, cmd.Process.Pid)

	// 等待一小段时间，确保 shell 完全启动
	time.Sleep(200 * time.Millisecond)

	return true, nil
}

// WriteToShell 向 Shell 写入数据
func (a *App) WriteToShell(shellId string, data string) error {
	shellMutex.RLock()
	shellProcess, ok := activeShells[shellId]
	shellMutex.RUnlock()

	if !ok {
		return fmt.Errorf("shell %s not found", shellId)
	}

	shellProcess.mu.Lock()
	defer shellProcess.mu.Unlock()

	if shellProcess.isClosed {
		return fmt.Errorf("shell %s is closed", shellId)
	}

	_, err := shellProcess.Pty.WriteString(data)
	if err != nil {
		log.Printf("[Shell] Failed to write to shell %s: %v", shellId, err)
		return fmt.Errorf("failed to write to shell: %v", err)
	}

	return nil
}

// ResizeShell 调整 Shell 终端大小
func (a *App) ResizeShell(shellId string, cols int, rows int) error {
	shellMutex.RLock()
	shellProcess, ok := activeShells[shellId]
	shellMutex.RUnlock()

	if !ok {
		return fmt.Errorf("shell %s not found", shellId)
	}

	shellProcess.mu.Lock()
	defer shellProcess.mu.Unlock()

	if shellProcess.isClosed {
		return fmt.Errorf("shell %s is closed", shellId)
	}

	// 确保大小至少为 1x1
	if cols < 1 {
		cols = 1
	}
	if rows < 1 {
		rows = 1
	}

	err := pty.Setsize(shellProcess.Pty, &pty.Winsize{
		Cols: uint16(cols),
		Rows: uint16(rows),
	})
	if err != nil {
		log.Printf("[Shell] Failed to resize shell %s: %v", shellId, err)
		return fmt.Errorf("failed to resize shell: %v", err)
	}

	return nil
}

// StopShell 停止 Shell 进程
func (a *App) StopShell(shellId string) error {
	shellMutex.Lock()
	defer shellMutex.Unlock()

	shellProcess, ok := activeShells[shellId]
	if !ok {
		return fmt.Errorf("shell %s not found", shellId)
	}

	shellProcess.stop()
	delete(activeShells, shellId)

	log.Printf("[Shell] Shell stopped: %s", shellId)
	return nil
}

// StopAllShells 停止所有 Shell 进程
func (a *App) StopAllShells() error {
	shellMutex.Lock()
	defer shellMutex.Unlock()

	for shellId, shellProcess := range activeShells {
		shellProcess.stop()
		log.Printf("[Shell] Shell stopped: %s", shellId)
	}

	activeShells = make(map[string]*ShellProcess)
	log.Printf("[Shell] All shells stopped")
	return nil
}

// readOutput 读取 Shell 输出并发送事件
func (sp *ShellProcess) readOutput(ctx context.Context, shellId string) {
	buffer := make([]byte, 4096)
	for {
		select {
		case <-ctx.Done():
			return
		default:
			sp.mu.Lock()
			if sp.isClosed {
				sp.mu.Unlock()
				return
			}
			sp.mu.Unlock()

			n, err := sp.Pty.Read(buffer)
			if err != nil {
				if err != io.EOF {
					log.Printf("[Shell] Error reading from shell %s: %v", shellId, err)
				}
				return
			}

			if n > 0 {
				data := string(buffer[:n])
				// 发送 stdout 事件
				app := application.Get()
				if app != nil {
					app.Event.Emit(fmt.Sprintf("shell:stdout:%s", shellId), data)
				}
			}
		}
	}
}

// waitForExit 等待 Shell 进程退出
func (sp *ShellProcess) waitForExit(ctx context.Context, shellId string) {
	err := sp.Cmd.Wait()
	if err != nil {
		log.Printf("[Shell] Shell %s exited with error: %v", shellId, err)
	}

	exitCode := 0
	signal := ""

	if sp.Cmd.ProcessState != nil {
		exitCode = sp.Cmd.ProcessState.ExitCode()
		// 在 Unix 系统上，可以通过 ProcessState.Sys() 获取信号信息
		// 这里简化处理
	}

	sp.mu.Lock()
	sp.isClosed = true
	sp.mu.Unlock()

	// 发送退出事件
	app := application.Get()
	if app != nil {
		app.Event.Emit(fmt.Sprintf("shell:exit:%s", shellId), map[string]interface{}{
			"code":   exitCode,
			"signal": signal,
		})
	}

	// 清理资源
	sp.stop()
}

// stop 停止 Shell 进程
func (sp *ShellProcess) stop() {
	sp.mu.Lock()
	defer sp.mu.Unlock()

	if sp.isClosed {
		return
	}

	sp.isClosed = true
	sp.cancel()

	if sp.Cmd != nil && sp.Cmd.Process != nil {
		sp.Cmd.Process.Kill()
	}

	if sp.Pty != nil {
		sp.Pty.Close()
	}
}
