package adb

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"sync"
)

var (
	adbPath      string
	aaptPath     string
	resourcesDir string
	pathOnce     sync.Once
)

// AdbResult 表示 ADB 命令执行结果
type AdbResult struct {
	Success bool   `json:"success"`
	Output  string `json:"output"`
	Error   string `json:"error,omitempty"`
}

// SetBinDir 设置提取后的二进制文件目录（由 backend 包在提取后调用）
func SetBinDir(binDir string) {
	if binDir != "" {
		if _, err := os.Stat(binDir); err == nil {
			resourcesDir = binDir
			adbExeName := "adb"
			aaptExeName := "aapt"
			if runtime.GOOS == "windows" {
				adbExeName = "adb.exe"
				aaptExeName = "aapt.exe"
			}
			adbPath = filepath.Join(resourcesDir, "adb", adbExeName)
			aaptPath = filepath.Join(resourcesDir, "aapt", aaptExeName)

			if runtime.GOOS != "windows" {
				if err := os.Chmod(adbPath, 0755); err != nil {
					log.Printf("[ADB Path] 警告: 无法设置 ADB 执行权限: %v (路径: %s)", err, adbPath)
				}
				if err := os.Chmod(aaptPath, 0755); err != nil {
					log.Printf("[ADB Path] 警告: 无法设置 AAPT 执行权限: %v (路径: %s)", err, aaptPath)
				}
			}
		}
	}
}

// init 初始化路径
func init() {
	setupPaths()
}

// setupPaths 设置 ADB 相关路径
func setupPaths() {
	pathOnce.Do(func() {
		if resourcesDir != "" && adbPath != "" {
			return
		}

		adbExeName := "adb"
		aaptExeName := "aapt"
		if runtime.GOOS == "windows" {
			adbExeName = "adb.exe"
			aaptExeName = "aapt.exe"
		}

		exePath, err := os.Executable()
		if err == nil {
			exeDir := filepath.Dir(exePath)

			if runtime.GOOS == "darwin" && filepath.Base(exeDir) == "MacOS" {
				contentsDir := filepath.Dir(exeDir)
				binDir := filepath.Join(contentsDir, "Resources", "bin")
				if _, err := os.Stat(binDir); err == nil {
					resourcesDir = binDir
					adbPath = filepath.Join(resourcesDir, "adb", adbExeName)
					aaptPath = filepath.Join(resourcesDir, "aapt", aaptExeName)
					if runtime.GOOS != "windows" {
						os.Chmod(adbPath, 0755)
						os.Chmod(aaptPath, 0755)
					}
					return
				}
			} else {
				binDir := filepath.Join(exeDir, "bin")
				if _, err := os.Stat(binDir); err == nil {
					resourcesDir = binDir
					adbPath = filepath.Join(resourcesDir, "adb", adbExeName)
					aaptPath = filepath.Join(resourcesDir, "aapt", aaptExeName)
					if runtime.GOOS != "windows" {
						os.Chmod(adbPath, 0755)
						os.Chmod(aaptPath, 0755)
					}
					return
				}
			}
		}

		cwd, _ := os.Getwd()
		platformDir := getPlatformDir()
		resourcesDir = filepath.Join(cwd, "assets", platformDir, "bin")
		adbPath = filepath.Join(resourcesDir, "adb", adbExeName)
		aaptPath = filepath.Join(resourcesDir, "aapt", aaptExeName)

		if runtime.GOOS != "windows" {
			os.Chmod(adbPath, 0755)
			os.Chmod(aaptPath, 0755)
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

// GetAdbPath 获取 ADB 可执行文件路径
func GetAdbPath() string {
	return adbPath
}

// GetResourcesDir 获取资源目录路径
func GetResourcesDir() string {
	return resourcesDir
}

// GetAaptPath 获取 AAPT 可执行文件路径
func GetAaptPath() string {
	return aaptPath
}

// EnsureAaptExecutable 确保 AAPT 可执行文件存在且有执行权限
func EnsureAaptExecutable() error {
	fileInfo, err := os.Stat(aaptPath)
	if os.IsNotExist(err) {
		return fmt.Errorf("AAPT executable not found at: %s", aaptPath)
	}
	if err != nil {
		return fmt.Errorf("failed to stat AAPT executable: %v", err)
	}

	if runtime.GOOS != "windows" {
		mode := fileInfo.Mode()
		if mode&0111 == 0 {
			if err := os.Chmod(aaptPath, 0755); err != nil {
				return fmt.Errorf("failed to set executable permission on %s: %v", aaptPath, err)
			}
		}
	}

	return nil
}

// EnsureAdbExecutable 确保 ADB 可执行文件存在且有执行权限
func EnsureAdbExecutable() error {
	// 检查文件是否存在
	fileInfo, err := os.Stat(adbPath)
	if os.IsNotExist(err) {
		return fmt.Errorf("ADB executable not found at: %s", adbPath)
	}
	if err != nil {
		return fmt.Errorf("failed to stat ADB executable: %v", err)
	}

	// macOS 和 Linux 需要添加执行权限
	if runtime.GOOS != "windows" {
		// 检查当前权限
		mode := fileInfo.Mode()
		// 如果文件没有执行权限，尝试设置
		if mode&0111 == 0 {
			if err := os.Chmod(adbPath, 0755); err != nil {
				return fmt.Errorf("failed to set executable permission on %s: %v (current mode: %s)", adbPath, err, mode.String())
			}
			// 验证权限是否设置成功
			if fileInfo, err := os.Stat(adbPath); err == nil {
				newMode := fileInfo.Mode()
				if newMode&0111 == 0 {
					return fmt.Errorf("executable permission not set on %s (mode: %s)", adbPath, newMode.String())
				}
			}
		}
	}

	return nil
}

// GetDebugInfo 获取 ADB 路径调试信息
func GetDebugInfo() map[string]string {
	cwd, _ := os.Getwd()
	exePath, _ := os.Executable()

	info := make(map[string]string)
	info["adbPath"] = adbPath
	info["resourcesDir"] = resourcesDir
	info["platform"] = runtime.GOOS
	info["arch"] = runtime.GOARCH
	info["workingDir"] = cwd
	info["executablePath"] = exePath
	info["platformDir"] = getPlatformDir()

	// 检查文件是否存在
	if adbPath != "" {
		if _, err := os.Stat(adbPath); err == nil {
			info["adbExists"] = "true"
		} else {
			info["adbExists"] = "false"
			info["adbStatError"] = err.Error()
		}
	} else {
		info["adbExists"] = "false (empty path)"
	}

	return info
}
