// Package applayout 应用布局树抓取（实验功能，可整体移除）
package applayout

// Bounds 控件矩形（设备坐标，像素）
type Bounds struct {
	Left   int `json:"left"`
	Top    int `json:"top"`
	Right  int `json:"right"`
	Bottom int `json:"bottom"`
}

// Node 统一控件节点（鸿蒙 JSON / 安卓 XML 归一化后）
type Node struct {
	ID         string  `json:"id"`
	Type       string  `json:"type"`
	Text       string  `json:"text,omitempty"`
	ResourceID string  `json:"resourceId,omitempty"`
	Desc       string  `json:"desc,omitempty"`
	Clickable  bool    `json:"clickable,omitempty"`
	Bounds     Bounds  `json:"bounds"`
	Children   []*Node `json:"children,omitempty"`
}

// PageInfo Ability / Activity 条目
type PageInfo struct {
	Name  string `json:"name"`
	Label string `json:"label,omitempty"`
}

// DumpResult 一次抓取结果
type DumpResult struct {
	Platform       string `json:"platform"`
	PackageName    string `json:"packageName,omitempty"`
	PageName       string `json:"pageName,omitempty"`
	NodeCount      int    `json:"nodeCount"`
	Root           *Node  `json:"root"`
	ScreenshotB64  string `json:"screenshotB64,omitempty"`
	ScreenshotMime string `json:"screenshotMime,omitempty"`
	Width          int    `json:"width,omitempty"`
	Height         int    `json:"height,omitempty"`
	RawHint        string `json:"rawHint,omitempty"` // 调试：源格式
}
