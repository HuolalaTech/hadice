//go:build windows

package hdc

import (
	"os/exec"
	"syscall"
)

// HideWindowsConsoleWindow 设置Windows进程窗口隐藏
func HideWindowsConsoleWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: 0x08000000, // CREATE_NO_WINDOW
	}
}
