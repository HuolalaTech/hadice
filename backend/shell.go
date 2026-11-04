package backend

import (
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	runtime "runtime"
	"strings"
	"sync"

	"Hadice/backend/hdc"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// shellTerminal is a running platform shell session. Unix implementations use
// a PTY and Windows uses ConPTY.
type shellTerminal interface {
	io.Reader
	io.Writer
	io.Closer
	Resize(cols, rows uint16) error
	PID() int
	Wait() (int, error)
}

type shellTerminalConfig struct {
	Command string
	Dir     string
	Env     []string
}

const maxShellScrollback = 256 * 1024

// ShellProcess represents one local shell session.
type ShellProcess struct {
	ID         string
	Pty        shellTerminal
	mu         sync.Mutex
	scrollMu   sync.Mutex
	scrollback []byte
	isClosed   bool
	close      sync.Once
}

// ShellTabInfo 前端终端 Tab（跨主窗/独立窗共享）。
type ShellTabInfo struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

// ShellUIState 终端 UI 状态：tabs + xterm serialize 快照。
// ponytail: 存在 Go 进程内存，因 Wails 双 WebView 不共享 localStorage。
type ShellUIState struct {
	Tabs        []ShellTabInfo     `json:"tabs"`
	ActiveTabId string             `json:"activeTabId"`
	TabSeq      int                `json:"tabSeq"`
	Snapshots   map[string]string  `json:"snapshots"`
}

var (
	activeShells = make(map[string]*ShellProcess)
	shellMutex   sync.RWMutex

	shellUIMu sync.Mutex
	shellUI   = ShellUIState{
		Tabs:      nil,
		Snapshots: map[string]string{},
	}
)

// StartShell starts a local command shell.
// 若同 ID 已在跑，直接附着（不重建），便于主窗 / 独立窗切换复用会话。
func (a *App) StartShell(shellId string) (bool, error) {
	shellMutex.Lock()
	defer shellMutex.Unlock()

	if _, ok := activeShells[shellId]; ok {
		log.Printf("[Shell] Attach existing shell: %s", shellId)
		return true, nil
	}

	shellCommand := os.Getenv("SHELL")
	if runtime.GOOS == "windows" {
		shellCommand = os.Getenv("COMSPEC")
		if shellCommand == "" {
			shellCommand = "cmd.exe"
		}
	} else if shellCommand == "" {
		shellCommand = "/bin/bash"
	}

	hdcBinDir := filepath.Dir(hdc.GetHdcPath())
	pathEnv := os.Getenv("PATH")
	if pathEnv != "" {
		pathEnv = hdcBinDir + string(os.PathListSeparator) + pathEnv
	} else {
		pathEnv = hdcBinDir
	}

	env := os.Environ()
	env = setShellEnv(env, "PATH", pathEnv)
	env = setShellEnv(env, "TERM", "xterm-256color")
	if runtime.GOOS != "windows" {
		libusbPath := hdc.GetLibusbPath()
		env = setShellEnv(env, "DYLD_LIBRARY_PATH", libusbPath)
		env = setShellEnv(env, "LD_LIBRARY_PATH", libusbPath)
	}

	homeDir, err := hdc.GetUserHomeDirectory()
	if err != nil || homeDir == "" {
		homeDir = os.Getenv("HOME")
		if homeDir == "" {
			homeDir = os.Getenv("USERPROFILE")
		}
	}

	terminal, err := startShellTerminal(shellTerminalConfig{
		Command: shellCommand,
		Dir:     homeDir,
		Env:     env,
	})
	if err != nil {
		log.Printf("[Shell] Failed to start terminal for %s: %v", shellId, err)
		return false, fmt.Errorf("failed to start terminal: %w", err)
	}

	if err := terminal.Resize(80, 24); err != nil {
		log.Printf("[Shell] Failed to set initial terminal size for %s: %v", shellId, err)
	}

	shellProcess := &ShellProcess{
		ID:  shellId,
		Pty: terminal,
	}
	activeShells[shellId] = shellProcess

	go shellProcess.readOutput(shellId)
	go shellProcess.waitForExit(shellId)

	log.Printf("[Shell] Shell started successfully: %s (PID: %d)", shellId, terminal.PID())
	return true, nil
}

func setShellEnv(env []string, key, value string) []string {
	for i, entry := range env {
		separator := strings.IndexByte(entry, '=')
		if separator <= 0 {
			continue
		}

		name := entry[:separator]
		matches := name == key
		if runtime.GOOS == "windows" {
			matches = strings.EqualFold(name, key)
		}
		if matches {
			env[i] = key + "=" + value
			return env
		}
	}
	return append(env, key+"="+value)
}

// WriteToShell writes input to a running shell.
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

	if _, err := shellProcess.Pty.Write([]byte(data)); err != nil {
		log.Printf("[Shell] Failed to write to shell %s: %v", shellId, err)
		return fmt.Errorf("failed to write to shell: %w", err)
	}
	return nil
}

// ResizeShell adjusts the shell's terminal dimensions.
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

	if cols < 1 {
		cols = 1
	}
	if rows < 1 {
		rows = 1
	}
	if err := shellProcess.Pty.Resize(uint16(cols), uint16(rows)); err != nil {
		log.Printf("[Shell] Failed to resize shell %s: %v", shellId, err)
		return fmt.Errorf("failed to resize shell: %w", err)
	}
	return nil
}

// StopShell stops one shell session.
func (a *App) StopShell(shellId string) error {
	shellMutex.Lock()
	defer shellMutex.Unlock()

	shellProcess, ok := activeShells[shellId]
	if !ok {
		return fmt.Errorf("shell %s not found", shellId)
	}

	shellProcess.stop()
	delete(activeShells, shellId)
	shellUIMu.Lock()
	delete(shellUI.Snapshots, shellId)
	shellUIMu.Unlock()
	log.Printf("[Shell] Shell stopped: %s", shellId)
	return nil
}

// RestartShell 强制结束并重建会话（对应 UI「重启终端」）。
func (a *App) RestartShell(shellId string) (bool, error) {
	shellMutex.Lock()
	if shellProcess, ok := activeShells[shellId]; ok {
		shellProcess.stop()
		delete(activeShells, shellId)
		log.Printf("[Shell] Shell stopped for restart: %s", shellId)
	}
	shellMutex.Unlock()
	return a.StartShell(shellId)
}

// GetShellScrollback 返回会话近期输出，供窗口切换后回放历史。
func (a *App) GetShellScrollback(shellId string) (string, error) {
	shellMutex.RLock()
	shellProcess, ok := activeShells[shellId]
	shellMutex.RUnlock()
	if !ok {
		return "", nil
	}
	shellProcess.scrollMu.Lock()
	defer shellProcess.scrollMu.Unlock()
	if len(shellProcess.scrollback) == 0 {
		return "", nil
	}
	return string(shellProcess.scrollback), nil
}

// GetShellUIState 返回跨窗口共享的终端 tabs / 快照。
func (a *App) GetShellUIState() ShellUIState {
	shellUIMu.Lock()
	defer shellUIMu.Unlock()
	out := ShellUIState{
		Tabs:        append([]ShellTabInfo(nil), shellUI.Tabs...),
		ActiveTabId: shellUI.ActiveTabId,
		TabSeq:      shellUI.TabSeq,
		Snapshots:   make(map[string]string, len(shellUI.Snapshots)),
	}
	for k, v := range shellUI.Snapshots {
		out.Snapshots[k] = v
	}
	return out
}

// SetShellUIState 由即将卸下的窗口写入，供另一窗口附着恢复。
func (a *App) SetShellUIState(state ShellUIState) {
	shellUIMu.Lock()
	defer shellUIMu.Unlock()
	shellUI.Tabs = append([]ShellTabInfo(nil), state.Tabs...)
	shellUI.ActiveTabId = state.ActiveTabId
	shellUI.TabSeq = state.TabSeq
	// 禁止用空 snapshots 覆盖已有内容（另一窗 boot/竞态 push 会误清空）
	if len(state.Snapshots) > 0 {
		shellUI.Snapshots = make(map[string]string, len(state.Snapshots))
		for k, v := range state.Snapshots {
			if v != "" {
				shellUI.Snapshots[k] = v
			}
		}
	} else if shellUI.Snapshots == nil {
		shellUI.Snapshots = map[string]string{}
	}
	log.Printf("[Shell] UI state saved: tabs=%d snapshots=%d active=%s",
		len(shellUI.Tabs), len(shellUI.Snapshots), shellUI.ActiveTabId)
}

// SetShellSnapshot 单独更新某一会话的 xterm 序列化快照。
func (a *App) SetShellSnapshot(shellId string, snapshot string) {
	if shellId == "" {
		return
	}
	shellUIMu.Lock()
	defer shellUIMu.Unlock()
	if shellUI.Snapshots == nil {
		shellUI.Snapshots = map[string]string{}
	}
	if snapshot == "" {
		delete(shellUI.Snapshots, shellId)
	} else {
		shellUI.Snapshots[shellId] = snapshot
	}
}

// GetShellSnapshot 读取某一会话的 xterm 序列化快照。
func (a *App) GetShellSnapshot(shellId string) string {
	shellUIMu.Lock()
	defer shellUIMu.Unlock()
	if shellUI.Snapshots == nil {
		return ""
	}
	return shellUI.Snapshots[shellId]
}

// IsShellRunning 判断会话是否仍在后端存活。
func (a *App) IsShellRunning(shellId string) bool {
	shellMutex.RLock()
	defer shellMutex.RUnlock()
	_, ok := activeShells[shellId]
	return ok
}

// StopAllShells stops all shell sessions.
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

func (sp *ShellProcess) appendScrollback(chunk []byte) {
	sp.scrollMu.Lock()
	defer sp.scrollMu.Unlock()
	sp.scrollback = append(sp.scrollback, chunk...)
	if len(sp.scrollback) > maxShellScrollback {
		sp.scrollback = append([]byte(nil), sp.scrollback[len(sp.scrollback)-maxShellScrollback:]...)
	}
}

func (sp *ShellProcess) readOutput(shellId string) {
	buffer := make([]byte, 4096)
	for {
		n, err := sp.Pty.Read(buffer)
		if n > 0 {
			chunk := append([]byte(nil), buffer[:n]...)
			sp.appendScrollback(chunk)
			app := application.Get()
			if app != nil {
				app.Event.Emit(fmt.Sprintf("shell:stdout:%s", shellId), string(chunk))
			}
		}
		if err != nil {
			sp.mu.Lock()
			intentionallyClosed := sp.isClosed
			sp.mu.Unlock()
			if !intentionallyClosed && !errors.Is(err, io.EOF) {
				log.Printf("[Shell] Error reading from shell %s: %v", shellId, err)
			}
			return
		}
	}
}

func (sp *ShellProcess) waitForExit(shellId string) {
	exitCode, err := sp.Pty.Wait()

	sp.mu.Lock()
	intentionallyClosed := sp.isClosed
	sp.isClosed = true
	sp.mu.Unlock()

	sp.closeTerminal()
	if intentionallyClosed {
		return
	}
	if err != nil {
		log.Printf("[Shell] Shell %s exited with error: %v", shellId, err)
	}

	shellMutex.Lock()
	if activeShells[shellId] == sp {
		delete(activeShells, shellId)
	}
	shellMutex.Unlock()

	app := application.Get()
	if app != nil {
		app.Event.Emit(fmt.Sprintf("shell:exit:%s", shellId), map[string]interface{}{
			"code":   exitCode,
			"signal": "",
		})
	}
}

func (sp *ShellProcess) stop() {
	sp.mu.Lock()
	if sp.isClosed {
		sp.mu.Unlock()
		return
	}
	sp.isClosed = true
	sp.mu.Unlock()
	sp.closeTerminal()
}

func (sp *ShellProcess) closeTerminal() {
	sp.close.Do(func() {
		if sp.Pty != nil {
			_ = sp.Pty.Close()
		}
	})
}
