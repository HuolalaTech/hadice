package main

import (
	"embed"

	"Hadice/backend"
)

// Embed frontend assets (built by `npm run build` in frontend/)
// Wails v3 will serve these assets to the webview
//
//go:embed all:frontend/dist
var assets embed.FS

func main() {
	// Platform-specific binaries (hdc, restool, uitest, etc.) are now placed
	// in the app bundle's Resources/bin directory by the build system.
	// backend/hdc/path.go automatically locates them at runtime.
	err := backend.Run(assets)
	if err != nil {
		println("Error:", err.Error())
	}
}
