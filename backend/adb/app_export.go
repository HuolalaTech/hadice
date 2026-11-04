package adb

import (
	"fmt"
	"path/filepath"
	"strings"
)

// GetAppPaths 返回包在设备上的全部 APK 路径（含 split）。
func GetAppPaths(connectKey string, packageName string) ([]string, error) {
	result, err := ExecuteAdb([]string{"-s", connectKey, "shell", "pm", "path", packageName})
	if err != nil {
		return nil, err
	}
	if !result.Success || strings.TrimSpace(result.Output) == "" {
		return nil, fmt.Errorf("package not found: %s", packageName)
	}

	paths := make([]string, 0)
	for _, line := range strings.Split(result.Output, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "package:") {
			p := strings.TrimPrefix(line, "package:")
			if p != "" {
				paths = append(paths, p)
			}
		}
	}
	if len(paths) == 0 {
		return nil, fmt.Errorf("package path not found: %s", packageName)
	}
	return paths, nil
}

// ExportApp 将应用 APK 拉取到本地。
// 单文件：保存到 localPath；多 split：保存到与 localPath 同名的目录内。
func ExportApp(connectKey string, packageName string, localPath string) (string, error) {
	remotePaths, err := GetAppPaths(connectKey, packageName)
	if err != nil {
		return "", err
	}

	if len(remotePaths) == 1 {
		result, pullErr := PullFileFromDevice(connectKey, remotePaths[0], localPath)
		if pullErr != nil {
			return "", pullErr
		}
		if result == nil || !result.Success {
			errMsg := "pull failed"
			if result != nil && result.Error != "" {
				errMsg = result.Error
			}
			return "", fmt.Errorf("%s", errMsg)
		}
		return localPath, nil
	}

	// ponytail: split APK 落同名目录，避免只拉 base 装不上
	dir := strings.TrimSuffix(localPath, filepath.Ext(localPath))
	if dir == "" || dir == localPath {
		dir = localPath + "_splits"
	}
	for _, remote := range remotePaths {
		name := filepath.Base(remote)
		dest := filepath.Join(dir, name)
		result, pullErr := PullFileFromDevice(connectKey, remote, dest)
		if pullErr != nil {
			return "", pullErr
		}
		if result == nil || !result.Success {
			errMsg := "pull failed: " + remote
			if result != nil && result.Error != "" {
				errMsg = result.Error
			}
			return "", fmt.Errorf("%s", errMsg)
		}
	}
	return dir, nil
}
