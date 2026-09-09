package phoneAgent

import (
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"Hadice/backend/hdc"
)

// GetScreenshotDirect 获取设备截图的优化版本（直接在设备上转Base64，避免文件传输）
// 这是对原GetScreenshot函数的优化版本，采用以下策略提升性能：
//  1. hdc shell snapshot_display -f /data/local/tmp/screen_xxx.jpeg （设备截图）
//  2. hdc shell base64 /data/local/tmp/screen_xxx.jpeg （设备上转Base64）
//  3. 删除设备上的临时文件
//
// 相比原版本的优势：
//   - 无需将截图文件从设备传输到本地（节省网络带宽和时间）
//   - 减少本地文件I/O操作
//   - 降低磁盘空间占用
//   - 提升整体响应速度
//
// 参数：
//
//	connectKey: 设备连接标识符
//
// 返回：
//
//	*ScreenshotData: 截图数据（Base64格式）
//	error: 错误信息
func GetScreenshotDirect(connectKey string) (*ScreenshotData, error) {
	result, err := hdc.TakeScreenshotDirect(connectKey)
	if err != nil {
		return nil, fmt.Errorf("直接截图失败: %v", err)
	}

	return &ScreenshotData{
		Base64Data: result.Base64Data,
		Width:      result.Width,
		Height:     result.Height,
	}, nil
}

// GetScreenshot 获取设备截图并转换为Base64（兼容性函数，逐步迁移到GetScreenshotDirect）
// connectKey: 设备标识符
// 返回截图数据和错误
func GetScreenshot(connectKey string) (*ScreenshotData, error) {
	// 创建临时目录
	tmpDir := filepath.Join(os.TempDir(), "harmony_hadice_screenshots")
	if err := os.MkdirAll(tmpDir, 0755); err != nil {
		return nil, fmt.Errorf("创建临时目录失败: %v", err)
	}

	// 生成临时文件名
	fileName := fmt.Sprintf("screenshot_%d.jpeg", time.Now().UnixNano())
	tmpPath := filepath.Join(tmpDir, fileName)

	// 调用HDC截图功能
	screenshotInfo, err := hdc.TakeScreenshot(connectKey, tmpDir, "jpeg")
	if err != nil {
		return nil, fmt.Errorf("截图失败: %v", err)
	}

	// 读取图片文件
	imageData, err := os.ReadFile(screenshotInfo.LocalPath)
	if err != nil {
		return nil, fmt.Errorf("读取截图文件失败: %v", err)
	}

	// 转换为Base64
	base64Data := base64.StdEncoding.EncodeToString(imageData)

	// 清理临时文件（异步）
	go func() {
		_ = os.Remove(tmpPath)
	}()

	return &ScreenshotData{
		Base64Data: base64Data,
		Width:      screenshotInfo.Width,
		Height:     screenshotInfo.Height,
	}, nil
}

// GetCurrentAppInfo 获取当前应用信息
// connectKey: 设备标识符
// 返回应用信息
// 注意：HarmonyOS设备上dumpsys命令不可用，这里使用ps命令获取前台应用
func GetCurrentAppInfo(connectKey string) (*AppInfo, error) {
	// HarmonyOS上dumpsys不可用，尝试使用其他方法
	// 方法1: 尝试使用ps命令获取前台应用（简化处理）
	// 方法2: 如果无法获取，返回unknown（不影响主要功能）

	// 尝试使用ps命令获取运行中的应用
	// 注意：ps命令无法直接获取前台应用，这里简化处理
	result, err := hdc.ExecuteHdc([]string{
		"-t", connectKey,
		"shell", "ps", "-A",
	})

	// 如果命令执行失败，返回unknown（不影响主要功能）
	if err != nil || !result.Success {
		return &AppInfo{
			PackageName: "unknown",
			AppName:     "unknown",
			Activity:    "",
		}, nil
	}

	// 简化处理：从ps输出中提取第一个应用包名（实际应该解析前台应用）
	// 这里返回unknown，因为ps无法准确获取前台应用
	// 后续可以通过其他方式实现，如使用HarmonyOS特定的命令
	packageName := extractPackageNameFromPS(result.Output)
	if packageName == "" {
		packageName = "unknown"
	}

	return &AppInfo{
		PackageName: packageName,
		AppName:     packageName,
		Activity:    "",
	}, nil
}

// extractPackageNameFromPS 从ps输出中提取包名
// 简化实现：返回unknown，因为ps无法准确获取前台应用
func extractPackageNameFromPS(output string) string {
	// HarmonyOS上无法准确获取前台应用，返回空字符串
	// 后续可以考虑使用其他方法，如：
	// 1. 使用HarmonyOS特定的命令
	// 2. 通过UI自动化框架获取
	// 3. 分析截图内容识别应用
	return ""
}
