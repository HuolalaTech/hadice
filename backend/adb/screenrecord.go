package adb

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// ScreenRecordInfo 录屏信息
type ScreenRecordInfo struct {
	LocalPath string `json:"localPath"`
	FileName  string `json:"fileName"`
	Timestamp int64  `json:"timestamp"`
	Size      int64  `json:"size"`
}

// ScreenRecordHistoryItem 录屏历史记录项
type ScreenRecordHistoryItem struct {
	LocalPath string `json:"localPath"`
	FileName  string `json:"fileName"`
	Timestamp int64  `json:"timestamp"`
	Size      int64  `json:"size"`
}

// generateAndroidRecordFileName 生成录屏文件名
func generateAndroidRecordFileName() string {
	now := time.Now()
	return fmt.Sprintf("screenrecord-%04d%02d%02d_%02d%02d%02d.mp4",
		now.Year(), now.Month(), now.Day(), now.Hour(), now.Minute(), now.Second())
}

// StartScreenRecord 开始 Android 录屏
// screenrecord 在设备上后台运行，录制到指定文件
func StartScreenRecord(deviceSn string) (string, error) {
	fileName := generateAndroidRecordFileName()
	devicePath := fmt.Sprintf("/data/local/tmp/%s", fileName)

	// 后台启动 screenrecord（nohup + & 确保脱离 shell）
	// --bit-rate 2000000 (2Mbps) 降低码率，默认可达 20Mbps，录屏不需要那么高画质
	shellCmd := fmt.Sprintf("screenrecord --bit-rate 2000000 --time-limit 0 %s >/dev/null 2>&1 &", devicePath)
	_, err := ExecuteAdb([]string{"-s", deviceSn, "shell", shellCmd})
	if err != nil {
		return "", fmt.Errorf("启动录屏失败: %v", err)
	}

	return fileName, nil
}

// StopScreenRecord 停止 Android 录屏
// 使用 SIGINT (而非 SIGKILL) 让 screenrecord 正常写完 MP4 moov atom
func StopScreenRecord(deviceSn string) error {
	// 获取 screenrecord 进程 PID
	pidResult, err := ExecuteAdb([]string{"-s", deviceSn, "shell", "pidof", "screenrecord"})
	if err != nil || pidResult == nil || pidResult.Output == "" {
		// 没有运行中的进程，忽略
		return nil
	}
	pid := pidResult.Output
	if pid == "" {
		return nil
	}

	// 发送 SIGINT 让 screenrecord 正常收尾（写 MP4 footer）
	ExecuteAdb([]string{"-s", deviceSn, "shell", "kill", "-SIGINT", pid})

	// 等待 screenrecord 完成文件写入
	time.Sleep(1 * time.Second)
	return nil
}

// DownloadScreenRecordFile 拉取 Android 录屏文件到本地
func DownloadScreenRecordFile(deviceSn string, savePath string, fileName string) (*ScreenRecordInfo, error) {
	targetDir := savePath
	if targetDir == "" {
		homeDir, _ := os.UserHomeDir()
		targetDir = filepath.Join(homeDir, "Documents", "Hadice", "screenshot")
	}
	if err := os.MkdirAll(targetDir, 0755); err != nil {
		return nil, fmt.Errorf("创建目录失败: %v", err)
	}

	localPath := filepath.Join(targetDir, fileName)
	devicePath := fmt.Sprintf("/data/local/tmp/%s", fileName)

	// 从设备拉取文件
	_, err := PullFileFromDevice(deviceSn, devicePath, localPath)
	if err != nil {
		return nil, fmt.Errorf("传输录屏文件失败: %v", err)
	}

	// 删除设备上的临时文件
	DeleteDeviceFile(deviceSn, devicePath)

	var fileSize int64
	if stat, err := os.Stat(localPath); err == nil {
		fileSize = stat.Size()
	}

	return &ScreenRecordInfo{
		LocalPath: localPath,
		FileName:  fileName,
		Timestamp: time.Now().UnixMilli(),
		Size:      fileSize,
	}, nil
}

// GetScreenRecordHistory 获取录屏历史记录
func GetScreenRecordHistory(savePath string) ([]ScreenRecordHistoryItem, error) {
	targetDir := savePath
	if targetDir == "" {
		homeDir, _ := os.UserHomeDir()
		targetDir = filepath.Join(homeDir, "Documents", "Hadice", "screenshot")
	}

	if _, err := os.Stat(targetDir); os.IsNotExist(err) {
		return []ScreenRecordHistoryItem{}, nil
	}

	entries, err := os.ReadDir(targetDir)
	if err != nil {
		return []ScreenRecordHistoryItem{}, nil
	}

	var items []ScreenRecordHistoryItem
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		isScreenRecord := strings.HasPrefix(name, "screenrecord-") || strings.HasPrefix(name, "screenrecord_")
		if !isScreenRecord || !strings.HasSuffix(name, ".mp4") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		items = append(items, ScreenRecordHistoryItem{
			LocalPath: filepath.Join(targetDir, name),
			FileName:  name,
			Timestamp: info.ModTime().UnixMilli(),
			Size:      info.Size(),
		})
	}

	sort.Slice(items, func(i, j int) bool {
		return items[i].Timestamp > items[j].Timestamp
	})

	return items, nil
}
