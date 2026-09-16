//go:build windows

package backend

import (
	"os"
	"os/exec"
)

// windowsShellTerminal 使用标准输入输出管道提供 cmd.exe 交互能力。
// Windows 的 creack/pty 没有实现，因此不能调用 pty.Start。
type windowsShellTerminal struct {
	reader *os.File
	writer *os.File
}

func (t *windowsShellTerminal) Read(p []byte) (int, error) {
	return t.reader.Read(p)
}

func (t *windowsShellTerminal) Write(p []byte) (int, error) {
	return t.writer.Write(p)
}

func (t *windowsShellTerminal) Close() error {
	readerErr := t.reader.Close()
	writerErr := t.writer.Close()
	if readerErr != nil {
		return readerErr
	}
	return writerErr
}

// 管道没有伪终端窗口，调整大小只能作为兼容操作忽略。
func (t *windowsShellTerminal) Resize(cols, rows uint16) error {
	return nil
}

func startShellTerminal(cmd *exec.Cmd) (shellTerminal, error) {
	inputReader, inputWriter, err := os.Pipe()
	if err != nil {
		return nil, err
	}

	outputReader, outputWriter, err := os.Pipe()
	if err != nil {
		_ = inputReader.Close()
		_ = inputWriter.Close()
		return nil, err
	}

	cmd.Stdin = inputReader
	cmd.Stdout = outputWriter
	cmd.Stderr = outputWriter

	if err := cmd.Start(); err != nil {
		_ = inputReader.Close()
		_ = inputWriter.Close()
		_ = outputReader.Close()
		_ = outputWriter.Close()
		return nil, err
	}

	// 子进程已经继承这些句柄，父进程只保留终端两端。
	_ = inputReader.Close()
	_ = outputWriter.Close()

	return &windowsShellTerminal{
		reader: outputReader,
		writer: inputWriter,
	}, nil
}
