package applayout

import (
	"fmt"
	"strings"

	"Hadice/backend/adb"
	"Hadice/backend/device"
	"Hadice/backend/hdc"
)

// ListPages 列出应用可启动页面（Ability / Activity）
func ListPages(connectKey, platform, packageName string) ([]PageInfo, error) {
	packageName = strings.TrimSpace(packageName)
	if packageName == "" {
		return nil, fmt.Errorf("包名不能为空")
	}

	switch platform {
	case string(device.PlatformAndroid):
		detail, err := adb.GetAppFullDetail(connectKey, packageName)
		if err != nil {
			return nil, err
		}
		pages := make([]PageInfo, 0, len(detail.Abilities))
		for _, ab := range detail.Abilities {
			pages = append(pages, PageInfo{Name: ab.Name, Label: ab.Label})
		}
		return pages, nil
	default:
		detail, err := hdc.GetAppFullDetail(connectKey, packageName)
		if err != nil {
			return nil, err
		}
		pages := make([]PageInfo, 0, len(detail.Abilities))
		for _, ab := range detail.Abilities {
			pages = append(pages, PageInfo{Name: ab.Name, Label: ab.Label})
		}
		return pages, nil
	}
}

// Inspect 可选启动指定页面后抓取布局树 + 截图。
// pageName 为空时只抓当前前台页，不启动。
func Inspect(connectKey, platform, packageName, pageName string) (*DumpResult, error) {
	connectKey = strings.TrimSpace(connectKey)
	if connectKey == "" {
		return nil, fmt.Errorf("设备未连接")
	}
	if platform == "" {
		platform = string(device.PlatformHarmonyOS)
	}

	packageName = strings.TrimSpace(packageName)
	pageName = strings.TrimSpace(pageName)
	if pageName != "" {
		if packageName == "" {
			return nil, fmt.Errorf("启动页面需要包名")
		}
		if err := startPage(connectKey, platform, packageName, pageName); err != nil {
			return nil, err
		}
	}

	root, hint, err := dumpTree(connectKey, platform)
	if err != nil {
		return nil, err
	}

	out := &DumpResult{
		Platform:    platform,
		PackageName: packageName,
		PageName:    pageName,
		Root:        root,
		NodeCount:   countNodes(root),
		RawHint:     hint,
	}

	// 截图失败不阻断树展示
	if shot, shotErr := takeScreenshot(connectKey, platform); shotErr == nil && shot != nil {
		out.ScreenshotB64 = shot.B64
		out.ScreenshotMime = shot.Mime
		out.Width = shot.Width
		out.Height = shot.Height
	}

	return out, nil
}
