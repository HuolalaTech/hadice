package backend

import (
	"Hadice/backend/adb"
	"Hadice/backend/hdc"
	"os"
	"os/exec"
	"runtime"
)

// =============== 文件传输相关方法 ===============

// ListDeviceDirectory 列出设备目录内容
// platform: "harmonyos" 或 "android"
func (a *App) ListDeviceDirectory(connectKey string, path string, platform string) (map[string]interface{}, error) {
	if platform == "android" {
		return a.listAndroidDeviceDirectory(connectKey, path)
	}
	return a.listHarmonyosDeviceDirectory(connectKey, path)
}

// listHarmonyosDeviceDirectory 列出鸿蒙设备目录
func (a *App) listHarmonyosDeviceDirectory(connectKey string, path string) (map[string]interface{}, error) {
	result, err := hdc.ListDeviceDirectory(connectKey, path)
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		}, err
	}

	if !result.Success {
		return map[string]interface{}{
			"success": false,
			"error":   result.Error,
		}, nil
	}

	items := make([]map[string]interface{}, len(result.Items))
	for i, item := range result.Items {
		items[i] = map[string]interface{}{
			"name":         item.Name,
			"path":         item.Path,
			"isDirectory":  item.IsDirectory,
			"size":         item.Size,
			"modifiedTime": item.ModifiedTime,
			"permissions":  item.Permissions,
		}
	}

	return map[string]interface{}{
		"success": true,
		"items":   items,
	}, nil
}

// listAndroidDeviceDirectory 列出安卓设备目录
func (a *App) listAndroidDeviceDirectory(connectKey string, path string) (map[string]interface{}, error) {
	result, err := adb.ListDeviceDirectory(connectKey, path)
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		}, err
	}

	if !result.Success {
		return map[string]interface{}{
			"success": false,
			"error":   result.Error,
		}, nil
	}

	items := make([]map[string]interface{}, len(result.Items))
	for i, item := range result.Items {
		items[i] = map[string]interface{}{
			"name":         item.Name,
			"path":         item.Path,
			"isDirectory":  item.IsDirectory,
			"size":         item.Size,
			"modifiedTime": item.ModifiedTime,
			"permissions":  item.Permissions,
		}
	}

	return map[string]interface{}{
		"success": true,
		"items":   items,
	}, nil
}

// ListLocalDirectory 列出本地目录内容
func (a *App) ListLocalDirectory(path string) (map[string]interface{}, error) {
	result, err := hdc.ListLocalDirectory(path)
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		}, err
	}

	if !result.Success {
		return map[string]interface{}{
			"success": false,
			"error":   result.Error,
		}, nil
	}

	items := make([]map[string]interface{}, len(result.Items))
	for i, item := range result.Items {
		items[i] = map[string]interface{}{
			"name":         item.Name,
			"path":         item.Path,
			"isDirectory":  item.IsDirectory,
			"size":         item.Size,
			"modifiedTime": item.ModifiedTime,
			"permissions":  item.Permissions,
		}
	}

	return map[string]interface{}{
		"success": true,
		"items":   items,
	}, nil
}

// PushFileToDevice 推送文件到设备
// platform: "harmonyos" 或 "android"
func (a *App) PushFileToDevice(connectKey string, localPath string, remotePath string, platform string) (*hdc.HdcResult, error) {
	if platform == "android" {
		result, err := adb.PushFileToDevice(connectKey, localPath, remotePath)
		if err != nil {
			return &hdc.HdcResult{
				Success: false,
				Error:   err.Error(),
			}, err
		}
		return &hdc.HdcResult{
			Success: result.Success,
			Output:  result.Output,
			Error:   result.Error,
		}, nil
	}
	return hdc.PushFileToDevice(connectKey, localPath, remotePath)
}

// PullFileFromDevice 从设备拉取文件
// platform: "harmonyos" 或 "android"
func (a *App) PullFileFromDevice(connectKey string, remotePath string, localPath string, platform string) (*hdc.HdcResult, error) {
	if platform == "android" {
		result, err := adb.PullFileFromDevice(connectKey, remotePath, localPath)
		if err != nil {
			return &hdc.HdcResult{
				Success: false,
				Error:   err.Error(),
			}, err
		}
		return &hdc.HdcResult{
			Success: result.Success,
			Output:  result.Output,
			Error:   result.Error,
		}, nil
	}
	return hdc.PullFileFromDevice(connectKey, remotePath, localPath)
}

// GetUserHomeDirectory 获取用户主目录
func (a *App) GetUserHomeDirectory() (string, error) {
	return hdc.GetUserHomeDirectory()
}

// GetUserDownloadsDirectory 获取用户下载目录
func (a *App) GetUserDownloadsDirectory() (string, error) {
	return hdc.GetUserDownloadsDirectory()
}

// GetUserDocumentsDirectory 获取用户文档目录
func (a *App) GetUserDocumentsDirectory() (string, error) {
	return hdc.GetUserDocumentsDirectory()
}

// OpenFileInSystem 在系统文件管理器中打开文件或文件夹
func (a *App) OpenFileInSystem(filePath string) (*hdc.HdcResult, error) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		info, err := os.Stat(filePath)
		if err == nil && !info.IsDir() {
			cmd = exec.Command("open", "-R", filePath)
		} else {
			cmd = exec.Command("open", filePath)
		}
	case "windows":
		info, err := os.Stat(filePath)
		if err == nil && !info.IsDir() {
			cmd = exec.Command("explorer", "/select,", filePath)
		} else {
			cmd = exec.Command("explorer", filePath)
		}
		hdc.HideWindowsConsoleWindow(cmd)
	default:
		cmd = exec.Command("xdg-open", filePath)
	}

	err := cmd.Run()
	if err != nil {
		return &hdc.HdcResult{
			Success: false,
			Error:   err.Error(),
		}, err
	}
	return &hdc.HdcResult{
		Success: true,
		Output:  "文件已打开",
	}, nil
}

// DeleteLocalFile 删除本地文件
func (a *App) DeleteLocalFile(filePath string) (*hdc.HdcResult, error) {
	info, err := os.Stat(filePath)
	if err != nil {
		return &hdc.HdcResult{
			Success: false,
			Error:   "文件不存在",
		}, err
	}

	if info.IsDir() {
		return &hdc.HdcResult{
			Success: false,
			Error:   "不能删除目录",
		}, nil
	}

	err = os.Remove(filePath)
	if err != nil {
		return &hdc.HdcResult{
			Success: false,
			Error:   err.Error(),
		}, err
	}

	return &hdc.HdcResult{
		Success: true,
		Output:  "文件已删除",
	}, nil
}

// DeleteDeviceFile 删除设备上的文件
// platform: "harmonyos" 或 "android"
func (a *App) DeleteDeviceFile(connectKey string, filePath string, platform string) (*hdc.HdcResult, error) {
	if platform == "android" {
		result := adb.DeleteDeviceFile(connectKey, filePath)
		return &hdc.HdcResult{
			Success: result.Success,
			Output:  result.Output,
			Error:   result.Error,
		}, nil
	}
	result := hdc.DeleteDeviceFile(connectKey, filePath)
	return result, nil
}
