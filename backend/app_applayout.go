package backend

import (
	"Hadice/backend/applayout"
)

// AppLayoutListPages 列出应用页面（Ability / Activity）。实验功能，随 applayout 包可整体移除。
func (a *App) AppLayoutListPages(connectKey string, platform string, packageName string) ([]applayout.PageInfo, error) {
	return applayout.ListPages(connectKey, platform, packageName)
}

// AppLayoutInspect 可选启动页面后抓取布局树 + 截图。pageName 为空则只抓当前前台。
func (a *App) AppLayoutInspect(connectKey string, platform string, packageName string, pageName string) (*applayout.DumpResult, error) {
	return applayout.Inspect(connectKey, platform, packageName, pageName)
}
