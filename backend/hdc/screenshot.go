package hdc

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"time"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// ScreenshotInfo 截图信息
type ScreenshotInfo struct {
	LocalPath string `json:"localPath"` // 本地文件路径
	FileName  string `json:"fileName"`  // 文件名
	Timestamp int64  `json:"timestamp"` // 截图时间戳
	Width     int    `json:"width"`     // 图片宽度
	Height    int    `json:"height"`    // 图片高度
	Size      int64  `json:"size"`      // 文件大小（字节）
}

// ScreenshotHistoryItem 截图历史记录项
type ScreenshotHistoryItem struct {
	LocalPath string `json:"localPath"` // 本地文件路径
	FileName  string `json:"fileName"`  // 文件名
	Timestamp int64  `json:"timestamp"` // 截图时间戳
	Size      int64  `json:"size"`      // 文件大小（字节）
}

// GetDefaultScreenshotPath 获取默认截图保存路径
func GetDefaultScreenshotPath() (string, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}

	defaultPath := filepath.Join(homeDir, "Documents", "Hadice", "screenshot")

	// 确保目录存在
	if err := os.MkdirAll(defaultPath, 0755); err != nil {
		return "", err
	}

	return defaultPath, nil
}

// generateScreenshotFileName 生成截图文件名
func generateScreenshotFileName(format string) string {
	now := time.Now()
	formatStr := "screen_%04d%02d%02d_%02d%02d%02d.%s"
	return fmt.Sprintf(formatStr, now.Year(), now.Month(), now.Day(), now.Hour(), now.Minute(), now.Second(), format)
}

// TakeScreenshotDirect 获取设备截图的Base64数据（优化版，避免文件传输）
// 优化策略：
//  1. 在设备上直接截图到临时文件
//  2. 在设备上直接转换为Base64（避免文件传输）
//  3. 删除设备上的临时文件
//
// 相比传统方式减少了文件传输步骤，提升性能并降低网络开销
//
// 参数：
//
//	connectKey: 设备连接标识符
//
// 返回：
//
//	*ScreenshotDirectResult: 包含Base64数据、尺寸和时间戳
//	error: 错误信息
//
// 性能优势：
//   - 减少1次文件传输操作（hdc file recv）
//   - 降低网络延迟
//   - 减少本地临时文件I/O操作
func TakeScreenshotDirect(connectKey string) (*ScreenshotDirectResult, error) {
	// 生成设备上的临时文件名（使用时间戳确保唯一性）
	now := time.Now()
	fileName := fmt.Sprintf("screen_%04d%02d%02d_%02d%02d%02d.jpeg",
		now.Year(), now.Month(), now.Day(), now.Hour(), now.Minute(), now.Second())
	devicePath := fmt.Sprintf("/data/local/tmp/%s", fileName)

	// 步骤1: 在设备上截图
	captureResult, err := ExecuteHdc([]string{"-t", connectKey, "shell", "snapshot_display", "-f", devicePath})
	if err != nil || captureResult == nil || !captureResult.Success {
		return nil, fmt.Errorf("截图失败: %v", err)
	}

	// 获取屏幕尺寸（优先使用 param 命令，然后尝试从截图输出解析）
	width := 0
	height := 0

	// 方法1：使用 param get const.product.cover_window_size 获取屏幕尺寸
	// 输出格式: x1,y1,x2,y2（例如：806,0,1260,2720），提取最后两位作为宽高
	paramResult, err := ExecuteHdc([]string{"-t", connectKey, "shell", "param", "get", "const.product.cover_window_size"})
	if err == nil && paramResult != nil && paramResult.Success && paramResult.Output != "" {
		output := strings.TrimSpace(paramResult.Output)
		parts := strings.Split(output, ",")
		if len(parts) >= 4 {
			fmt.Sscanf(strings.TrimSpace(parts[2]), "%d", &width)
			fmt.Sscanf(strings.TrimSpace(parts[3]), "%d", &height)
		}
	}

	// 方法2：如果 param 命令失败，尝试从截图输出解析尺寸
	if width == 0 || height == 0 {
		// snapshot_display 输出格式: success: snapshot display 0 , write to /xxx as jpeg, width 1260, height 2720
		widthRe := regexp.MustCompile(`width\s+(\d+)`)
		heightRe := regexp.MustCompile(`height\s+(\d+)`)
		if matches := widthRe.FindStringSubmatch(captureResult.Output); len(matches) > 1 {
			fmt.Sscanf(matches[1], "%d", &width)
		}
		if matches := heightRe.FindStringSubmatch(captureResult.Output); len(matches) > 1 {
			fmt.Sscanf(matches[1], "%d", &height)
		}
	}

	// 步骤2: 在设备上直接转换为Base64
	base64Result, err := ExecuteHdc([]string{"-t", connectKey, "shell", "base64", devicePath})
	if err != nil || base64Result == nil || !base64Result.Success {
		// 清理设备上的临时文件
		ExecuteHdc([]string{"-t", connectKey, "shell", "rm", "-f", devicePath})
		return nil, fmt.Errorf("Base64转换失败: %v", err)
	}

	// 步骤3: 删除设备上的临时截图文件
	ExecuteHdc([]string{"-t", connectKey, "shell", "rm", "-f", devicePath})

	// 清理Base64输出（移除可能的换行符和空白字符）
	base64Data := strings.TrimSpace(strings.ReplaceAll(base64Result.Output, "\n", ""))

	return &ScreenshotDirectResult{
		Base64Data: base64Data,
		Width:      width,
		Height:     height,
		Timestamp:  now.UnixMilli(),
	}, nil
}

// ScreenshotDirectResult 直接截图结果（Base64格式）
type ScreenshotDirectResult struct {
	Base64Data string `json:"base64Data"` // Base64编码的图片数据
	Width      int    `json:"width"`      // 图片宽度
	Height     int    `json:"height"`     // 图片高度
	Timestamp  int64  `json:"timestamp"`  // 截图时间戳
}

// TakeScreenshot 截取设备屏幕截图
func TakeScreenshot(connectKey string, savePath string, format string) (*ScreenshotInfo, error) {
	// 确定保存路径
	targetDir := savePath
	if targetDir == "" {
		var err error
		targetDir, err = GetDefaultScreenshotPath()
		if err != nil {
			return nil, fmt.Errorf("获取默认路径失败: %v", err)
		}
	}

	// 确保目录存在
	if err := os.MkdirAll(targetDir, 0755); err != nil {
		return nil, fmt.Errorf("创建目录失败: %v", err)
	}

	// 生成文件名
	if format == "" {
		format = "jpeg"
	}
	fileName := generateScreenshotFileName(format)
	localPath := filepath.Join(targetDir, fileName)

	// 设备上的临时文件路径
	deviceTmpPath := fmt.Sprintf("/data/local/tmp/%s", fileName)

	// 根据格式选择截图命令
	var captureResult *HdcResult
	var err error

	if format == "jpeg" {
		// 使用 snapshot_display（只支持 jpeg）
		captureResult, err = ExecuteHdc([]string{"-t", connectKey, "shell", "snapshot_display", "-f", deviceTmpPath})
	} else {
		// 使用 uitest screenCap（支持 png）
		captureResult, err = ExecuteHdc([]string{"-t", connectKey, "shell", "uitest", "screenCap", "-p", deviceTmpPath})
	}

	if err != nil || captureResult == nil || !captureResult.Success {
		return nil, fmt.Errorf("截图失败: %v", err)
	}

	// 获取屏幕尺寸（优先使用 param 命令，然后尝试从截图输出解析）
	width := 0
	height := 0

	if format == "jpeg" {
		// 方法1：使用 param get const.product.cover_window_size 获取屏幕尺寸
		// 输出格式: x1,y1,x2,y2（例如：806,0,1260,2720），提取最后两位作为宽高
		paramResult, err := ExecuteHdc([]string{"-t", connectKey, "shell", "param", "get", "const.product.cover_window_size"})
		if err == nil && paramResult != nil && paramResult.Success && paramResult.Output != "" {
			output := strings.TrimSpace(paramResult.Output)
			parts := strings.Split(output, ",")
			if len(parts) >= 4 {
				fmt.Sscanf(strings.TrimSpace(parts[2]), "%d", &width)
				fmt.Sscanf(strings.TrimSpace(parts[3]), "%d", &height)
			}
		}

		// 方法2：如果 param 命令失败，尝试从截图输出解析尺寸
		if width == 0 || height == 0 {
			// snapshot_display 输出格式: success: snapshot display 0 , write to /xxx as jpeg, width 1260, height 2720
			widthRe := regexp.MustCompile(`width\s+(\d+)`)
			heightRe := regexp.MustCompile(`height\s+(\d+)`)
			if matches := widthRe.FindStringSubmatch(captureResult.Output); len(matches) > 1 {
				fmt.Sscanf(matches[1], "%d", &width)
			}
			if matches := heightRe.FindStringSubmatch(captureResult.Output); len(matches) > 1 {
				fmt.Sscanf(matches[1], "%d", &height)
			}
		}
	}

	// 从设备拉取截图到本地
	recvResult, err := ExecuteHdc([]string{"-t", connectKey, "file", "recv", deviceTmpPath, localPath})
	if err != nil || recvResult == nil || !recvResult.Success {
		return nil, fmt.Errorf("传输截图失败: %v", err)
	}

	// 删除设备上的临时文件
	ExecuteHdc([]string{"-t", connectKey, "shell", "rm", "-f", deviceTmpPath})

	// 获取本地文件大小
	var fileSize int64
	if stat, err := os.Stat(localPath); err == nil {
		fileSize = stat.Size()
	}

	return &ScreenshotInfo{
		LocalPath: localPath,
		FileName:  fileName,
		Timestamp: time.Now().UnixMilli(),
		Width:     width,
		Height:    height,
		Size:      fileSize,
	}, nil
}

// GetScreenshotHistory 获取截图历史记录
func GetScreenshotHistory(savePath string) ([]ScreenshotHistoryItem, error) {
	targetDir := savePath
	if targetDir == "" {
		var err error
		targetDir, err = GetDefaultScreenshotPath()
		if err != nil {
			return []ScreenshotHistoryItem{}, nil
		}
	}

	if _, err := os.Stat(targetDir); os.IsNotExist(err) {
		return []ScreenshotHistoryItem{}, nil
	}

	entries, err := os.ReadDir(targetDir)
	if err != nil {
		return []ScreenshotHistoryItem{}, nil
	}

	historyItems := []ScreenshotHistoryItem{}

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		fileName := entry.Name()
		// 过滤出截图文件（jpeg 和 png）
		isScreenshot := strings.HasPrefix(fileName, "screen_") || strings.HasPrefix(fileName, "screenshot_")
		if !isScreenshot || (!strings.HasSuffix(fileName, ".jpeg") && !strings.HasSuffix(fileName, ".png")) {
			continue
		}

		filePath := filepath.Join(targetDir, fileName)
		fileInfo, err := entry.Info()
		if err != nil {
			continue
		}

		historyItems = append(historyItems, ScreenshotHistoryItem{
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

// DeleteScreenshot 删除截图文件
func DeleteScreenshot(filePath string) error {
	return os.Remove(filePath)
}

// ClearScreenshotHistory 清空截图历史
func ClearScreenshotHistory(savePath string) (int, error) {
	targetDir := savePath
	if targetDir == "" {
		var err error
		targetDir, err = GetDefaultScreenshotPath()
		if err != nil {
			return 0, nil
		}
	}

	if _, err := os.Stat(targetDir); os.IsNotExist(err) {
		return 0, nil
	}

	entries, err := os.ReadDir(targetDir)
	if err != nil {
		return 0, err
	}

	count := 0
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		fileName := entry.Name()
		isScreenshot := strings.HasPrefix(fileName, "screen_") || strings.HasPrefix(fileName, "screenshot_")
		if !isScreenshot || (!strings.HasSuffix(fileName, ".jpeg") && !strings.HasSuffix(fileName, ".png")) {
			continue
		}

		filePath := filepath.Join(targetDir, fileName)
		if err := os.Remove(filePath); err == nil {
			count++
		}
	}

	return count, nil
}

// OpenScreenshotFolder 在文件管理器中打开截图目录
func OpenScreenshotFolder(ctx interface{}, savePath string) error {
	targetDir := savePath
	if targetDir == "" {
		var err error
		targetDir, err = GetDefaultScreenshotPath()
		if err != nil {
			return err
		}
	}

	// 确保目录存在
	if err := os.MkdirAll(targetDir, 0755); err != nil {
		return err
	}

	// 使用系统命令打开文件夹
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", targetDir)
	case "windows":
		cmd = exec.Command("explorer", targetDir)
		// Windows 下隐藏命令窗口
		HideWindowsConsoleWindow(cmd)
	default:
		cmd = exec.Command("xdg-open", targetDir)
	}
	return cmd.Run()
}

// OpenScreenshotFile 在文件管理器中打开截图文件并定位
func OpenScreenshotFile(ctx interface{}, filePath string) error {
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		return fmt.Errorf("文件不存在")
	}

	// 使用系统命令打开文件所在文件夹并定位文件
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", "-R", filePath)
	case "windows":
		cmd = exec.Command("explorer", "/select,", filePath)
		// Windows 下隐藏命令窗口
		HideWindowsConsoleWindow(cmd)
	default:
		dir := filepath.Dir(filePath)
		cmd = exec.Command("xdg-open", dir)
	}
	return cmd.Run()
}

// ReadImageAsBase64 读取本地图片文件并返回 base64 数据 URL
func ReadImageAsBase64(filePath string) (string, error) {
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		return "", fmt.Errorf("文件不存在")
	}

	data, err := os.ReadFile(filePath)
	if err != nil {
		return "", fmt.Errorf("读取文件失败: %v", err)
	}

	if len(data) == 0 {
		return "", fmt.Errorf("文件为空")
	}

	base64Str := base64.StdEncoding.EncodeToString(data)

	// 根据文件扩展名确定 MIME 类型
	ext := strings.ToLower(filepath.Ext(filePath))
	mimeType := "image/jpeg"
	switch ext {
	case ".png":
		mimeType = "image/png"
	case ".gif":
		mimeType = "image/gif"
	case ".webp":
		mimeType = "image/webp"
	}

	return fmt.Sprintf("data:%s;base64,%s", mimeType, base64Str), nil
}

// ExtractVideoFirstFrame 提取视频第一帧并返回 base64 图片数据
func ExtractVideoFirstFrame(videoPath string) (string, error) {
	if _, err := os.Stat(videoPath); os.IsNotExist(err) {
		return "", fmt.Errorf("文件不存在")
	}

	// 检查是否安装了 ffmpeg
	ffmpegPath, err := exec.LookPath("ffmpeg")
	if err != nil {
		return "", fmt.Errorf("未找到 ffmpeg，请先安装 ffmpeg")
	}

	// 创建临时文件保存第一帧图片
	tmpDir := os.TempDir()
	tmpImagePath := filepath.Join(tmpDir, fmt.Sprintf("video_frame_%d.jpg", time.Now().UnixNano()))
	defer os.Remove(tmpImagePath) // 清理临时文件

	// 使用 ffmpeg 提取第一帧
	// ffmpeg -i input.mp4 -vframes 1 -q:v 2 output.jpg
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, ffmpegPath,
		"-i", videoPath,
		"-vframes", "1",
		"-q:v", "2",
		"-y", // 覆盖输出文件
		tmpImagePath,
	)

	// Windows 下隐藏命令窗口
	if runtime.GOOS == "windows" {
		HideWindowsConsoleWindow(cmd)
	}

	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("提取视频第一帧失败: %v, 输出: %s", err, string(output))
	}

	// 读取提取的图片文件
	imageData, err := os.ReadFile(tmpImagePath)
	if err != nil {
		return "", fmt.Errorf("读取提取的图片失败: %v", err)
	}

	if len(imageData) == 0 {
		return "", fmt.Errorf("提取的图片为空")
	}

	// 转换为 base64
	base64Str := base64.StdEncoding.EncodeToString(imageData)
	return fmt.Sprintf("data:image/jpeg;base64,%s", base64Str), nil
}

// CopyFilePathToClipboard 复制文件路径到剪贴板（macOS Finder 风格）
func CopyFilePathToClipboard(filePath string) error {
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		return fmt.Errorf("文件不存在")
	}

	// 根据操作系统使用不同的方法复制文件路径到剪贴板
	switch runtime.GOOS {
	case "darwin":
		// macOS: 使用 osascript 调用 AppleScript 复制文件路径（Finder 风格）
		script := fmt.Sprintf(`
			set theFile to POSIX file "%s"
			set the clipboard to theFile
		`, filePath)
		cmd := exec.Command("osascript", "-e", script)
		if err := cmd.Run(); err != nil {
			return fmt.Errorf("复制文件路径到剪贴板失败: %v", err)
		}
		return nil
	case "windows":
		// Windows: 使用 PowerShell 复制文件路径
		psScript := fmt.Sprintf(`
			Add-Type -AssemblyName System.Windows.Forms
			[System.Windows.Forms.Clipboard]::SetText('%s')
		`, filePath)
		cmd := exec.Command("powershell", "-Command", psScript)
		// Windows 下隐藏命令窗口
		HideWindowsConsoleWindow(cmd)
		if err := cmd.Run(); err != nil {
			return fmt.Errorf("复制文件路径到剪贴板失败: %v", err)
		}
		return nil
	default:
		// Linux: 使用 xclip 或 xsel
		cmd := exec.Command("xclip", "-selection", "clipboard")
		cmd.Stdin = strings.NewReader(filePath)
		if err := cmd.Run(); err != nil {
			// 如果 xclip 失败，尝试 xsel
			cmd2 := exec.Command("xsel", "--clipboard", "--input")
			cmd2.Stdin = strings.NewReader(filePath)
			if err2 := cmd2.Run(); err2 != nil {
				return fmt.Errorf("复制文件路径到剪贴板失败: 需要安装 xclip 或 xsel")
			}
		}
		return nil
	}
}

// CopyImageToClipboard 复制图片到剪贴板
func CopyImageToClipboard(ctx interface{}, filePath string) error {
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		return fmt.Errorf("文件不存在")
	}

	// 根据操作系统使用不同的方法复制图片到剪贴板
	switch runtime.GOOS {
	case "darwin":
		// macOS: 使用 osascript 调用 AppleScript 复制图片
		// 读取图片文件并复制到剪贴板
		script := fmt.Sprintf(`
			set theFile to POSIX file "%s"
			set the clipboard to (read theFile as «class PNGf»)
		`, filePath)
		cmd := exec.Command("osascript", "-e", script)
		if err := cmd.Run(); err != nil {
			// 如果 PNGf 格式失败，尝试使用通用图片格式
			script2 := fmt.Sprintf(`
				set theFile to POSIX file "%s"
				set the clipboard to (read theFile as «class PICT»)
			`, filePath)
			cmd2 := exec.Command("osascript", "-e", script2)
			if err2 := cmd2.Run(); err2 != nil {
				return fmt.Errorf("复制图片到剪贴板失败: %v", err2)
			}
		}
		return nil
	case "windows":
		// Windows: 使用 PowerShell 复制图片到剪贴板
		// 使用 Add-Type 加载 System.Windows.Forms 来复制图片
		psScript := fmt.Sprintf(`
			Add-Type -AssemblyName System.Windows.Forms
			$image = [System.Drawing.Image]::FromFile('%s')
			$dataObject = New-Object System.Windows.Forms.DataObject
			$dataObject.SetImage($image)
			[System.Windows.Forms.Clipboard]::SetDataObject($dataObject, $true)
			$image.Dispose()
		`, filePath)
		cmd := exec.Command("powershell", "-Command", psScript)
		// Windows 下隐藏命令窗口
		HideWindowsConsoleWindow(cmd)
		if err := cmd.Run(); err != nil {
			return fmt.Errorf("复制图片到剪贴板失败: %v", err)
		}
		return nil
	default:
		// Linux: 尝试使用 xclip 或 xsel
		// 先尝试 xclip
		cmd := exec.Command("xclip", "-selection", "clipboard", "-t", "image/png", "-i", filePath)
		if err := cmd.Run(); err != nil {
			// 如果 xclip 失败，尝试 xsel
			cmd2 := exec.Command("xsel", "--clipboard", "--input", "--file", filePath)
			if err2 := cmd2.Run(); err2 != nil {
				return fmt.Errorf("复制图片到剪贴板失败: 需要安装 xclip 或 xsel")
			}
		}
		return nil
	}
}

// SelectScreenshotPath 选择截图保存路径
func SelectScreenshotPath(ctx interface{}) (string, error) {
	if ctx == nil {
		return "", fmt.Errorf("context 不可用")
	}

	// 类型断言为 context.Context
	ctxValue, ok := ctx.(context.Context)
	if !ok {
		return "", fmt.Errorf("context 类型错误")
	}

	// 使用 Wails runtime 打开文件夹选择对话框
	selectedPath, err := wailsRuntime.OpenDirectoryDialog(ctxValue, wailsRuntime.OpenDialogOptions{
		Title: "选择截图保存路径",
	})
	if err != nil {
		return "", err
	}

	return selectedPath, nil
}
