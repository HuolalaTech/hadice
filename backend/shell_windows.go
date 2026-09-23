//go:build windows

package backend

import (
	"context"
	"fmt"
	"strings"

	"github.com/UserExistsError/conpty"
)

type windowsShellTerminal struct {
	cpty *conpty.ConPty
}

func (t *windowsShellTerminal) Read(p []byte) (int, error) {
	return t.cpty.Read(p)
}

func (t *windowsShellTerminal) Write(p []byte) (int, error) {
	return t.cpty.Write(p)
}

func (t *windowsShellTerminal) Close() error {
	return t.cpty.Close()
}

func (t *windowsShellTerminal) Resize(cols, rows uint16) error {
	return t.cpty.Resize(int(cols), int(rows))
}

func (t *windowsShellTerminal) PID() int {
	return t.cpty.Pid()
}

func (t *windowsShellTerminal) Wait() (int, error) {
	code, err := t.cpty.Wait(context.Background())
	return int(code), err
}

func startShellTerminal(config shellTerminalConfig) (shellTerminal, error) {
	commandLine := config.Command
	if !strings.HasPrefix(commandLine, `"`) {
		commandLine = `"` + strings.ReplaceAll(commandLine, `"`, `\"`) + `"`
	}

	cpty, err := conpty.Start(
		commandLine,
		conpty.ConPtyDimensions(80, 24),
		conpty.ConPtyWorkDir(config.Dir),
		conpty.ConPtyEnv(config.Env),
	)
	if err != nil {
		return nil, fmt.Errorf("create ConPTY (requires Windows 10 version 1809 or Windows Server 2019 or newer): %w", err)
	}
	return &windowsShellTerminal{cpty: cpty}, nil
}
