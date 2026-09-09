package hdc

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"sync"
)

var (
	hdcPath      string
	libusbPath   string
	resourcesDir string
	pathOnce     sync.Once
)

// HdcResult 表示 HDC 命令执行结果
type HdcResult struct {
	Success bool   `json:"success"`
	Output  string `json:"output"`
	Error   string `json:"error,omitempty"`
}

// SetBinDir 设置提取后的二进制文件目录（由 backend 包在提取后调用）
func SetBinDir(binDir string) {
	if binDir != "" {
		// 检查目录是否存在
		if _, err := os.Stat(binDir); err == nil {
			resourcesDir = binDir
			// 根据平台设置可执行文件名
			hdcExeName := "hdc"
			if runtime.GOOS == "windows" {
				hdcExeName = "hdc.exe"
			}
			hdcPath = filepath.Join(resourcesDir, "hdc", hdcExeName)
			libusbPath = filepath.Join(resourcesDir, "hdc")

			// 确保 hdc 有执行权限（macOS/Linux）
			if runtime.GOOS != "windows" {
				if err := os.Chmod(hdcPath, 0755); err != nil {
					// 记录警告但继续（可能文件还不存在，稍后会在 EnsureHdcExecutable 中处理）
					log.Printf("[HDC Path] 警告: 无法设置 HDC 执行权限: %v (路径: %s)", err, hdcPath)
				}
			}
		}
	}
}

// init 初始化路径
func init() {
	setupPaths()
}

// setupPaths 设置 HDC 相关路径
func setupPaths() {
	pathOnce.Do(func() {
		// 如果已经通过 SetBinDir 设置了路径，直接返回
		if resourcesDir != "" && hdcPath != "" {
			return
		}

		// 根据平台设置可执行文件名
		hdcExeName := "hdc"
		if runtime.GOOS == "windows" {
			hdcExeName = "hdc.exe"
		}

		// 尝试从应用包的 Resources/bin 目录读取
		exePath, err := os.Executable()
		if err == nil {
			exeDir := filepath.Dir(exePath)

			// 检查是否在 macOS .app 包中运行
			if runtime.GOOS == "darwin" && filepath.Base(exeDir) == "MacOS" {
				contentsDir := filepath.Dir(exeDir) // Contents
				binDir := filepath.Join(contentsDir, "Resources", "bin")
				if _, err := os.Stat(binDir); err == nil {
					resourcesDir = binDir
					hdcPath = filepath.Join(resourcesDir, "hdc", hdcExeName)
					libusbPath = filepath.Join(resourcesDir, "hdc")
					if runtime.GOOS != "windows" {
						os.Chmod(hdcPath, 0755)
					}
					return
				}
			} else {
				// 不在 .app 包中，尝试可执行文件目录下的 bin（Windows 和开发环境）
				binDir := filepath.Join(exeDir, "bin")
				if _, err := os.Stat(binDir); err == nil {
					resourcesDir = binDir
					hdcPath = filepath.Join(resourcesDir, "hdc", hdcExeName)
					libusbPath = filepath.Join(resourcesDir, "hdc")
					if runtime.GOOS != "windows" {
						os.Chmod(hdcPath, 0755)
					}
					return
				}
			}
		}

		// 回退到开发环境的路径
		cwd, _ := os.Getwd()
		platformDir := getPlatformDir()
		resourcesDir = filepath.Join(cwd, "assets", platformDir, "bin")
		hdcPath = filepath.Join(resourcesDir, "hdc", hdcExeName)
		libusbPath = filepath.Join(resourcesDir, "hdc")

		// 确保 hdc 有执行权限（macOS/Linux）
		if runtime.GOOS != "windows" {
			os.Chmod(hdcPath, 0755)
		}
	})
}

// getPlatformDir 根据当前平台返回对应的目录名
func getPlatformDir() string {
	arch := runtime.GOARCH

	// 根据平台和架构返回目录名
	if runtime.GOOS == "darwin" {
		return fmt.Sprintf("darwin/%s", arch)
	} else if runtime.GOOS == "windows" {
		return fmt.Sprintf("windows/%s", arch)
	}
	// 其他平台（如 Linux）的回退路径
	return arch
}

// GetHdcPath 获取 HDC 可执行文件路径
func GetHdcPath() string {
	return hdcPath
}

// GetLibusbPath 获取 libusb 动态库路径
func GetLibusbPath() string {
	return libusbPath
}

// GetResourcesDir 获取资源目录路径
func GetResourcesDir() string {
	return resourcesDir
}

// EnsureHdcExecutable 确保 HDC 可执行文件存在且有执行权限
func EnsureHdcExecutable() error {
	// 检查文件是否存在
	fileInfo, err := os.Stat(hdcPath)
	if os.IsNotExist(err) {
		return fmt.Errorf("HDC executable not found at: %s", hdcPath)
	}
	if err != nil {
		return fmt.Errorf("failed to stat HDC executable: %v", err)
	}

	// macOS 和 Linux 需要添加执行权限
	if runtime.GOOS != "windows" {
		// 检查当前权限
		mode := fileInfo.Mode()
		// 如果文件没有执行权限，尝试设置
		if mode&0111 == 0 {
			if err := os.Chmod(hdcPath, 0755); err != nil {
				return fmt.Errorf("failed to set executable permission on %s: %v (current mode: %s)", hdcPath, err, mode.String())
			}
			// 验证权限是否设置成功
			if fileInfo, err := os.Stat(hdcPath); err == nil {
				newMode := fileInfo.Mode()
				if newMode&0111 == 0 {
					return fmt.Errorf("executable permission not set on %s (mode: %s)", hdcPath, newMode.String())
				}
			}
		}
	}

	return nil
}

// GetDebugInfo 获取 HDC 路径调试信息
func GetDebugInfo() map[string]string {
	cwd, _ := os.Getwd()
	exePath, _ := os.Executable()

	info := make(map[string]string)
	info["hdcPath"] = hdcPath
	info["libusbPath"] = libusbPath
	info["resourcesDir"] = resourcesDir
	info["platform"] = runtime.GOOS
	info["arch"] = runtime.GOARCH
	info["workingDir"] = cwd
	info["executablePath"] = exePath
	info["platformDir"] = getPlatformDir()

	// 检查文件是否存在
	if hdcPath != "" {
		if _, err := os.Stat(hdcPath); err == nil {
			info["hdcExists"] = "true"
		} else {
			info["hdcExists"] = "false"
			info["hdcStatError"] = err.Error()
		}
	} else {
		info["hdcExists"] = "false (empty path)"
	}

	return info
}

