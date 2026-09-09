package hdc

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

// ScreenRecordInfo 录屏信息
type ScreenRecordInfo struct {
	LocalPath string `json:"localPath"` // 本地文件路径
	FileName  string `json:"fileName"`  // 文件名
	Timestamp int64  `json:"timestamp"` // 录屏时间戳
	Size      int64  `json:"size"`      // 文件大小（字节）
}

// ScreenRecordHistoryItem 录屏历史记录项
type ScreenRecordHistoryItem struct {
	LocalPath string `json:"localPath"` // 本地文件路径
	FileName  string `json:"fileName"`  // 文件名
	Timestamp int64  `json:"timestamp"` // 录屏时间戳
	Size      int64  `json:"size"`      // 文件大小（字节）
}

// generateScreenRecordFileName 生成录屏文件名
func generateScreenRecordFileName() string {
	now := time.Now()
	formatStr := "screenrecord-%04d%02d%02d_%02d%02d%02d.mp4"
	return fmt.Sprintf(formatStr, now.Year(), now.Month(), now.Day(), now.Hour(), now.Minute(), now.Second())
}

// StartScreenRecord 开始录屏
// connectKey: 设备连接键
// 返回录屏文件名（只指定文件名，不带路径）
func StartScreenRecord(connectKey string) (string, error) {
	// 生成文件名
	fileName := generateScreenRecordFileName()
	log.Printf("[ScreenRecord] 开始录屏，文件名: %s", fileName)

	// 启动录屏命令（只指定文件名，不带路径）
	// hdc shell aa start -b com.huawei.hmos.screenrecorder -a com.huawei.hmos.screenrecorder.ServiceExtAbility --ps "CustomizedFileName" "test.mp4"
	args := []string{
		"-t", connectKey,
		"shell", "aa", "start",
		"-b", "com.huawei.hmos.screenrecorder",
		"-a", "com.huawei.hmos.screenrecorder.ServiceExtAbility",
		"--ps", "CustomizedFileName", fileName,
	}

	log.Printf("[ScreenRecord] 执行启动录屏命令: hdc %s", strings.Join(args, " "))
	result, err := ExecuteHdc(args)
	if err != nil || result == nil || !result.Success {
		log.Printf("[ScreenRecord] 启动录屏失败: err=%v, result=%v", err, result)
		return "", fmt.Errorf("启动录屏失败: %v", err)
	}

	log.Printf("[ScreenRecord] 启动录屏成功，输出: %s", result.Output)
	return fileName, nil
}

// StopScreenRecord 停止录屏
func StopScreenRecord(connectKey string) error {
	log.Printf("[ScreenRecord] 停止录屏")
	// 停止录屏命令
	// hdc shell aa start -b com.huawei.hmos.screenrecorder -a com.huawei.hmos.screenrecorder.ServiceExtAbility
	args := []string{
		"-t", connectKey,
		"shell", "aa", "start",
		"-b", "com.huawei.hmos.screenrecorder",
		"-a", "com.huawei.hmos.screenrecorder.ServiceExtAbility",
	}

	log.Printf("[ScreenRecord] 执行停止录屏命令: hdc %s", strings.Join(args, " "))
	result, err := ExecuteHdc(args)
	if err != nil || result == nil || !result.Success {
		log.Printf("[ScreenRecord] 停止录屏失败: err=%v, result=%v", err, result)
		return fmt.Errorf("停止录屏失败: %v", err)
	}

	log.Printf("[ScreenRecord] 停止录屏成功，输出: %s", result.Output)
	return nil
}

// QueryScreenRecordFile 不断查询录屏文件位置，直到找到文件
// fileName: 录屏文件名
// maxWaitTime: 最大等待时间（秒）
// checkInterval: 检查间隔（秒）
// 返回文件路径和 uri（如果有）
func QueryScreenRecordFile(connectKey string, fileName string, maxWaitTime int, checkInterval int) (string, string, error) {
	log.Printf("[ScreenRecord] 开始查询录屏文件: fileName=%s, maxWaitTime=%d秒, checkInterval=%d秒", fileName, maxWaitTime, checkInterval)
	startTime := time.Now()
	maxDuration := time.Duration(maxWaitTime) * time.Second
	interval := time.Duration(checkInterval) * time.Second
	queryCount := 0

	for {
		elapsed := time.Since(startTime)
		if elapsed > maxDuration {
			log.Printf("[ScreenRecord] 查询录屏文件超时，已查询 %d 次，耗时 %.2f 秒", queryCount, elapsed.Seconds())
			return "", "", fmt.Errorf("查询录屏文件超时")
		}

		queryCount++
		log.Printf("[ScreenRecord] 第 %d 次查询文件 (已等待 %.2f 秒)", queryCount, elapsed.Seconds())

		// 查询录屏文件位置
		// hdc shell mediatool query test.mp4 -u
		args := []string{
			"-t", connectKey,
			"shell", "mediatool", "query", fileName, "-u",
		}

		log.Printf("[ScreenRecord] 执行查询命令: hdc %s", strings.Join(args, " "))
		result, err := ExecuteHdc(args)
		if err != nil || result == nil || !result.Success {
			// 查询失败，继续等待
			log.Printf("[ScreenRecord] 查询失败: err=%v, result=%v, 继续等待...", err, result)
			time.Sleep(interval)
			continue
		}

		output := result.Output
		log.Printf("[ScreenRecord] 查询结果输出: %s", output)

		// 解析输出格式：
		// find 1 result
		// uri
		// "file://media/Photo/765/VID_1765122133_074/screenrecord-20251207_234032.mp4"
		lines := strings.Split(output, "\n")
		log.Printf("[ScreenRecord] 解析输出行数: %d", len(lines))

		// 查找包含 uri 的行（第三行，索引为 2）
		if len(lines) >= 3 {
			uriLine := strings.TrimSpace(lines[2])
			log.Printf("[ScreenRecord] 解析第三行: %s", uriLine)

			// 移除引号（如果有）
			uri := strings.Trim(uriLine, `"`)
			uri = strings.TrimSpace(uri)

			if uri != "" && strings.HasPrefix(uri, "file://") {
				log.Printf("[ScreenRecord] 找到 uri: %s", uri)
				return uri, "", nil
			}
		}

		// 如果没有找到 uri，尝试正则匹配
		uriPattern := regexp.MustCompile(`"file://[^"]+"`)
		uriMatch := uriPattern.FindStringSubmatch(output)
		if len(uriMatch) > 0 {
			uri := strings.Trim(uriMatch[0], `"`)
			log.Printf("[ScreenRecord] 通过正则找到 uri: %s", uri)
			return uri, "", nil
		}

		// 如果都没有找到，尝试查找文件路径（不包含 uri 的情况）
		if len(lines) >= 2 {
			filePath := strings.TrimSpace(lines[1])
			log.Printf("[ScreenRecord] 解析文件路径: %s", filePath)
			if filePath != "" && !strings.EqualFold(filePath, "uri") {
				log.Printf("[ScreenRecord] 找到文件路径: %s", filePath)
				return "", filePath, nil
			}
		}

		// 如果没找到文件，继续等待
		log.Printf("[ScreenRecord] 未找到文件，等待 %d 秒后继续查询...", checkInterval)
		time.Sleep(interval)
	}
}

// CopyScreenRecordFileToTmp 将录屏文件复制到 /data/local/tmp/screenrecord/ 目录
// connectKey: 设备连接键
// uri: 文件的 uri（如果有）
// originalPath: 原始文件路径（如果没有 uri）
// fileName: 文件名
// 返回复制后的文件路径
func CopyScreenRecordFileToTmp(connectKey string, uri string, originalPath string, fileName string) (string, error) {
	log.Printf("[ScreenRecord] 开始复制文件到临时目录: uri=%s, originalPath=%s, fileName=%s", uri, originalPath, fileName)

	// 确保临时目录存在
	deviceRecordDir := "/data/local/tmp/screenrecord"
	log.Printf("[ScreenRecord] 创建临时目录: %s", deviceRecordDir)
	mkdirArgs := []string{"-t", connectKey, "shell", "mkdir", "-p", deviceRecordDir}
	mkdirResult, err := ExecuteHdc(mkdirArgs)
	if err != nil {
		log.Printf("[ScreenRecord] 创建目录失败: err=%v", err)
		return "", fmt.Errorf("创建录屏目录失败: %v", err)
	}
	log.Printf("[ScreenRecord] 创建目录结果: %s", mkdirResult.Output)

	targetPath := fmt.Sprintf("%s/%s", deviceRecordDir, fileName)
	log.Printf("[ScreenRecord] 目标路径: %s", targetPath)

	if uri != "" {
		// 如果有 uri，使用 mediatool recv 复制
		// hdc shell mediatool recv "file://media/Photo/765/VID_1765122133_074/screenrecord-20251207_234032.mp4" /data/local/tmp/screenrecord/screenrecord-20251207_234032.mp4
		log.Printf("[ScreenRecord] 使用 mediatool recv 复制文件，uri: %s", uri)

		// 确保 uri 有引号包裹（如果还没有）
		quotedUri := uri
		if !strings.HasPrefix(uri, `"`) {
			quotedUri = fmt.Sprintf(`"%s"`, uri)
		}

		copyArgs := []string{
			"-t", connectKey,
			"shell", "mediatool", "recv", quotedUri, targetPath,
		}

		log.Printf("[ScreenRecord] 执行复制命令: hdc %s", strings.Join(copyArgs, " "))
		copyResult, err := ExecuteHdc(copyArgs)
		if err != nil || copyResult == nil || !copyResult.Success {
			log.Printf("[ScreenRecord] 复制文件失败: err=%v, result=%v, output=%s", err, copyResult, func() string {
				if copyResult != nil {
					return copyResult.Output
				}
				return ""
			}())
			return "", fmt.Errorf("复制录屏文件失败: %v", err)
		}

		log.Printf("[ScreenRecord] 复制命令输出: %s", copyResult.Output)

		// 验证文件是否已复制到目标路径
		// 使用 ls 命令检查文件是否存在
		checkArgs := []string{
			"-t", connectKey,
			"shell", "ls", "-l", targetPath,
		}
		checkResult, checkErr := ExecuteHdc(checkArgs)
		if checkErr == nil && checkResult != nil && checkResult.Success {
			log.Printf("[ScreenRecord] 文件已复制到: %s, 文件信息: %s", targetPath, checkResult.Output)
		} else {
			log.Printf("[ScreenRecord] 警告：无法验证文件是否存在: %v", checkErr)
		}

		log.Printf("[ScreenRecord] 复制成功，目标路径: %s", targetPath)
		return targetPath, nil
	} else if originalPath != "" {
		// 如果没有 uri，直接复制文件
		log.Printf("[ScreenRecord] 使用 cp 命令复制文件，原始路径: %s", originalPath)
		copyArgs := []string{
			"-t", connectKey,
			"shell", "cp", originalPath, targetPath,
		}

		log.Printf("[ScreenRecord] 执行复制命令: hdc %s", strings.Join(copyArgs, " "))
		copyResult, err := ExecuteHdc(copyArgs)
		if err != nil || copyResult == nil || !copyResult.Success {
			log.Printf("[ScreenRecord] 复制文件失败: err=%v, result=%v", err, copyResult)
			return "", fmt.Errorf("复制录屏文件失败: %v", err)
		}

		log.Printf("[ScreenRecord] 复制成功，输出: %s", copyResult.Output)
		return targetPath, nil
	}

	log.Printf("[ScreenRecord] 错误：缺少 uri 或原始路径")
	return "", fmt.Errorf("无法复制文件：缺少 uri 或原始路径")
}

// DownloadScreenRecordFile 下载录屏文件到本地，并删除设备上的临时文件
func DownloadScreenRecordFile(connectKey string, devicePath string, savePath string, fileName string) (*ScreenRecordInfo, error) {
	log.Printf("[ScreenRecord] 开始下载录屏文件: devicePath=%s, savePath=%s, fileName=%s", devicePath, savePath, fileName)

	// 确定保存路径
	targetDir := savePath
	if targetDir == "" {
		var err error
		targetDir, err = GetDefaultScreenshotPath()
		if err != nil {
			log.Printf("[ScreenRecord] 获取默认路径失败: %v", err)
			return nil, fmt.Errorf("获取默认路径失败: %v", err)
		}
		log.Printf("[ScreenRecord] 使用默认路径: %s", targetDir)
	} else {
		log.Printf("[ScreenRecord] 使用指定路径: %s", targetDir)
	}

	// 确保目录存在
	log.Printf("[ScreenRecord] 创建本地目录: %s", targetDir)
	if err := os.MkdirAll(targetDir, 0755); err != nil {
		log.Printf("[ScreenRecord] 创建目录失败: %v", err)
		return nil, fmt.Errorf("创建目录失败: %v", err)
	}
	log.Printf("[ScreenRecord] 目录创建成功")

	localPath := filepath.Join(targetDir, fileName)
	log.Printf("[ScreenRecord] 本地文件路径: %s", localPath)

	// 从设备拉取录屏文件到本地
	// hdc file recv {RecordFile} d:\test.mp4
	recvArgs := []string{"-t", connectKey, "file", "recv", devicePath, localPath}
	log.Printf("[ScreenRecord] 执行下载命令: hdc %s", strings.Join(recvArgs, " "))
	recvResult, err := ExecuteHdc(recvArgs)
	if err != nil {
		log.Printf("[ScreenRecord] 下载文件失败: err=%v", err)
		return nil, fmt.Errorf("传输录屏文件失败: %v", err)
	}
	if recvResult == nil || !recvResult.Success {
		log.Printf("[ScreenRecord] 下载文件失败: result=%v, output=%s, error=%s", recvResult, recvResult.Output, recvResult.Error)
		return nil, fmt.Errorf("传输录屏文件失败: %v", recvResult.Error)
	}
	log.Printf("[ScreenRecord] 下载命令输出: %s", recvResult.Output)

	// 检查本地文件是否存在
	if stat, err := os.Stat(localPath); err != nil {
		log.Printf("[ScreenRecord] 警告：本地文件不存在: %v", err)
		return nil, fmt.Errorf("下载后文件不存在: %v", err)
	} else {
		log.Printf("[ScreenRecord] 本地文件存在，大小: %d 字节", stat.Size())
	}

	// 获取本地文件大小
	var fileSize int64
	if stat, err := os.Stat(localPath); err == nil {
		fileSize = stat.Size()
		log.Printf("[ScreenRecord] 文件大小: %d 字节 (%.2f MB)", fileSize, float64(fileSize)/(1024*1024))
	} else {
		log.Printf("[ScreenRecord] 警告：无法获取文件大小: %v", err)
	}

	// 删除设备上的临时文件（/data/local/tmp/screenrecord/ 下的文件）
	deviceTmpFile := fmt.Sprintf("/data/local/tmp/screenrecord/%s", fileName)
	log.Printf("[ScreenRecord] 删除设备临时文件: %s", deviceTmpFile)
	rmResult, rmErr := ExecuteHdc([]string{"-t", connectKey, "shell", "rm", "-f", deviceTmpFile})
	if rmErr != nil || rmResult == nil || !rmResult.Success {
		log.Printf("[ScreenRecord] 警告：删除临时文件失败: err=%v, result=%v", rmErr, rmResult)
	} else {
		log.Printf("[ScreenRecord] 临时文件已删除")
	}

	log.Printf("[ScreenRecord] 下载完成: localPath=%s, size=%d", localPath, fileSize)
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
		var err error
		targetDir, err = GetDefaultScreenshotPath()
		if err != nil {
			return []ScreenRecordHistoryItem{}, nil
		}
	}

	if _, err := os.Stat(targetDir); os.IsNotExist(err) {
		return []ScreenRecordHistoryItem{}, nil
	}

	entries, err := os.ReadDir(targetDir)
	if err != nil {
		return []ScreenRecordHistoryItem{}, nil
	}

	historyItems := []ScreenRecordHistoryItem{}

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		fileName := entry.Name()
		// 过滤出录屏文件（mp4）
		isScreenRecord := strings.HasPrefix(fileName, "screenrecord-") || strings.HasPrefix(fileName, "screenrecord_")
		if !isScreenRecord || !strings.HasSuffix(fileName, ".mp4") {
			continue
		}

		filePath := filepath.Join(targetDir, fileName)
		fileInfo, err := entry.Info()
		if err != nil {
			continue
		}

		historyItems = append(historyItems, ScreenRecordHistoryItem{
			LocalPath: filePath,
			FileName:  fileName,
			Timestamp: fileInfo.ModTime().UnixMilli(),
			Size:      fileInfo.Size(),
		})
	}

	// 按时间戳降序排序（最新的在前）
	sort.Slice(historyItems, func(i, j int) bool {
		return historyItems[i].Timestamp > historyItems[j].Timestamp
	})

	return historyItems, nil
}
