//go:build !windows

package backend

import (
	"os"
	"os/exec"

	"github.com/creack/pty"
)

type unixShellTerminal struct {
	*os.File
}

func (t *unixShellTerminal) Resize(cols, rows uint16) error {
	return pty.Setsize(t.File, &pty.Winsize{Cols: cols, Rows: rows})
}

func startShellTerminal(cmd *exec.Cmd) (shellTerminal, error) {
	file, err := pty.Start(cmd)
	if err != nil {
		return nil, err
	}
	return &unixShellTerminal{File: file}, nil
}
