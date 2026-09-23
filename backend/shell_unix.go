//go:build !windows

package backend

import (
	"os"
	"os/exec"
	"sync"

	"github.com/creack/pty"
)

type unixShellTerminal struct {
	file      *os.File
	cmd       *exec.Cmd
	closeOnce sync.Once
	closeErr  error
}

func (t *unixShellTerminal) Read(p []byte) (int, error) {
	return t.file.Read(p)
}

func (t *unixShellTerminal) Write(p []byte) (int, error) {
	return t.file.Write(p)
}

func (t *unixShellTerminal) Close() error {
	t.closeOnce.Do(func() {
		if t.cmd.Process != nil {
			_ = t.cmd.Process.Kill()
		}
		t.closeErr = t.file.Close()
	})
	return t.closeErr
}

func (t *unixShellTerminal) Resize(cols, rows uint16) error {
	return pty.Setsize(t.file, &pty.Winsize{Cols: cols, Rows: rows})
}

func (t *unixShellTerminal) PID() int {
	return t.cmd.Process.Pid
}

func (t *unixShellTerminal) Wait() (int, error) {
	err := t.cmd.Wait()
	exitCode := 0
	if t.cmd.ProcessState != nil {
		exitCode = t.cmd.ProcessState.ExitCode()
	}
	return exitCode, err
}

func startShellTerminal(config shellTerminalConfig) (shellTerminal, error) {
	cmd := exec.Command(config.Command)
	cmd.Env = config.Env
	cmd.Dir = config.Dir

	file, err := pty.Start(cmd)
	if err != nil {
		return nil, err
	}
	return &unixShellTerminal{file: file, cmd: cmd}, nil
}
