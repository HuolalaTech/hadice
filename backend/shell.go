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

// ShellProcess represents one local shell session.
type ShellProcess struct {
	ID       string
	Pty      shellTerminal
	mu       sync.Mutex
	isClosed bool
	close    sync.Once
}

var (
	activeShells = make(map[string]*ShellProcess)
	shellMutex   sync.RWMutex
)

// StartShell starts a local command shell.
func (a *App) StartShell(shellId string) (bool, error) {
	shellMutex.Lock()
	defer shellMutex.Unlock()

	if existing, ok := activeShells[shellId]; ok {
		existing.stop()
		delete(activeShells, shellId)
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
	log.Printf("[Shell] Shell stopped: %s", shellId)
	return nil
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

func (sp *ShellProcess) readOutput(shellId string) {
	buffer := make([]byte, 4096)
	for {
		n, err := sp.Pty.Read(buffer)
		if n > 0 {
			app := application.Get()
			if app != nil {
				app.Event.Emit(fmt.Sprintf("shell:stdout:%s", shellId), string(buffer[:n]))
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
