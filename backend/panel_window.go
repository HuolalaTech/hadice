package backend

import (
	"fmt"
	"net/url"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// ponytail: 主窗/独立窗 WebView 不共享前端 store；选中设备真相放后端。
var (
	selectedConnectKeyMu sync.RWMutex
	selectedConnectKey   string
)

func getSelectedConnectKey() string {
	selectedConnectKeyMu.RLock()
	defer selectedConnectKeyMu.RUnlock()
	return selectedConnectKey
}

func setSelectedConnectKeyLocked(key string) {
	selectedConnectKeyMu.Lock()
	selectedConnectKey = key
	selectedConnectKeyMu.Unlock()
}

// SetSelectedConnectKey 由主窗选择设备时写入；独立窗打开时读入 URL。
func (a *App) SetSelectedConnectKey(key string) {
	setSelectedConnectKeyLocked(key)
	if key == "" {
		return
	}
	if app := application.Get(); app != nil {
		app.Event.Emit("device-selected", key)
	}
}

// GetSelectedConnectKey 返回当前跨窗共享的选中设备 connectKey。
func (a *App) GetSelectedConnectKey() string {
	return getSelectedConnectKey()
}

// panelWindowURL 构建独立面板 WebView 入口；deviceKey 非空时写入，供前端继承主窗选中设备。
func panelWindowURL(menuId, deviceKey string) string {
	q := url.Values{}
	q.Set("page", menuId)
	q.Set("standalone", "1")
	if deviceKey != "" {
		q.Set("device", deviceKey)
	}
	return "/?" + q.Encode()
}

// openPanelWindowInternal 创建或聚焦独立窗；deviceKey 直接写入 URL（不依赖先前 Set 是否成功）。
func (a *App) openPanelWindowInternal(menuId, title, deviceKey string) (bool, error) {
	app := a.app
	if app == nil {
		app = application.Get()
	}
	if app == nil {
		return false, fmt.Errorf("application instance not available")
	}
	name := panelWindowPrefix + menuId
	if deviceKey != "" {
		setSelectedConnectKeyLocked(deviceKey)
	}
	if win, exists := app.Window.GetByName(name); exists {
		win.Focus()
		if deviceKey != "" {
			app.Event.Emit("device-selected", deviceKey)
		}
		return true, nil
	}
	winURL := panelWindowURL(menuId, deviceKey)
	win := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:              name,
		Title:             title,
		URL:               winURL,
		Width:             1200,
		Height:            800,
		BackgroundColour: application.NewRGBA(27, 38, 54, 255),
		InitialPosition:  application.WindowCentered,
		EnableFileDrop:   true,
	})
	win.OnWindowEvent(events.Common.WindowFilesDropped, func(event *application.WindowEvent) {
		if files := event.Context().DroppedFiles(); len(files) > 0 {
			application.Get().Event.Emit("files-dropped", map[string]any{"files": files})
		}
	})
	for _, et := range []events.WindowEventType{events.Mac.WindowFileDraggingEntered, events.Windows.WindowDragEnter} {
		win.OnWindowEvent(et, func(_ *application.WindowEvent) { application.Get().Event.Emit("file-drag-enter", nil) })
	}
	for _, et := range []events.WindowEventType{events.Mac.WindowFileDraggingExited, events.Windows.WindowDragLeave} {
		win.OnWindowEvent(et, func(_ *application.WindowEvent) { application.Get().Event.Emit("file-drag-exit", nil) })
	}
	win.OnWindowEvent(events.Common.WindowClosing, func(_ *application.WindowEvent) {
		notifyPanelReturnedToMain(menuId)
	})
	win.Show()
	return true, nil
}

// OpenPanelWindowWithDevice 打开独立窗并强制继承 deviceKey（写入 URL + 后端）。
// 单独方法名，避免改 OpenPanelWindow 参数个数导致热更 arity 炸窗。
func (a *App) OpenPanelWindowWithDevice(menuId, title, deviceKey string) (bool, error) {
	return a.openPanelWindowInternal(menuId, title, deviceKey)
}
