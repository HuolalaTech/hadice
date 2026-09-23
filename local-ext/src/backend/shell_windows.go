//go:build windows

package backend

import (
	"context"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"Hadice/backend/hdc"

	"github.com/UserExistsError/conpty"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// winShellProcess holds ConPTY state for one local shell session.
// Named differently from official ShellProcess to avoid confusion.
type winShellProcess struct {
	ID       string
	Cpty     *conpty.ConPty
	ctx      context.Context
	cancel   context.CancelFunc
	mu       sync.Mutex
	isClosed bool
}

var (
	activeWinShells = make(map[string]*winShellProcess)
	winShellMutex   sync.RWMutex
)

func resolveWindowsShellCommand() string {
	shellCommand := os.Getenv("COMSPEC")
	if shellCommand == "" {
		shellCommand = "cmd.exe"
	}
	return shellCommand
}

func buildWindowsShellEnv() []string {
	hdcBinDir := filepath.Dir(hdc.GetHdcPath())
	env := os.Environ()

	pathEnv := os.Getenv("PATH")
	if pathEnv != "" {
		pathEnv = fmt.Sprintf("%s;%s", hdcBinDir, pathEnv)
	} else {
		pathEnv = hdcBinDir
	}

	replaced := false
	for i, e := range env {
		if strings.HasPrefix(strings.ToUpper(e), "PATH=") {
			env[i] = "PATH=" + pathEnv
			replaced = true
			break
		}
	}
	if !replaced {
		env = append(env, "PATH="+pathEnv)
	}

	termSet := false
	for i, e := range env {
		if strings.HasPrefix(strings.ToUpper(e), "TERM=") {
			env[i] = "TERM=xterm-256color"
			termSet = true
			break
		}
	}
	if !termSet {
		env = append(env, "TERM=xterm-256color")
	}
	return env
}

func resolveWindowsHomeDir() string {
	homeDir, err := hdc.GetUserHomeDirectory()
	if err != nil || homeDir == "" {
		homeDir = os.Getenv("USERPROFILE")
		if homeDir == "" {
			homeDir = os.Getenv("HOME")
		}
	}
	return homeDir
}

// StartShell starts a local ConPTY shell. Same signature as the official API.
func (a *App) StartShell(shellId string) (bool, error) {
	winShellMutex.Lock()
	defer winShellMutex.Unlock()

	if existing, ok := activeWinShells[shellId]; ok {
		existing.stop()
		delete(activeWinShells, shellId)
	}

	shellCommand := resolveWindowsShellCommand()
	homeDir := resolveWindowsHomeDir()
	env := buildWindowsShellEnv()

	cpty, err := conpty.Start(
		shellCommand,
		conpty.ConPtyDimensions(80, 24),
		conpty.ConPtyWorkDir(homeDir),
		conpty.ConPtyEnv(env),
	)
	if err != nil {
		log.Printf("[Shell] Failed to start ConPTY for %s: %v", shellId, err)
		return false, fmt.Errorf("failed to start ConPTY terminal: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	shellProcess := &winShellProcess{
		ID:     shellId,
		Cpty:   cpty,
		ctx:    ctx,
		cancel: cancel,
	}
	activeWinShells[shellId] = shellProcess

	go shellProcess.readOutput(a.ctx, shellId)
	go shellProcess.waitForExit(a.ctx, shellId)

	log.Printf("[Shell] ConPTY shell started: %s (PID: %d)", shellId, cpty.Pid())
	time.Sleep(200 * time.Millisecond)
	return true, nil
}

// WriteToShell writes input to the ConPTY.
func (a *App) WriteToShell(shellId string, data string) error {
	winShellMutex.RLock()
	shellProcess, ok := activeWinShells[shellId]
	winShellMutex.RUnlock()
	if !ok {
		return fmt.Errorf("shell %s not found", shellId)
	}

	shellProcess.mu.Lock()
	defer shellProcess.mu.Unlock()
	if shellProcess.isClosed {
		return fmt.Errorf("shell %s is closed", shellId)
	}
	_, err := shellProcess.Cpty.Write([]byte(data))
	if err != nil {
		log.Printf("[Shell] Failed to write to shell %s: %v", shellId, err)
		return fmt.Errorf("failed to write to shell: %v", err)
	}
	return nil
}

// ResizeShell resizes the ConPTY.
func (a *App) ResizeShell(shellId string, cols int, rows int) error {
	winShellMutex.RLock()
	shellProcess, ok := activeWinShells[shellId]
	winShellMutex.RUnlock()
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
	if err := shellProcess.Cpty.Resize(cols, rows); err != nil {
		log.Printf("[Shell] Failed to resize shell %s: %v", shellId, err)
		return fmt.Errorf("failed to resize shell: %v", err)
	}
	return nil
}

// StopShell stops one ConPTY shell.
func (a *App) StopShell(shellId string) error {
	winShellMutex.Lock()
	defer winShellMutex.Unlock()
	shellProcess, ok := activeWinShells[shellId]
	if !ok {
		return fmt.Errorf("shell %s not found", shellId)
	}
	shellProcess.stop()
	delete(activeWinShells, shellId)
	log.Printf("[Shell] Shell stopped: %s", shellId)
	return nil
}

// StopAllShells stops all ConPTY shells.
func (a *App) StopAllShells() error {
	winShellMutex.Lock()
	defer winShellMutex.Unlock()
	for shellId, shellProcess := range activeWinShells {
		shellProcess.stop()
		log.Printf("[Shell] Shell stopped: %s", shellId)
	}
	activeWinShells = make(map[string]*winShellProcess)
	log.Printf("[Shell] All shells stopped")
	return nil
}

func (sp *winShellProcess) readOutput(ctx context.Context, shellId string) {
	buffer := make([]byte, 4096)
	for {
		select {
		case <-ctx.Done():
			return
		default:
			sp.mu.Lock()
			closed := sp.isClosed
			cpty := sp.Cpty
			sp.mu.Unlock()
			if closed || cpty == nil {
				return
			}
			n, err := cpty.Read(buffer)
			if err != nil {
				if err != io.EOF {
					log.Printf("[Shell] Error reading from shell %s: %v", shellId, err)
				}
				return
			}
			if n > 0 {
				data := string(buffer[:n])
				app := application.Get()
				if app != nil {
					app.Event.Emit(fmt.Sprintf("shell:stdout:%s", shellId), data)
				}
			}
		}
	}
}

func (sp *winShellProcess) waitForExit(ctx context.Context, shellId string) {
	exitCode := 0
	signal := ""
	if sp.Cpty != nil {
		code, err := sp.Cpty.Wait(ctx)
		if err != nil {
			log.Printf("[Shell] Shell %s wait ended: %v", shellId, err)
		}
		exitCode = int(code)
	}

	sp.mu.Lock()
	sp.isClosed = true
	sp.mu.Unlock()

	app := application.Get()
	if app != nil {
		app.Event.Emit(fmt.Sprintf("shell:exit:%s", shellId), map[string]interface{}{
			"code":   exitCode,
			"signal": signal,
		})
	}
	sp.stop()
}

func (sp *winShellProcess) stop() {
	sp.mu.Lock()
	defer sp.mu.Unlock()
	if sp.isClosed && sp.Cpty == nil {
		return
	}
	sp.isClosed = true
	if sp.cancel != nil {
		sp.cancel()
	}
	if sp.Cpty != nil {
		_ = sp.Cpty.Close()
		sp.Cpty = nil
	}
}
