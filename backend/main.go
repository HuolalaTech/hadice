package backend

import (
	"embed"
	"fmt"
	"log"
	"runtime"

	applogger "Hadice/backend/logger"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// Run starts the Wails v3 application
// Platform-specific binaries are located by hdc/path.go at runtime
func Run(assets embed.FS) error {
	// Initialize logger system
	if err := applogger.InitLogger(""); err != nil {
		log.Printf("[Backend] Warning: logger initialization failed: %v", err)
		log.Println("[Backend] Using standard log output")
	} else {
		defer func() {
			if err := applogger.Sync(); err != nil {
				// Ignore sync errors (stdout may be closed)
			}
		}()
	}

	// Load private CI env (.env.ci) before any feature that needs keys/URLs
	LoadCIEnv()
	InitPosthog()
	defer FlushPosthog()

	// 根据平台设置窗口大小
	var windowWidth, windowHeight int
	if runtime.GOOS == "windows" {
		windowWidth = 1320
		windowHeight = 800
	} else {
		windowWidth = 1518
		windowHeight = 962
	}

	// Create application
	app := application.New(application.Options{
		Name:        "Hadice",
		Description: "Hadice - 安卓&鸿蒙调试工具",
		LogLevel:    4,
		Services: []application.Service{
			application.NewService(NewAppService(nil)),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
		Windows: application.WindowsOptions{
			DisableQuitOnLastWindowClosed: false,
		},
		Linux: application.LinuxOptions{
			DisableQuitOnLastWindowClosed: false,
		},
	})

	// Create main window
	mainWindow := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:            "Hadice",
		Width:            windowWidth,
		Height:           windowHeight,
		BackgroundColour: application.NewRGBA(27, 38, 54, 255),
		// 启用文件拖放功能，允许从操作系统拖拽文件到窗口
		EnableDragAndDrop: true,
	})

	if mainWindow == nil {
		return fmt.Errorf("failed to create main window")
	}

	// 点击关闭按钮时直接退出整个程序
	mainWindow.OnWindowEvent(events.Common.WindowClosing, func(event *application.WindowEvent) {
		log.Println("[Main] Window closing, quitting application")
		app.Quit()
	})

	// 监听文件拖放事件，将拖放的文件路径转发给前端
	// 使用 data-wails-dropzone 时触发的是 WindowDropZoneFilesDropped（非 WindowFilesDropped）
	mainWindow.OnWindowEvent(events.Common.WindowDropZoneFilesDropped, func(event *application.WindowEvent) {
		files := event.Context().DroppedFiles()
		if len(files) > 0 {
			log.Printf("[Main] Files dropped on zone: %v", files)
			application.Get().Event.Emit("files-dropped", map[string]any{
				"files": files,
			})
		}
	})

	// Run application
	return app.Run()
}
