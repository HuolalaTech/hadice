package scrcpy

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"sync"
)

var (
	scrcpyPath       string
	scrcpyServerPath string
	resourcesDir     string
	pathOnce         sync.Once
)

type ScrcpyResult struct {
	Success bool   `json:"success"`
	Output  string `json:"output"`
	Error   string `json:"error,omitempty"`
}

func SetBinDir(binDir string) {
	if binDir != "" {
		if _, err := os.Stat(binDir); err == nil {
			resourcesDir = binDir
			scrcpyExeName := "scrcpy"
			if runtime.GOOS == "windows" {
				scrcpyExeName = "scrcpy.exe"
			}
			scrcpyPath = filepath.Join(resourcesDir, "scrcpy", scrcpyExeName)
			scrcpyServerPath = filepath.Join(resourcesDir, "scrcpy", "scrcpy-server")

			if runtime.GOOS != "windows" {
				if err := os.Chmod(scrcpyPath, 0755); err != nil {
					log.Printf("[Scrcpy Path] 警告: 无法设置 scrcpy 执行权限: %v (路径: %s)", err, scrcpyPath)
				}
			}
		}
	}
}

func init() {
	setupPaths()
}

func setupPaths() {
	pathOnce.Do(func() {
		if resourcesDir != "" && scrcpyPath != "" {
			return
		}

		scrcpyExeName := "scrcpy"
		if runtime.GOOS == "windows" {
			scrcpyExeName = "scrcpy.exe"
		}

		exePath, err := os.Executable()
		if err == nil {
			exeDir := filepath.Dir(exePath)

			if runtime.GOOS == "darwin" && filepath.Base(exeDir) == "MacOS" {
				contentsDir := filepath.Dir(exeDir)
				binDir := filepath.Join(contentsDir, "Resources", "bin")
				if _, err := os.Stat(binDir); err == nil {
					resourcesDir = binDir
					scrcpyPath = filepath.Join(resourcesDir, "scrcpy", scrcpyExeName)
					scrcpyServerPath = filepath.Join(resourcesDir, "scrcpy", "scrcpy-server")
					if runtime.GOOS != "windows" {
						os.Chmod(scrcpyPath, 0755)
					}
					return
				}
			} else {
				binDir := filepath.Join(exeDir, "bin")
				if _, err := os.Stat(binDir); err == nil {
					resourcesDir = binDir
					scrcpyPath = filepath.Join(resourcesDir, "scrcpy", scrcpyExeName)
					scrcpyServerPath = filepath.Join(resourcesDir, "scrcpy", "scrcpy-server")
					if runtime.GOOS != "windows" {
						os.Chmod(scrcpyPath, 0755)
					}
					return
				}
			}
		}

		cwd, _ := os.Getwd()
		platformDir := getPlatformDir()
		resourcesDir = filepath.Join(cwd, "assets", platformDir, "bin")
		scrcpyPath = filepath.Join(resourcesDir, "scrcpy", scrcpyExeName)
		scrcpyServerPath = filepath.Join(resourcesDir, "scrcpy", "scrcpy-server")

		if runtime.GOOS != "windows" {
			os.Chmod(scrcpyPath, 0755)
		}
	})
}

func getPlatformDir() string {
	if runtime.GOOS == "darwin" {
		return fmt.Sprintf("darwin/%s", runtime.GOARCH)
	} else if runtime.GOOS == "windows" {
		return fmt.Sprintf("windows/%s", runtime.GOARCH)
	}
	return runtime.GOARCH
}

func GetScrcpyPath() string {
	return scrcpyPath
}

func GetScrcpyServerPath() string {
	return scrcpyServerPath
}

func GetResourcesDir() string {
	return resourcesDir
}

func EnsureScrcpyExecutable() error {
	fileInfo, err := os.Stat(scrcpyPath)
	if os.IsNotExist(err) {
		return fmt.Errorf("scrcpy executable not found at: %s", scrcpyPath)
	}
	if err != nil {
		return fmt.Errorf("failed to stat scrcpy executable: %v", err)
	}

	if runtime.GOOS != "windows" {
		mode := fileInfo.Mode()
		if mode&0111 == 0 {
			if err := os.Chmod(scrcpyPath, 0755); err != nil {
				return fmt.Errorf("failed to set executable permission on %s: %v", scrcpyPath, err)
			}
		}
	}

	return nil
}

func EnsureScrcpyServerExists() error {
	if _, err := os.Stat(scrcpyServerPath); os.IsNotExist(err) {
		return fmt.Errorf("scrcpy-server not found at: %s", scrcpyServerPath)
	}
	return nil
}

func GetDebugInfo() map[string]string {
	cwd, _ := os.Getwd()
	exePath, _ := os.Executable()

	info := make(map[string]string)
	info["scrcpyPath"] = scrcpyPath
	info["scrcpyServerPath"] = scrcpyServerPath
	info["resourcesDir"] = resourcesDir
	info["platform"] = runtime.GOOS
	info["arch"] = runtime.GOARCH
	info["workingDir"] = cwd
	info["executablePath"] = exePath
	info["platformDir"] = getPlatformDir()

	if scrcpyPath != "" {
		if _, err := os.Stat(scrcpyPath); err == nil {
			info["scrcpyExists"] = "true"
		} else {
			info["scrcpyExists"] = "false"
			info["scrcpyStatError"] = err.Error()
		}
	} else {
		info["scrcpyExists"] = "false (empty path)"
	}

	return info
}
