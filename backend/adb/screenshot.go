package adb

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"time"
)

// TakeScreenshot 截取 Android 设备屏幕截图
func TakeScreenshot(deviceSn string, savePath string, format string) (*ScreenshotInfo, error) {
	// 确定保存路径
	targetDir := savePath
	if targetDir == "" {
		homeDir, _ := os.UserHomeDir()
		targetDir = filepath.Join(homeDir, "Documents", "Hadice", "screenshot")
	}
	if err := os.MkdirAll(targetDir, 0755); err != nil {
		return nil, fmt.Errorf("创建目录失败: %v", err)
	}

	// Android screencap 原生只支持 PNG，忽略用户选择的 format
	// 生成文件名和路径
	now := time.Now()
	fileName := fmt.Sprintf("screen_%04d%02d%02d_%02d%02d%02d.png",
		now.Year(), now.Month(), now.Day(), now.Hour(), now.Minute(), now.Second())
	localPath := filepath.Join(targetDir, fileName)
	deviceTmpPath := fmt.Sprintf("/data/local/tmp/%s", fileName)

	// 在设备上截图: screencap -p <path>
	_, err := ExecuteAdb([]string{"-s", deviceSn, "shell", "screencap", "-p", deviceTmpPath})
	if err != nil {
		return nil, fmt.Errorf("截图失败: %v", err)
	}

	// 获取屏幕尺寸
	width, height := getAndroidScreenSize(deviceSn)

	// 拉取截图到本地
	_, err = PullFileFromDevice(deviceSn, deviceTmpPath, localPath)
	if err != nil {
		return nil, fmt.Errorf("传输截图失败: %v", err)
	}

	// 删除设备上的临时文件
	DeleteDeviceFile(deviceSn, deviceTmpPath)

	// 获取本地文件大小
	var fileSize int64
	if stat, err := os.Stat(localPath); err == nil {
		fileSize = stat.Size()
	}

	return &ScreenshotInfo{
		LocalPath: localPath,
		FileName:  fileName,
		Timestamp: now.UnixMilli(),
		Width:     width,
		Height:    height,
		Size:      fileSize,
	}, nil
}

// ScreenshotInfo Android 截图信息
type ScreenshotInfo struct {
	LocalPath string `json:"localPath"`
	FileName  string `json:"fileName"`
	Timestamp int64  `json:"timestamp"`
	Width     int    `json:"width"`
	Height    int    `json:"height"`
	Size      int64  `json:"size"`
}

// getAndroidScreenSize 通过 adb shell wm size 获取屏幕尺寸
func getAndroidScreenSize(deviceSn string) (int, int) {
	result, err := ExecuteAdb([]string{"-s", deviceSn, "shell", "wm", "size"})
	if err != nil || result == nil || !result.Success {
		return 0, 0
	}
	re := regexp.MustCompile(`(\d+)x(\d+)`)
	matches := re.FindStringSubmatch(result.Output)
	if len(matches) >= 3 {
		var w, h int
		fmt.Sscanf(matches[1], "%d", &w)
		fmt.Sscanf(matches[2], "%d", &h)
		return w, h
	}
	return 0, 0
}
