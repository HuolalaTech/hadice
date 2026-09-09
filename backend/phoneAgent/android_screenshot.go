package phoneAgent

import (
	"fmt"
	"regexp"
	"strings"
	"time"

	"Hadice/backend/adb"
)

// GetAndroidScreenshotDirect 获取Android设备截图（直接在设备上转Base64，避免文件传输）
func GetAndroidScreenshotDirect(connectKey string) (*ScreenshotData, error) {
	// 生成设备上的临时文件名
	now := time.Now()
	fileName := fmt.Sprintf("agent_screen_%04d%02d%02d_%02d%02d%02d.png",
		now.Year(), now.Month(), now.Day(), now.Hour(), now.Minute(), now.Second())
	devicePath := fmt.Sprintf("/data/local/tmp/%s", fileName)

	// 确保清理临时文件
	defer func() {
		adb.ExecuteAdb([]string{"-s", connectKey, "shell", "rm", "-f", devicePath})
	}()

	// 方法1: screencap -p 保存到文件，再 base64
	result, err := adb.ExecuteAdb([]string{"-s", connectKey, "shell", "screencap", "-p", devicePath})
	if err != nil || result == nil || !result.Success {
		errMsg := "screencap -p 失败"
		if result != nil && result.Error != "" {
			errMsg = result.Error
		} else if err != nil {
			errMsg = err.Error()
		}

		// 方法2: 尝试不带 -p 参数
		result2, err2 := adb.ExecuteAdb([]string{"-s", connectKey, "shell", "screencap", devicePath})
		if err2 != nil || result2 == nil || !result2.Success {
			return nil, fmt.Errorf("截图失败: %s (fallback also failed)", errMsg)
		}

		result = result2
	}

	// 在设备上转换为Base64
	base64Result, err := adb.ExecuteAdb([]string{"-s", connectKey, "shell", "base64", devicePath})
	if err != nil || base64Result == nil || !base64Result.Success {
		// fallback: screencap 直接输出到 stdout，再本地转 base64
		return getAndroidScreenshotViaStdout(connectKey)
	}

	if base64Result.Output == "" {
		return nil, fmt.Errorf("截图失败: base64 输出为空（文件可能未生成）")
	}

	// 获取屏幕尺寸
	width, height := getAndroidScreenSizeForAgent(connectKey)

	return &ScreenshotData{
		Base64Data: cleanBase64Output(base64Result.Output),
		Width:      width,
		Height:     height,
	}, nil
}

// getAndroidScreenshotViaStdout 备选方案：通过 screencap stdout 输出直接获取截图
func getAndroidScreenshotViaStdout(connectKey string) (*ScreenshotData, error) {
	result, err := adb.ExecuteAdb([]string{"-s", connectKey, "shell", "screencap", "-p"})
	if err != nil || result == nil {
		return nil, fmt.Errorf("截图失败(screencap stdout): %v", err)
	}

	if result.Output == "" {
		return nil, fmt.Errorf("截图失败: screencap stdout 输出为空")
	}

	// result.Output 是 raw PNG 的文本表示，需要通过 CombinedOutput 获取二进制数据
	// 但 CombinedOutput 返回的是 string，PNG 二进制数据可能已损坏
	// 使用 ExecuteShellCommand 方式获取二进制数据并本地 base64
	shellResult, err := adb.ExecuteShellCommand(connectKey, "screencap -p | base64")
	if err != nil || shellResult == nil || !shellResult.Success {
		return nil, fmt.Errorf("截图失败(shell fallback): output=%s, err=%v", shellResultOutput(shellResult), err)
	}

	if shellResult.Output == "" {
		return nil, fmt.Errorf("截图失败: shell screencap | base64 输出为空")
	}

	width, height := getAndroidScreenSizeForAgent(connectKey)

	return &ScreenshotData{
		Base64Data: cleanBase64Output(shellResult.Output),
		Width:      width,
		Height:     height,
	}, nil
}

// cleanBase64Output 清理 base64 输出（去除换行符等）
func cleanBase64Output(output string) string {
	cleaned := strings.ReplaceAll(output, "\n", "")
	cleaned = strings.ReplaceAll(cleaned, "\r", "")
	return strings.TrimSpace(cleaned)
}

// shellResultOutput 安全获取 shellResult.Output
func shellResultOutput(r *adb.AdbResult) string {
	if r == nil {
		return "(nil)"
	}
	return r.Output
}

// GetAndroidCurrentAppInfo 获取Android设备当前前台应用信息
func GetAndroidCurrentAppInfo(connectKey string) (*AppInfo, error) {
	// 使用 dumpsys activity 获取前台 Activity
	result, err := adb.ExecuteAdb([]string{
		"-s", connectKey,
		"shell", "dumpsys", "activity", "activities",
	})
	if err != nil || result == nil || !result.Success {
		return &AppInfo{
			PackageName: "unknown",
			AppName:     "unknown",
		}, nil
	}

	// 解析 mResumedActivity 行
	// 格式示例: mResumedActivity: ActivityRecord{xxx u0 com.example.app/.ActivityName t123}
	re := regexp.MustCompile(`mResumedActivity:.*\s(\S+)/(\S+)\s`)
	matches := re.FindStringSubmatch(result.Output)
	if len(matches) >= 3 {
		packageName := matches[1]
		activityName := matches[2]
		return &AppInfo{
			PackageName: packageName,
			AppName:     packageName,
			Activity:    activityName,
		}, nil
	}

	// 备选：尝试 topResumedActivity
	re2 := regexp.MustCompile(`topResumedActivity=.*\s(\S+)/(\S+)\s`)
	matches2 := re2.FindStringSubmatch(result.Output)
	if len(matches2) >= 3 {
		packageName := matches2[1]
		activityName := matches2[2]
		return &AppInfo{
			PackageName: packageName,
			AppName:     packageName,
			Activity:    activityName,
		}, nil
	}

	return &AppInfo{
		PackageName: "unknown",
		AppName:     "unknown",
	}, nil
}

// getAndroidScreenSizeForAgent 获取Android屏幕尺寸
func getAndroidScreenSizeForAgent(deviceSn string) (int, int) {
	result, err := adb.ExecuteAdb([]string{"-s", deviceSn, "shell", "wm", "size"})
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
