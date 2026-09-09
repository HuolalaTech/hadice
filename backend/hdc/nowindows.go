//go:build !windows

package hdc

import (
	"os/exec"
)

// HideWindowsConsoleWindow 在非Windows平台下为空函数
func HideWindowsConsoleWindow(cmd *exec.Cmd) {
	// 在非Windows平台下不做任何操作
}
