package applayout

import (
	"fmt"
	"strings"
	"time"

	"Hadice/backend/adb"
	"Hadice/backend/device"
	"Hadice/backend/hdc"
)

type shot struct {
	B64    string
	Mime   string
	Width  int
	Height int
}

func takeScreenshot(connectKey, platform string) (*shot, error) {
	switch platform {
	case string(device.PlatformAndroid):
		return screenshotAndroid(connectKey)
	default:
		return screenshotHarmony(connectKey)
	}
}

func screenshotHarmony(connectKey string) (*shot, error) {
	res, err := hdc.TakeScreenshotDirect(connectKey)
	if err != nil {
		return nil, err
	}
	return &shot{
		B64:    res.Base64Data,
		Mime:   "image/jpeg",
		Width:  res.Width,
		Height: res.Height,
	}, nil
}

func screenshotAndroid(connectKey string) (*shot, error) {
	now := time.Now()
	devicePath := fmt.Sprintf("/data/local/tmp/hadice_layout_%d.png", now.UnixNano())
	defer func() {
		adb.ExecuteAdb([]string{"-s", connectKey, "shell", "rm", "-f", devicePath})
	}()

	result, err := adb.ExecuteAdb([]string{"-s", connectKey, "shell", "screencap", "-p", devicePath})
	if err != nil || result == nil || !result.Success {
		return nil, fmt.Errorf("screencap 失败: %v", err)
	}

	b64, err := adb.ExecuteAdb([]string{"-s", connectKey, "shell", "base64", devicePath})
	if err != nil || b64 == nil || !b64.Success || strings.TrimSpace(b64.Output) == "" {
		return nil, fmt.Errorf("截图 base64 失败")
	}

	w, h := androidScreenSize(connectKey)
	return &shot{
		B64:    cleanB64(b64.Output),
		Mime:   "image/png",
		Width:  w,
		Height: h,
	}, nil
}

func androidScreenSize(connectKey string) (int, int) {
	res, err := adb.ExecuteAdb([]string{"-s", connectKey, "shell", "wm", "size"})
	if err != nil || res == nil {
		return 0, 0
	}
	// Physical size: 1080x2400
	out := res.Output
	idx := strings.LastIndex(out, ":")
	if idx < 0 {
		return 0, 0
	}
	dim := strings.TrimSpace(out[idx+1:])
	parts := strings.Split(dim, "x")
	if len(parts) != 2 {
		return 0, 0
	}
	var w, h int
	fmt.Sscanf(strings.TrimSpace(parts[0]), "%d", &w)
	fmt.Sscanf(strings.TrimSpace(parts[1]), "%d", &h)
	return w, h
}

func cleanB64(s string) string {
	s = strings.ReplaceAll(s, "\n", "")
	s = strings.ReplaceAll(s, "\r", "")
	return strings.TrimSpace(s)
}
