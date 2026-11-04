package backend

import (
	"fmt"
	"log"
	"net/url"
	"runtime"
	"sync"
	"time"

	"Hadice/backend/webpeek"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

const webPeekToolbarName = "web-peek-toolbar"
const webPeekContentName = "web-peek-content"

const (
	webPeekDesktopW = 1280
	webPeekDesktopH = 900

	webPeekToolbarExpandedH  = 56
	webPeekToolbarExpandedW  = 720 // 展开条固定宽，靠右上；窄窗再按内容宽收缩
	webPeekToolbarCollapsedW = 40
	webPeekToolbarCollapsedH = 40
	webPeekToolbarInset      = 10
)

var (
	webPeekLastURLMu sync.Mutex
	webPeekLastURL   string

	webPeekToolbarCollapsed      = true // 默认收起
	webPeekContentSyncAttached   bool
	webPeekToolbarFocusHideTimer *time.Timer
	webPeekToolbarFocusMu        sync.Mutex

	// 相对「内容窗右上角锚点」的用户拖拽偏移；切机型尺寸时清零
	webPeekToolbarOffX int
	webPeekToolbarOffY int
	webPeekToolbarUserPlaced bool
)

func setWebPeekLastURL(u string) {
	webPeekLastURLMu.Lock()
	webPeekLastURL = u
	webPeekLastURLMu.Unlock()
}

func getWebPeekLastURL() string {
	webPeekLastURLMu.Lock()
	defer webPeekLastURLMu.Unlock()
	return webPeekLastURL
}

func webPeekApp(a *App) (*application.App, error) {
	app := a.app
	if app == nil {
		app = application.Get()
	}
	if app == nil {
		return nil, fmt.Errorf("应用实例不可用")
	}
	return app, nil
}

func truncateTitle(prefix, u string, max int) string {
	t := prefix + " - " + u
	if len(t) > max {
		return t[:max-3] + "..."
	}
	return t
}

// 内容窗标题栏大致高度，让工具条贴在网页内容区顶部而不是挡红绿灯
func webPeekContentChromeOffset() int {
	if runtime.GOOS == "darwin" {
		return 36
	}
	return 8
}

// OpenWebPeekWindow 打开内容窗（真导航）+ 悬浮可收缩工具条（贴内容窗顶部）。
func (a *App) OpenWebPeekWindow(rawURL string) error {
	normalized, err := webpeek.NormalizeURL(rawURL)
	if err != nil {
		return fmt.Errorf("invalid url: %w", err)
	}
	setWebPeekLastURL(normalized)

	if err := a.openWebPeekContent(normalized, webPeekDesktopW, webPeekDesktopH); err != nil {
		return err
	}
	return a.openWebPeekToolbar(normalized)
}

// OpenWebPeekFullWindow 仅打开/刷新内容窗（默认桌面尺寸），并重新停靠工具条。
func (a *App) OpenWebPeekFullWindow(rawURL string) error {
	normalized, err := webpeek.NormalizeURL(rawURL)
	if err != nil {
		return fmt.Errorf("invalid url: %w", err)
	}
	setWebPeekLastURL(normalized)
	if err := a.openWebPeekContent(normalized, webPeekDesktopW, webPeekDesktopH); err != nil {
		return err
	}
	a.dockWebPeekToolbar()
	return nil
}

func (a *App) openWebPeekContent(normalized string, width, height int) error {
	app, err := webPeekApp(a)
	if err != nil {
		return err
	}
	title := truncateTitle("网页看看", normalized, 80)

	if win, exists := app.Window.GetByName(webPeekContentName); exists {
		win.SetTitle(title)
		win.SetURL(normalized)
		if width > 0 && height > 0 {
			win.SetSize(width, height)
			a.resetWebPeekToolbarAnchor()
		}
		win.Show()
		win.Focus()
		a.dockWebPeekToolbarSoon()
		log.Printf("[WebPeek] reuse content → %s (%dx%d)", normalized, width, height)
		return nil
	}

	win := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:             webPeekContentName,
		Title:            title,
		URL:              normalized,
		Width:            width,
		Height:           height,
		BackgroundColour: application.NewRGBA(255, 255, 255, 255),
		InitialPosition:  application.WindowCentered,
		DevToolsEnabled:  true,
		KeyBindings: map[string]func(window application.Window){
			"shift+ctrl+b": func(_ application.Window) {
				u := getWebPeekLastURL()
				if u == "" {
					return
				}
				if err := a.OpenBrowser(u); err != nil {
					log.Printf("[WebPeek] OpenBrowser shortcut failed: %v", err)
				}
			},
			"F12": func(w application.Window) {
				w.OpenDevTools()
			},
		},
	})
	if win == nil {
		return fmt.Errorf("创建内容窗口失败")
	}
	a.attachWebPeekContentSync(win)
	win.Show()
	log.Printf("[WebPeek] new content → %s (%dx%d)", normalized, width, height)
	return nil
}

func (a *App) attachWebPeekContentSync(win application.Window) {
	if webPeekContentSyncAttached {
		return
	}
	webPeekContentSyncAttached = true
	syncPos := func(_ *application.WindowEvent) {
		a.dockWebPeekToolbarSoon()
	}
	for _, et := range []events.WindowEventType{
		events.Common.WindowDidMove,
		events.Common.WindowDidResize,
		events.Mac.WindowDidMove,
		events.Mac.WindowDidResize,
		events.Windows.WindowDidMove,
		events.Windows.WindowDidResize,
	} {
		win.OnWindowEvent(et, syncPos)
	}
	// 内容窗回到前台：显示工具条（仅此时允许置顶，贴在内容上）
	win.OnWindowEvent(events.Common.WindowFocus, func(_ *application.WindowEvent) {
		a.cancelWebPeekToolbarHide()
		a.dockWebPeekToolbar()
	})
	// 失焦：若焦点不在工具条/内容窗（切到其它 App），隐藏且取消置顶
	win.OnWindowEvent(events.Common.WindowLostFocus, func(_ *application.WindowEvent) {
		a.scheduleWebPeekToolbarHideIfInactive()
	})
	win.OnWindowEvent(events.Common.WindowClosing, func(_ *application.WindowEvent) {
		webPeekContentSyncAttached = false
		a.cancelWebPeekToolbarHide()
		app, err := webPeekApp(a)
		if err != nil {
			return
		}
		if tb, ok := app.Window.GetByName(webPeekToolbarName); ok {
			tb.Close()
		}
	})
}

func (a *App) attachWebPeekToolbarFocus(win application.Window) {
	win.OnWindowEvent(events.Common.WindowFocus, func(_ *application.WindowEvent) {
		a.cancelWebPeekToolbarHide()
	})
	win.OnWindowEvent(events.Common.WindowLostFocus, func(_ *application.WindowEvent) {
		a.scheduleWebPeekToolbarHideIfInactive()
	})
}

func (a *App) cancelWebPeekToolbarHide() {
	webPeekToolbarFocusMu.Lock()
	defer webPeekToolbarFocusMu.Unlock()
	if webPeekToolbarFocusHideTimer != nil {
		webPeekToolbarFocusHideTimer.Stop()
		webPeekToolbarFocusHideTimer = nil
	}
}

func (a *App) scheduleWebPeekToolbarHideIfInactive() {
	webPeekToolbarFocusMu.Lock()
	defer webPeekToolbarFocusMu.Unlock()
	if webPeekToolbarFocusHideTimer != nil {
		webPeekToolbarFocusHideTimer.Stop()
	}
	webPeekToolbarFocusHideTimer = time.AfterFunc(100*time.Millisecond, func() {
		app, err := webPeekApp(a)
		if err != nil {
			return
		}
		content, hasC := app.Window.GetByName(webPeekContentName)
		toolbar, hasT := app.Window.GetByName(webPeekToolbarName)
		if !hasT {
			return
		}
		if hasC && content.IsFocused() {
			return
		}
		if toolbar.IsFocused() {
			return
		}
		// 焦点已到其它应用/窗口：隐藏，避免浮在别人 App 上
		toolbar.SetAlwaysOnTop(false)
		toolbar.Hide()
	})
}

func (a *App) openWebPeekToolbar(normalized string) error {
	app, err := webPeekApp(a)
	if err != nil {
		return err
	}
	shell := "/?page=web-peek-viewer&standalone=1&url=" + url.QueryEscape(normalized)

	if win, exists := app.Window.GetByName(webPeekToolbarName); exists {
		win.SetURL(shell)
		if c, ok := app.Window.GetByName(webPeekContentName); ok {
			c.Focus()
		}
		a.dockWebPeekToolbar()
		log.Printf("[WebPeek] reuse toolbar")
		return nil
	}

	win := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:             webPeekToolbarName,
		Title:            "网页看看 · 工具条",
		URL:              shell,
		Width:            webPeekToolbarCollapsedW,
		Height:           webPeekToolbarCollapsedH,
		MinWidth:         webPeekToolbarCollapsedW,
		MinHeight:        webPeekToolbarCollapsedH,
		MaxHeight:        webPeekToolbarExpandedH + 8,
		BackgroundType:   application.BackgroundTypeTransparent,
		BackgroundColour: application.NewRGBA(0, 0, 0, 0),
		Frameless:        true,
		DisableResize:    true,
		AlwaysOnTop:      false, // 仅在内容窗活跃时临时置顶，失焦即取消
		Hidden:           true,
		DevToolsEnabled:  true,
	})
	if win == nil {
		return fmt.Errorf("创建工具条窗口失败")
	}
	a.attachWebPeekToolbarFocus(win)
	webPeekToolbarCollapsed = true
	if c, ok := app.Window.GetByName(webPeekContentName); ok {
		c.Focus()
	}
	a.dockWebPeekToolbar()
	log.Printf("[WebPeek] new floating toolbar")
	return nil
}

// webPeekToolbarSize 当前收起/展开尺寸（展开条宽随内容窗变窄而收缩）。
func webPeekToolbarSize(contentW int) (tw, th int) {
	inset := webPeekToolbarInset
	if webPeekToolbarCollapsed {
		return webPeekToolbarCollapsedW, webPeekToolbarCollapsedH
	}
	th = webPeekToolbarExpandedH
	maxW := contentW - inset*2
	if maxW < webPeekToolbarCollapsedW {
		maxW = contentW
	}
	tw = webPeekToolbarExpandedW
	if tw > maxW {
		tw = maxW
	}
	if tw < 280 {
		tw = 280
		if tw > contentW {
			tw = contentW
		}
	}
	return tw, th
}

// webPeekTopRightAnchor 内容窗右上角锚点（屏幕相对坐标，Y=0 在屏顶）。
// 必须用 RelativePosition：macOS 上 Position/Bounds 的 Y 与 SetPosition 坐标系不一致。
func webPeekTopRightAnchor(content application.Window, tw, th int) (x, y int) {
	cx, cy := content.RelativePosition()
	cw, _ := content.Size()
	chrome := webPeekContentChromeOffset()
	inset := webPeekToolbarInset
	x = cx + cw - tw - inset
	y = cy + chrome + inset
	if x < cx {
		x = cx
	}
	if y < cy {
		y = cy
	}
	_ = th
	return x, y
}

func clampWebPeekToolbarPos(content application.Window, tw, th, x, y int) (int, int) {
	cx, cy := content.RelativePosition()
	cw, ch := content.Size()
	minX, minY := cx, cy
	maxX := cx + cw - tw
	maxY := cy + ch - th
	if maxX < minX {
		maxX = minX
	}
	if maxY < minY {
		maxY = minY
	}
	if x < minX {
		x = minX
	}
	if x > maxX {
		x = maxX
	}
	if y < minY {
		y = minY
	}
	if y > maxY {
		y = maxY
	}
	return x, y
}

// dockWebPeekToolbar 贴内容窗右上角（+ 可选拖拽偏移）。PC/移动端同一套 RelativePosition。
func (a *App) dockWebPeekToolbar() {
	app, err := webPeekApp(a)
	if err != nil {
		return
	}
	content, ok := app.Window.GetByName(webPeekContentName)
	if !ok {
		return
	}
	toolbar, ok := app.Window.GetByName(webPeekToolbarName)
	if !ok {
		return
	}

	if !content.IsFocused() && !toolbar.IsFocused() {
		toolbar.SetAlwaysOnTop(false)
		toolbar.Hide()
		return
	}

	cw, _ := content.Size()
	tw, th := webPeekToolbarSize(cw)
	ax, ay := webPeekTopRightAnchor(content, tw, th)
	x, y := ax, ay
	if webPeekToolbarUserPlaced {
		x = ax + webPeekToolbarOffX
		y = ay + webPeekToolbarOffY
	}
	x, y = clampWebPeekToolbarPos(content, tw, th, x, y)

	toolbar.SetSize(tw, th)
	toolbar.SetRelativePosition(x, y)
	toolbar.SetAlwaysOnTop(true)
	toolbar.Show()
}

// dockWebPeekToolbarSoon 尺寸刚变时 Size 可能滞后，延迟再贴右上角。
func (a *App) dockWebPeekToolbarSoon() {
	a.dockWebPeekToolbar()
	time.AfterFunc(50*time.Millisecond, func() {
		a.dockWebPeekToolbar()
	})
	time.AfterFunc(150*time.Millisecond, func() {
		a.dockWebPeekToolbar()
	})
	time.AfterFunc(350*time.Millisecond, func() {
		a.dockWebPeekToolbar()
	})
}

// resetWebPeekToolbarAnchor 切机型/改尺寸后回到右上角。
func (a *App) resetWebPeekToolbarAnchor() {
	webPeekToolbarUserPlaced = false
	webPeekToolbarOffX = 0
	webPeekToolbarOffY = 0
}

// MoveWebPeekToolbarBy 小圆钮拖动：相对位移（屏幕像素），并记为用户放置。
func (a *App) MoveWebPeekToolbarBy(dx, dy int) error {
	app, err := webPeekApp(a)
	if err != nil {
		return err
	}
	content, ok := app.Window.GetByName(webPeekContentName)
	if !ok {
		return fmt.Errorf("内容窗口未打开")
	}
	toolbar, ok := app.Window.GetByName(webPeekToolbarName)
	if !ok {
		return fmt.Errorf("工具条未打开")
	}
	cw, _ := content.Size()
	tw, th := webPeekToolbarSize(cw)
	ax, ay := webPeekTopRightAnchor(content, tw, th)
	tx, ty := toolbar.RelativePosition()
	nx, ny := clampWebPeekToolbarPos(content, tw, th, tx+dx, ty+dy)
	webPeekToolbarUserPlaced = true
	webPeekToolbarOffX = nx - ax
	webPeekToolbarOffY = ny - ay
	toolbar.SetRelativePosition(nx, ny)
	toolbar.SetAlwaysOnTop(true)
	toolbar.Show()
	return nil
}

// SetWebPeekToolbarCollapsed 收缩/展开悬浮工具条。
func (a *App) SetWebPeekToolbarCollapsed(collapsed bool) error {
	webPeekToolbarCollapsed = collapsed
	a.dockWebPeekToolbar()
	return nil
}

// IsWebPeekToolbarCollapsed 工具条是否收缩。
func (a *App) IsWebPeekToolbarCollapsed() bool {
	return webPeekToolbarCollapsed
}

// SetWebPeekContentSize 调整内容窗尺寸（桌面传 width/height<=0 则恢复 1280×900）。
func (a *App) SetWebPeekContentSize(width, height int) error {
	app, err := webPeekApp(a)
	if err != nil {
		return err
	}
	w, h := width, height
	if w <= 0 || h <= 0 {
		w, h = webPeekDesktopW, webPeekDesktopH
	}
	win, exists := app.Window.GetByName(webPeekContentName)
	if !exists {
		u := getWebPeekLastURL()
		if u == "" {
			return fmt.Errorf("内容窗口未打开")
		}
		if err := a.openWebPeekContent(u, w, h); err != nil {
			return err
		}
		a.dockWebPeekToolbar()
		return nil
	}
	win.SetSize(w, h)
	win.Show()
	win.Focus()
	a.resetWebPeekToolbarAnchor() // 切 PC/移动端尺寸：强制回右上角
	a.dockWebPeekToolbarSoon()
	return nil
}

// OpenWebPeekDevTools 打开内容窗 Web Inspector。
func (a *App) OpenWebPeekDevTools() error {
	app, err := webPeekApp(a)
	if err != nil {
		return err
	}
	if win, exists := app.Window.GetByName(webPeekContentName); exists {
		win.OpenDevTools()
		win.Focus()
		return nil
	}
	return fmt.Errorf("网页看看窗口未打开")
}

// FocusWebPeekContent 聚焦内容窗。
func (a *App) FocusWebPeekContent() error {
	app, err := webPeekApp(a)
	if err != nil {
		return err
	}
	win, exists := app.Window.GetByName(webPeekContentName)
	if !exists {
		return fmt.Errorf("内容窗口未打开")
	}
	win.Show()
	win.Focus()
	a.dockWebPeekToolbar()
	return nil
}
