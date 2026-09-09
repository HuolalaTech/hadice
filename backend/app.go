package backend

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"Hadice/backend/adb"
	"Hadice/backend/android"
	"Hadice/backend/device"
	"Hadice/backend/hdc"
	"Hadice/backend/hiprofiler"
	applogger "Hadice/backend/logger"

	"github.com/samber/lo"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// compareVersion 比较版本号
// 返回值: >0 表示 v1 > v2, =0 表示 v1 = v2, <0 表示 v1 < v2
func compareVersion(v1, v2 string) int {
	parts1 := strings.Split(v1, ".")
	parts2 := strings.Split(v2, ".")

	maxLen := len(parts1)
	if len(parts2) > maxLen {
		maxLen = len(parts2)
	}

	for i := 0; i < maxLen; i++ {
		var num1, num2 int
		if i < len(parts1) {
			num1, _ = strconv.Atoi(parts1[i])
		}
		if i < len(parts2) {
			num2, _ = strconv.Atoi(parts2[i])
		}

		if num1 > num2 {
			return 1
		} else if num1 < num2 {
			return -1
		}
	}

	return 0
}

// AppService 是 v3 中的服务，提供所有应用功能
type AppService struct {
	ctx context.Context
	app *application.App
}

// NewAppService 创建新的应用服务实例
func NewAppService(app *application.App) *AppService {
	return &AppService{
		app: app,
	}
}

// ServiceStartup 是 Wails v3 的生命周期方法，在应用启动时调用
func (a *AppService) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	a.ctx = ctx

	// 获取应用实例引用
	app := application.Get()
	if app != nil {
		a.app = app
	}

	for _, subdir := range []string{"network", "screenshot", "performance"} {
		if _, err := getHadiceOutputDirectory(subdir); err != nil {
			return err
		}
	}

	if applogger.Sugar != nil {
		applogger.Sugar.Info("[Backend] Application service started")
	} else {
		log.Println("[Backend] Application service started")
	}

	return nil
}

// ServiceShutdown 是 Wails v3 的生命周期方法，在应用关闭时调用
func (a *AppService) ServiceShutdown() error {
	if applogger.Sugar != nil {
		applogger.Sugar.Info("[Backend] Application service shutting down")
	}
	hiprofiler.StopAllCaptures("")
	return nil
}

// ============ 下面保持兼容性，使用 AppService 的别名 ============
// 为了保持现有代码的兼容性，使用类型别名
type App = AppService

// NewApp 创建新的应用实例（兼容旧代码）
func NewApp() *App {
	return NewAppService(nil)
}

// ============ 辅助函数 ============

// Greet returns a greeting for the given name
func (a *App) Greet(name string) string {
	return fmt.Sprintf("Hello %s, It's show time!", name)
}

// GetAppVersion returns the current application version
func (a *App) GetAppVersion() string {
	return generatedAppVersion
}

// =============== 多窗口管理相关方法 ===============

const panelWindowPrefix = "panel-"

// OpenPanelWindow 在独立窗口中打开指定菜单页
// menuId: 菜单 ID（如 device-overview）
// title: 窗口标题
// 若该菜单的独立窗口已存在，则聚焦显示；否则创建新窗口
func (a *App) OpenPanelWindow(menuId string, title string) (bool, error) {
	app := a.app
	if app == nil {
		app = application.Get()
	}
	if app == nil {
		return false, fmt.Errorf("application instance not available")
	}
	name := panelWindowPrefix + menuId
	if win, exists := app.Window.GetByName(name); exists {
		win.Focus()
		return true, nil
	}
	url := "/?page=" + menuId + "&standalone=1"
	_ = app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:             name,
		Title:            title,
		URL:              url,
		Width:            1200,
		Height:           800,
		BackgroundColour: application.NewRGBA(27, 38, 54, 255),
		InitialPosition:  application.WindowCentered,
	}).Show()
	return true, nil
}

// ClosePanelWindow 关闭指定菜单的独立窗口
// 若窗口存在则关闭并返回 true，否则返回 false
func (a *App) ClosePanelWindow(menuId string) (bool, error) {
	app := a.app
	if app == nil {
		app = application.Get()
	}
	if app == nil {
		return false, fmt.Errorf("application instance not available")
	}
	name := panelWindowPrefix + menuId
	if win, exists := app.Window.GetByName(name); exists {
		win.Close()
		return true, nil
	}
	return false, nil
}

// IsPanelWindowOpen 判断指定菜单的独立窗口是否已打开
func (a *App) IsPanelWindowOpen(menuId string) bool {
	app := a.app
	if app == nil {
		app = application.Get()
	}
	if app == nil {
		return false
	}
	name := panelWindowPrefix + menuId
	_, exists := app.Window.GetByName(name)
	return exists
}

// =============== 应用管理相关方法 ===============

// GetAppList 获取应用列表
// incremental: 是否使用渐进式加载（先返回基本列表，然后通过事件推送详情）
func (a *App) GetAppList(connectKey string, filter string, incremental bool) (*hdc.AppListResult, error) {
	result, err := hdc.GetAppListIncremental(a.ctx, connectKey, filter)
	return result, err
}

// StartApp 启动应用
func (a *App) StartApp(connectKey string, packageName string) (*hdc.HdcResult, error) {
	result, err := hdc.StartApp(connectKey, packageName)
	return result, err
}

// StopApp 停止应用
func (a *App) StopApp(connectKey string, packageName string) (*hdc.HdcResult, error) {
	result, err := hdc.StopApp(connectKey, packageName)
	return result, err
}

// ClearAppData 清除应用数据
func (a *App) ClearAppData(connectKey string, packageName string) (*hdc.HdcResult, error) {
	return hdc.ClearAppData(connectKey, packageName)
}

// ClearAppCache 清除应用缓存
func (a *App) ClearAppCache(connectKey string, packageName string) (*hdc.HdcResult, error) {
	if isAndroidDevice(connectKey) {
		err := adb.ClearAppCache(connectKey, packageName)
		if err != nil {
			return &hdc.HdcResult{Success: false, Error: err.Error()}, err
		}
		return &hdc.HdcResult{Success: true, Output: "清除缓存成功"}, nil
	}
	return hdc.ClearAppCache(connectKey, packageName)
}

// UninstallApp 卸载应用
func (a *App) UninstallApp(connectKey string, packageName string) (*hdc.HdcResult, error) {
	return hdc.UninstallApp(connectKey, packageName)
}

// =============== 应用管理（支持平台判断）===============

// GetAppListByPlatform 根据平台获取应用列表
func (a *App) GetAppListByPlatform(connectKey string, filter string, incremental bool, platform string) (*hdc.AppListResult, error) {
	if platform == string(device.PlatformAndroid) {
		if incremental {
			return a.getAdbAppListIncremental(connectKey, filter)
		}
		result, err := adb.GetAppList(connectKey, filter)
		if err != nil {
			return nil, err
		}
		return convertAdbAppResult(result), nil
	}

	if incremental {
		return hdc.GetAppListIncremental(a.ctx, connectKey, filter)
	}
	return hdc.GetAppList(connectKey, filter)
}

func (a *App) getAdbAppListIncremental(connectKey string, filter string) (*hdc.AppListResult, error) {
	result, err := adb.GetAppList(connectKey, filter)
	if err != nil {
		return nil, err
	}

	converted := convertAdbAppResult(result)

	if a.ctx != nil {
		app := application.Get()
		if app != nil {
			app.Event.Emit("app-list-basic", map[string]interface{}{
				"apps":  converted.Apps,
				"stats": converted.Stats,
			})
		}
	}

	go func() {
		runningPackages, _ := adb.GetRunningPackages(connectKey)
		for i := range converted.Apps {
			if _, running := runningPackages[converted.Apps[i].PackageName]; running {
				converted.Apps[i].IsRunning = true
			}
		}

		if a.ctx != nil {
			app := application.Get()
			if app != nil {
				app.Event.Emit("app-list-complete", map[string]interface{}{})
			}
		}
	}()

	return converted, nil
}

func convertAdbAppResult(result *adb.AppListResult) *hdc.AppListResult {
	apps := make([]hdc.AppInfo, len(result.Apps))
	for i, app := range result.Apps {
		apps[i] = hdc.AppInfo{
			PackageName: app.PackageName,
			AppName:     app.AppName,
			Version:     app.Version,
			VersionCode: app.VersionCode,
			Size:        app.Size,
			Icon:        app.Icon,
			IsSystemApp: app.IsSystemApp,
			IsRunning:   app.IsRunning,
			IsEnabled:   app.IsEnabled,
			InstallTime: app.InstallTime,
		}
	}
	return &hdc.AppListResult{
		Stats: hdc.AppStats{
			Total:      result.Stats.Total,
			System:     result.Stats.System,
			ThirdParty: result.Stats.ThirdParty,
			Running:    result.Stats.Running,
		},
		Apps: apps,
	}
}

// StartAppByPlatform 根据平台启动应用
func (a *App) StartAppByPlatform(connectKey string, packageName string, platform string) (*hdc.HdcResult, error) {
	if platform == string(device.PlatformAndroid) {
		result, err := adb.StartApp(connectKey, packageName)
		if err != nil {
			return nil, err
		}
		return &hdc.HdcResult{
			Success: result.Success,
			Output:  result.Output,
			Error:   result.Error,
		}, nil
	}
	return hdc.StartApp(connectKey, packageName)
}

// StopAppByPlatform 根据平台停止应用
func (a *App) StopAppByPlatform(connectKey string, packageName string, platform string) (*hdc.HdcResult, error) {
	if platform == string(device.PlatformAndroid) {
		result, err := adb.StopApp(connectKey, packageName)
		if err != nil {
			return nil, err
		}
		return &hdc.HdcResult{
			Success: result.Success,
			Output:  result.Output,
			Error:   result.Error,
		}, nil
	}
	return hdc.StopApp(connectKey, packageName)
}

// ClearAppDataByPlatform 根据平台清除应用数据
func (a *App) ClearAppDataByPlatform(connectKey string, packageName string, platform string) (*hdc.HdcResult, error) {
	if platform == string(device.PlatformAndroid) {
		result, err := adb.ClearAppData(connectKey, packageName)
		if err != nil {
			return nil, err
		}
		return &hdc.HdcResult{
			Success: result.Success,
			Output:  result.Output,
			Error:   result.Error,
		}, nil
	}
	return hdc.ClearAppData(connectKey, packageName)
}

// UninstallAppByPlatform 根据平台卸载应用
func (a *App) UninstallAppByPlatform(connectKey string, packageName string, platform string) (*hdc.HdcResult, error) {
	if platform == string(device.PlatformAndroid) {
		result, err := adb.UninstallApp(connectKey, packageName)
		if err != nil {
			return nil, err
		}
		return &hdc.HdcResult{
			Success: result.Success,
			Output:  result.Output,
			Error:   result.Error,
		}, nil
	}
	return hdc.UninstallApp(connectKey, packageName)
}

// GetOnlineAppInfo 从华为应用市场获取应用信息（名称和图标）
func (a *App) GetOnlineAppInfo(packageName string) (*hdc.OnlineAppInfo, error) {
	return hdc.GetOnlineAppInfo(packageName)
}

// GetCachedAppList 获取磁盘缓存的应用列表
func (a *App) GetCachedAppList() (map[string]interface{}, error) {
	result, err := hdc.GetCachedAppList()
	if err != nil {
		return nil, err
	}
	if result == nil {
		return map[string]interface{}{
			"apps":  []hdc.AppInfo{},
			"stats": hdc.AppStats{},
		}, nil
	}
	return map[string]interface{}{
		"apps":  result.Apps,
		"stats": result.Stats,
	}, nil
}

// GetCachedAppIcon 获取磁盘缓存的应用图标（base64格式）
func (a *App) GetCachedAppIcon(packageName string) (string, error) {
	return hdc.ReadIconAsBase64(packageName)
}

// ClearAppDiskCache 清除应用磁盘缓存
func (a *App) ClearAppDiskCache() (map[string]interface{}, error) {
	err := hdc.ClearDiskCache()
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		}, err
	}
	return map[string]interface{}{
		"success": true,
	}, nil
}

// =============== 应用安装相关方法 ===============

// SelectHapFile 选择安装包文件
// connectKey: 设备连接标识，用于判断设备平台
func (a *App) SelectHapFile(connectKey string) (string, error) {
	if a.app == nil {
		return "", fmt.Errorf("应用实例不可用")
	}

	dialog := a.app.Dialog.OpenFile().SetTitle("选择安装包")

	platform := deviceManager.GetDevicePlatform(connectKey)
	if platform == device.PlatformAndroid {
		dialog = dialog.AddFilter("安装包", "*.apk").AddFilter("所有文件", "*.*")
	} else {
		dialog = dialog.AddFilter("安装包", "*.hap;*.hsp;*.har;*.zip;*.gz;*.7z;*.tar;*.tgz").AddFilter("所有文件", "*.*")
	}

	selectedPath, err := dialog.PromptForSingleSelection()
	if err != nil {
		return "", err
	}

	return selectedPath, nil
}

// detectFileFormat 检测文件格式
func detectFileFormat(filePath string) (string, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return "", err
	}
	defer file.Close()

	// 读取前4个字节来检测文件格式
	header := make([]byte, 4)
	n, err := file.Read(header)
	if err != nil && n != 4 {
		return "", fmt.Errorf("读取文件头失败: %v", err)
	}

	// ZIP格式: PK\x03\x04
	if len(header) >= 4 && header[0] == 0x50 && header[1] == 0x4B && header[2] == 0x03 && header[3] == 0x04 {
		return "zip", nil
	}

	// GZIP格式: \x1f\x8b
	if len(header) >= 2 && header[0] == 0x1F && header[1] == 0x8B {
		return "gzip", nil
	}

	return "unknown", nil
}

// extractGzip 解压GZIP文件到临时目录（支持嵌套的TAR文件）
func extractGzip(gzipPath string) (string, error) {
	// 清空临时目录
	if err := clearZipTempDir(); err != nil {
		return "", fmt.Errorf("清空临时目录失败: %v", err)
	}

	userDataDir, err := getUserDataDir()
	if err != nil {
		return "", err
	}

	tempDir := filepath.Join(userDataDir, "zip")

	// 检查文件是否存在
	if _, err := os.Stat(gzipPath); os.IsNotExist(err) {
		return "", fmt.Errorf("GZIP文件不存在: %s", gzipPath)
	}

	// 打开GZIP文件
	gzipFile, err := os.Open(gzipPath)
	if err != nil {
		return "", fmt.Errorf("打开GZIP文件失败: %v", err)
	}
	defer gzipFile.Close()

	// 创建gzip reader
	gzipReader, err := gzip.NewReader(gzipFile)
	if err != nil {
		return "", fmt.Errorf("创建GZIP读取器失败: %v", err)
	}
	defer gzipReader.Close()

	// 创建TAR reader来处理嵌套的TAR文件
	tarReader := tar.NewReader(gzipReader)

	// 解压TAR文件中的所有文件
	for {
		header, err := tarReader.Next()
		if err == io.EOF {
			break // 读取完毕
		}
		if err != nil {
			return "", fmt.Errorf("读取TAR文件失败: %v", err)
		}

		// 构建目标路径
		targetPath := filepath.Join(tempDir, header.Name)

		// 防止目录遍历攻击
		if !strings.HasPrefix(targetPath, tempDir+string(os.PathSeparator)) {
			continue
		}

		// 根据文件类型处理
		switch header.Typeflag {
		case tar.TypeDir:
			// 创建目录
			if err := os.MkdirAll(targetPath, os.FileMode(header.Mode)); err != nil {
				return "", fmt.Errorf("创建目录失败 %s: %v", targetPath, err)
			}
		case tar.TypeReg:
			// 创建父目录
			if err := os.MkdirAll(filepath.Dir(targetPath), 0755); err != nil {
				return "", fmt.Errorf("创建父目录失败 %s: %v", filepath.Dir(targetPath), err)
			}

			// 创建文件
			file, err := os.OpenFile(targetPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, os.FileMode(header.Mode))
			if err != nil {
				return "", fmt.Errorf("创建文件失败 %s: %v", targetPath, err)
			}

			// 复制文件内容
			if _, err := io.Copy(file, tarReader); err != nil {
				file.Close()
				return "", fmt.Errorf("复制文件内容失败 %s: %v", targetPath, err)
			}
			file.Close()
		}
	}

	return tempDir, nil
}

// getUserDataDir 获取用户数据目录
func getUserDataDir() (string, error) {
	var userDataDir string
	switch runtime.GOOS {
	case "darwin":
		homeDir, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("获取用户主目录失败: %v", err)
		}
		userDataDir = filepath.Join(homeDir, "Library", "Application Support", "Hadice")
	case "windows":
		appData := os.Getenv("APPDATA")
		if appData == "" {
			return "", fmt.Errorf("无法获取APPDATA环境变量")
		}
		userDataDir = filepath.Join(appData, "Hadice")
	default:
		return "", fmt.Errorf("不支持的操作系统: %s", runtime.GOOS)
	}

	// 确保目录存在
	if err := os.MkdirAll(userDataDir, 0755); err != nil {
		return "", fmt.Errorf("创建用户数据目录失败: %v", err)
	}

	return userDataDir, nil
}

// clearZipTempDir 清空ZIP临时解压目录
func clearZipTempDir() error {
	userDataDir, err := getUserDataDir()
	if err != nil {
		return err
	}

	zipTempDir := filepath.Join(userDataDir, "zip")

	// 如果目录不存在，直接返回
	if _, err := os.Stat(zipTempDir); os.IsNotExist(err) {
		return nil
	}

	// 删除目录及其内容
	if err := os.RemoveAll(zipTempDir); err != nil {
		return fmt.Errorf("清空ZIP临时目录失败: %v", err)
	}

	// 重新创建空目录
	if err := os.MkdirAll(zipTempDir, 0755); err != nil {
		return fmt.Errorf("创建ZIP临时目录失败: %v", err)
	}

	return nil
}

// extractArchive 解压压缩文件到临时目录（支持ZIP和GZIP）
func extractArchive(filePath string, format string) (string, error) {
	switch format {
	case "zip":
		return extractZip(filePath)
	case "gzip":
		return extractGzip(filePath)
	default:
		return "", fmt.Errorf("不支持的压缩格式: %s", format)
	}
}

// extractZip 解压ZIP文件到临时目录
func extractZip(zipPath string) (string, error) {
	// 清空临时目录
	if err := clearZipTempDir(); err != nil {
		return "", fmt.Errorf("清空临时目录失败: %v", err)
	}

	userDataDir, err := getUserDataDir()
	if err != nil {
		return "", err
	}

	zipTempDir := filepath.Join(userDataDir, "zip")

	// 检查文件是否存在
	if _, err := os.Stat(zipPath); os.IsNotExist(err) {
		return "", fmt.Errorf("ZIP文件不存在: %s", zipPath)
	}

	// 打开ZIP文件
	zipReader, err := zip.OpenReader(zipPath)
	if err != nil {
		return "", fmt.Errorf("打开ZIP文件失败: %v", err)
	}
	defer zipReader.Close()

	// 解压所有文件
	for _, file := range zipReader.File {
		// 构建目标路径
		targetPath := filepath.Join(zipTempDir, file.Name)

		// 防止目录遍历攻击
		if !strings.HasPrefix(targetPath, zipTempDir+string(os.PathSeparator)) {
			continue
		}

		// 如果是目录，创建它
		if file.FileInfo().IsDir() {
			if err := os.MkdirAll(targetPath, file.Mode()); err != nil {
				return "", fmt.Errorf("创建目录失败 %s: %v", targetPath, err)
			}
			continue
		}

		// 创建父目录
		if err := os.MkdirAll(filepath.Dir(targetPath), 0755); err != nil {
			return "", fmt.Errorf("创建父目录失败 %s: %v", filepath.Dir(targetPath), err)
		}

		// 解压文件
		destFile, err := os.OpenFile(targetPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, file.Mode())
		if err != nil {
			return "", fmt.Errorf("创建目标文件失败 %s: %v", targetPath, err)
		}

		srcFile, err := file.Open()
		if err != nil {
			destFile.Close()
			return "", fmt.Errorf("打开ZIP内文件失败 %s: %v", file.Name, err)
		}

		if _, err := io.Copy(destFile, srcFile); err != nil {
			srcFile.Close()
			destFile.Close()
			return "", fmt.Errorf("复制文件内容失败 %s: %v", file.Name, err)
		}

		srcFile.Close()
		destFile.Close()
	}

	return zipTempDir, nil
}

// findHapFile 在目录中查找第一个有效的.hap文件（过滤macOS隐藏文件）
func findHapFile(dir string) (string, error) {
	var hapFiles []string

	err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		if !info.IsDir() && strings.ToLower(filepath.Ext(path)) == ".hap" {
			// 过滤macOS的隐藏文件
			baseName := filepath.Base(path)
			if !strings.HasPrefix(baseName, "._") && !strings.Contains(path, "__MACOSX") {
				hapFiles = append(hapFiles, path)
			}
		}

		return nil
	})

	if err != nil {
		return "", fmt.Errorf("查找HAP文件失败: %v", err)
	}

	if len(hapFiles) == 0 {
		return "", fmt.Errorf("在解压文件中未找到有效的.hap文件")
	}

	// 返回第一个找到的有效HAP文件
	return hapFiles[0], nil
}

// ParseAppPackageInfo 解析安装包信息（支持 HAP/APK 格式）
func (a *App) ParseAppPackageInfo(filePath string) (*hdc.InstallPackageInfo, error) {
	fileExt := strings.ToLower(filepath.Ext(filePath))

	if fileExt == ".apk" {
		return adb.ParseApkAppInfo(filePath)
	}

	var hapFilePath string

	if fileExt == ".hap" {
		hapFilePath = filePath
	} else if fileExt == ".zip" || fileExt == ".gz" {
		format, err := detectFileFormat(filePath)
		if err != nil {
			return nil, fmt.Errorf("检测文件格式失败: %v", err)
		}

		extractedDir, err := extractArchive(filePath, format)
		if err != nil {
			if strings.Contains(err.Error(), "not a valid zip file") {
				return nil, fmt.Errorf("文件不是有效的压缩包，请检查文件是否损坏或选择正确的文件")
			}
			if strings.Contains(err.Error(), "gzip") && strings.Contains(err.Error(), "invalid") {
				return nil, fmt.Errorf("文件不是有效的GZIP压缩包，请检查文件是否损坏或选择正确的文件")
			}
			return nil, fmt.Errorf("解压文件失败: %v", err)
		}

		hapFilePath, err = findHapFile(extractedDir)
		if err != nil {
			return nil, fmt.Errorf("在压缩文件中未找到有效的HAP文件，请确保压缩包包含.hap格式的应用安装包")
		}
	} else {
		return nil, fmt.Errorf("不支持的文件格式，请选择 .apk、.hap、.zip 或 .gz 文件")
	}

	hapInfo, err := hdc.ParseHapAppInfo(hapFilePath)
	if err != nil {
		return nil, err
	}

	if fileExt == ".zip" || fileExt == ".gz" {
		hapInfo.ExtractedHapPath = hapFilePath
	}

	return hapInfo, nil
}

// ParseHapAppInfo 解析 HAP 应用信息（向后兼容）
// Deprecated: 使用 ParseAppPackageInfo 代替
func (a *App) ParseHapAppInfo(filePath string) (*hdc.HapAppInfo, error) {
	return a.ParseAppPackageInfo(filePath)
}

// InstallApp 安装应用，支持ZIP和GZIP压缩包
func (a *App) InstallApp(connectKey string, filePath string, replace bool, sharedBundle bool) (*hdc.HdcResult, error) {
	platform := deviceManager.GetDevicePlatform(connectKey)

	if platform == device.PlatformAndroid {
		result, err := adb.InstallApp(connectKey, filePath, replace)
		if err != nil {
			return &hdc.HdcResult{Success: false, Error: err.Error()}, err
		}
		return &hdc.HdcResult{
			Success: result.Success,
			Output:  result.Output,
			Error:   result.Error,
		}, nil
	}

	var installFilePath string

	fileExt := strings.ToLower(filepath.Ext(filePath))

	if fileExt == ".hap" {
		installFilePath = filePath
	} else if fileExt == ".zip" || fileExt == ".gz" {
		userDataDir, err := getUserDataDir()
		if err != nil {
			return &hdc.HdcResult{
				Success: false,
				Error:   fmt.Sprintf("获取用户数据目录失败: %v", err),
			}, err
		}

		tempDir := filepath.Join(userDataDir, "zip")

		hapFilePath, err := findHapFile(tempDir)
		if err != nil {
			format, err := detectFileFormat(filePath)
			if err != nil {
				return &hdc.HdcResult{
					Success: false,
					Error:   fmt.Sprintf("检测文件格式失败: %v", err),
				}, err
			}

			_, err = extractArchive(filePath, format)
			if err != nil {
				if strings.Contains(err.Error(), "not a valid zip file") {
					return &hdc.HdcResult{
						Success: false,
						Error:   "文件不是有效的压缩包，请检查文件是否损坏或选择正确的文件",
					}, err
				}
				if strings.Contains(err.Error(), "gzip") && strings.Contains(err.Error(), "invalid") {
					return &hdc.HdcResult{
						Success: false,
						Error:   "文件不是有效的GZIP压缩包，请检查文件是否损坏或选择正确的文件",
					}, err
				}
				return &hdc.HdcResult{
					Success: false,
					Error:   fmt.Sprintf("解压文件失败: %v", err),
				}, err
			}

			hapFilePath, err = findHapFile(tempDir)
			if err != nil {
				return &hdc.HdcResult{
					Success: false,
					Error:   "在压缩文件中未找到有效的HAP文件，请确保压缩包包含.hap格式的应用安装包",
				}, err
			}
		}
		installFilePath = hapFilePath
	} else {
		return &hdc.HdcResult{
			Success: false,
			Error:   "不支持的文件格式，请选择.hap、.zip或.gz文件",
		}, fmt.Errorf("不支持的文件格式")
	}

	return hdc.InstallApp(connectKey, installFilePath, replace, sharedBundle)
}

// GetFileInfo 获取文件信息
func (a *App) GetFileInfo(filePath string) (map[string]interface{}, error) {
	info, err := os.Stat(filePath)
	if err != nil {
		return NewErrorResponse(err), err
	}

	return NewSuccessResponse(map[string]interface{}{
		"size":         info.Size(),
		"modifiedTime": info.ModTime().UnixMilli(),
	}), nil
}

// =============== 截图录屏相关方法 ===============

// TakeScreenshot 截取设备屏幕截图
func (a *App) TakeScreenshot(connectKey string, savePath string, format string) (map[string]interface{}, error) {
	platform := deviceManager.GetDevicePlatform(connectKey)

	var info *hdc.ScreenshotInfo
	var err error

	if platform == device.PlatformAndroid {
		// Android: 使用 adb shell screencap
		androidInfo, androidErr := adb.TakeScreenshot(connectKey, savePath, format)
		if androidErr != nil {
			return NewErrorResponse(androidErr), androidErr
		}
		info = &hdc.ScreenshotInfo{
			LocalPath: androidInfo.LocalPath,
			FileName:  androidInfo.FileName,
			Timestamp: androidInfo.Timestamp,
			Width:     androidInfo.Width,
			Height:    androidInfo.Height,
			Size:      androidInfo.Size,
		}
	} else {
		// HarmonyOS: 使用 hdc snapshot_display
		info, err = hdc.TakeScreenshot(connectKey, savePath, format)
		if err != nil {
			return NewErrorResponse(err), err
		}
	}

	renamedPath, renamedFileName, renameErr := renameDeviceOutputFile(
		info.LocalPath,
		"screenshot",
		connectKey,
		time.UnixMilli(info.Timestamp),
	)
	if renameErr != nil {
		return NewErrorResponse(renameErr), renameErr
	}
	info.LocalPath = renamedPath
	info.FileName = renamedFileName

	return NewSuccessResponse(map[string]interface{}{
		"localPath": info.LocalPath,
		"fileName":  info.FileName,
		"timestamp": info.Timestamp,
		"width":     info.Width,
		"height":    info.Height,
		"size":      info.Size,
	}), nil
}

// GetScreenshotHistory 获取截图历史记录
func (a *App) GetScreenshotHistory(savePath string) ([]map[string]interface{}, error) {
	history, err := hdc.GetScreenshotHistory(savePath)
	if err != nil {
		return []map[string]interface{}{}, err
	}

	return lo.Map(history, func(item hdc.ScreenshotHistoryItem, _ int) map[string]interface{} {
		return map[string]interface{}{
			"localPath": item.LocalPath,
			"fileName":  item.FileName,
			"timestamp": item.Timestamp,
			"size":      item.Size,
		}
	}), nil
}

// DeleteScreenshot 删除截图文件
func (a *App) DeleteScreenshot(filePath string) (*hdc.HdcResult, error) {
	err := hdc.DeleteScreenshot(filePath)
	if err != nil {
		return &hdc.HdcResult{
			Success: false,
			Error:   err.Error(),
		}, err
	}
	return &hdc.HdcResult{Success: true, Output: "删除成功"}, nil
}

// ClearScreenshotHistory 清空截图历史
func (a *App) ClearScreenshotHistory(savePath string) (*hdc.HdcResult, error) {
	count, err := hdc.ClearScreenshotHistory(savePath)
	if err != nil {
		return &hdc.HdcResult{
			Success: false,
			Error:   err.Error(),
		}, err
	}
	return &hdc.HdcResult{
		Success: true,
		Output:  fmt.Sprintf("已删除 %d 个截图文件", count),
	}, nil
}

// OpenScreenshotFolder 在文件管理器中打开截图目录
func (a *App) OpenScreenshotFolder(savePath string) (*hdc.HdcResult, error) {
	err := hdc.OpenScreenshotFolder(a.ctx, savePath)
	if err != nil {
		return &hdc.HdcResult{
			Success: false,
			Error:   err.Error(),
		}, err
	}
	return &hdc.HdcResult{Success: true, Output: "已打开文件夹"}, nil
}

// OpenFolder 在文件管理器中打开指定文件夹
func (a *App) OpenFolder(folderPath string) (*hdc.HdcResult, error) {
	err := hdc.OpenScreenshotFolder(a.ctx, folderPath)
	if err != nil {
		return &hdc.HdcResult{
			Success: false,
			Error:   err.Error(),
		}, err
	}
	return &hdc.HdcResult{Success: true, Output: "已打开文件夹"}, nil
}

// OpenScreenshotFile 在文件管理器中打开截图文件并定位
func (a *App) OpenScreenshotFile(filePath string) (*hdc.HdcResult, error) {
	err := hdc.OpenScreenshotFile(a.ctx, filePath)
	if err != nil {
		return &hdc.HdcResult{
			Success: false,
			Error:   err.Error(),
		}, err
	}
	return &hdc.HdcResult{Success: true, Output: "已打开文件"}, nil
}

// GetDefaultScreenshotPath 获取默认截图路径
func (a *App) GetDefaultScreenshotPath() (string, error) {
	return hdc.GetDefaultScreenshotPath()
}

// ReadImageAsBase64 读取图片为 base64
func (a *App) ReadImageAsBase64(filePath string) (string, error) {
	return hdc.ReadImageAsBase64(filePath)
}

// ExtractVideoFirstFrame 提取视频第一帧并返回 base64 图片数据
func (a *App) ExtractVideoFirstFrame(videoPath string) (string, error) {
	return hdc.ExtractVideoFirstFrame(videoPath)
}

// CopyImageToClipboard 复制图片到剪贴板
func (a *App) CopyImageToClipboard(filePath string) (*hdc.HdcResult, error) {
	err := hdc.CopyImageToClipboard(a.ctx, filePath)
	if err != nil {
		return &hdc.HdcResult{
			Success: false,
			Error:   err.Error(),
		}, err
	}
	return &hdc.HdcResult{Success: true, Output: "已复制到剪贴板"}, nil
}

// CopyFilePathToClipboard 复制文件路径到剪贴板（Finder 风格）
func (a *App) CopyFilePathToClipboard(filePath string) (*hdc.HdcResult, error) {
	err := hdc.CopyFilePathToClipboard(filePath)
	if err != nil {
		return &hdc.HdcResult{
			Success: false,
			Error:   err.Error(),
		}, err
	}
	return &hdc.HdcResult{Success: true, Output: "已复制文件路径到剪贴板"}, nil
}

// SelectScreenshotPath 选择截图保存路径
func (a *App) SelectScreenshotPath() (string, error) {
	return hdc.SelectScreenshotPath(a.ctx)
}

// =============== 录屏相关方法 ===============

// isAndroidDevice 判断设备是否为 Android
func isAndroidDevice(connectKey string) bool {
	return deviceManager.GetDevicePlatform(connectKey) == device.PlatformAndroid
}

// StartScreenRecord 开始录屏
func (a *App) StartScreenRecord(connectKey string) (map[string]interface{}, error) {
	var fileName string
	var err error

	if isAndroidDevice(connectKey) {
		fileName, err = adb.StartScreenRecord(connectKey)
	} else {
		fileName, err = hdc.StartScreenRecord(connectKey)
	}

	if err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		}, err
	}

	return map[string]interface{}{
		"success":  true,
		"fileName": fileName,
	}, nil
}

// StopScreenRecord 停止录屏
func (a *App) StopScreenRecord(connectKey string) (*hdc.HdcResult, error) {
	var err error
	if isAndroidDevice(connectKey) {
		err = adb.StopScreenRecord(connectKey)
	} else {
		err = hdc.StopScreenRecord(connectKey)
	}
	if err != nil {
		return &hdc.HdcResult{
			Success: false,
			Error:   err.Error(),
		}, err
	}
	return &hdc.HdcResult{Success: true, Output: "停止录屏成功"}, nil
}

// QueryScreenRecordFile 不断查询录屏文件位置，直到找到文件
func (a *App) QueryScreenRecordFile(connectKey string, fileName string, maxWaitTime int, checkInterval int) (map[string]interface{}, error) {
	// Android: screenrecord 直接写文件到 /data/local/tmp/，无需查询
	if isAndroidDevice(connectKey) {
		return map[string]interface{}{
			"success":  true,
			"uri":      "",
			"filePath": fmt.Sprintf("/data/local/tmp/%s", fileName),
		}, nil
	}

	uri, filePath, err := hdc.QueryScreenRecordFile(connectKey, fileName, maxWaitTime, checkInterval)
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		}, err
	}

	return map[string]interface{}{
		"success":  true,
		"uri":      uri,
		"filePath": filePath,
	}, nil
}

// CopyScreenRecordFileToTmp 将录屏文件复制到临时目录
func (a *App) CopyScreenRecordFileToTmp(connectKey string, uri string, originalPath string, fileName string) (map[string]interface{}, error) {
	// Android: 文件已在 /data/local/tmp/，无需复制
	if isAndroidDevice(connectKey) {
		return map[string]interface{}{
			"success":  true,
			"filePath": originalPath,
		}, nil
	}

	filePath, err := hdc.CopyScreenRecordFileToTmp(connectKey, uri, originalPath, fileName)
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		}, err
	}

	return map[string]interface{}{
		"success":  true,
		"filePath": filePath,
	}, nil
}

// DownloadScreenRecordFile 下载录屏文件到本地
func (a *App) DownloadScreenRecordFile(connectKey string, devicePath string, savePath string, fileName string) (map[string]interface{}, error) {
	var localPath string
	var localFileName string
	var fileSize int64
	var timestamp int64

	if isAndroidDevice(connectKey) {
		info, err := adb.DownloadScreenRecordFile(connectKey, savePath, fileName)
		if err != nil {
			return map[string]interface{}{
				"success": false,
				"error":   err.Error(),
			}, err
		}
		localPath = info.LocalPath
		localFileName = info.FileName
		fileSize = info.Size
		timestamp = info.Timestamp
	} else {
		info, err := hdc.DownloadScreenRecordFile(connectKey, devicePath, savePath, fileName)
		if err != nil {
			return map[string]interface{}{
				"success": false,
				"error":   err.Error(),
			}, err
		}
		localPath = info.LocalPath
		localFileName = info.FileName
		fileSize = info.Size
		timestamp = info.Timestamp
	}

	renamedPath, renamedFileName, renameErr := renameDeviceOutputFile(
		localPath,
		"screenrecord",
		connectKey,
		time.UnixMilli(timestamp),
	)
	if renameErr != nil {
		return map[string]interface{}{
			"success": false,
			"error":   renameErr.Error(),
		}, renameErr
	}
	localPath = renamedPath
	localFileName = renamedFileName

	return map[string]interface{}{
		"success": true,
		"data": map[string]interface{}{
			"localPath": localPath,
			"fileName":  localFileName,
			"timestamp": timestamp,
			"size":      fileSize,
		},
	}, nil
}

// GetScreenRecordHistory 获取录屏历史记录
func (a *App) GetScreenRecordHistory(savePath string) ([]map[string]interface{}, error) {
	history, err := hdc.GetScreenRecordHistory(savePath)
	if err != nil {
		return []map[string]interface{}{}, err
	}

	return lo.Map(history, func(item hdc.ScreenRecordHistoryItem, _ int) map[string]interface{} {
		return map[string]interface{}{
			"localPath": item.LocalPath,
			"fileName":  item.FileName,
			"timestamp": item.Timestamp,
			"size":      item.Size,
		}
	}), nil
}

// =============== 应用详情相关方法 ===============

// GetAppShortcuts 获取应用快捷方式
func (a *App) GetAppShortcuts(connectKey string, packageName string) ([]map[string]interface{}, error) {
	if isAndroidDevice(connectKey) {
		return []map[string]interface{}{}, nil
	}

	shortcuts, err := hdc.GetAppShortcuts(connectKey, packageName)
	if err != nil {
		return nil, err
	}

	return lo.Map(shortcuts, func(shortcut hdc.ShortcutInfo, _ int) map[string]interface{} {
		return map[string]interface{}{
			"id":             shortcut.ID,
			"label":          shortcut.Label,
			"labelId":        shortcut.LabelID,
			"icon":           shortcut.Icon,
			"iconId":         shortcut.IconID,
			"bundleName":     shortcut.BundleName,
			"moduleName":     shortcut.ModuleName,
			"isEnables":      shortcut.IsEnables,
			"isHomeShortcut": shortcut.IsHomeShortcut,
			"isStatic":       shortcut.IsStatic,
			"intents":        shortcut.Intents,
		}
	}), nil
}

// GetMissionList 获取任务列表
func (a *App) GetMissionList(connectKey string) ([]map[string]interface{}, error) {
	if isAndroidDevice(connectKey) {
		tasks, err := adb.GetRecentTasks(connectKey)
		if err != nil {
			return []map[string]interface{}{}, nil
		}
		return lo.Map(tasks, func(t hdc.MissionInfo, _ int) map[string]interface{} {
			return map[string]interface{}{
				"missionId":       t.MissionID,
				"missionAffinity": t.MissionAffinity,
			}
		}), nil
	}

	missions, err := hdc.GetMissionList(connectKey)
	if err != nil {
		return nil, err
	}

	return lo.Map(missions, func(mission hdc.MissionInfo, _ int) map[string]interface{} {
		return map[string]interface{}{
			"missionId":       mission.MissionID,
			"missionName":     mission.MissionName,
			"lockedState":     mission.LockedState,
			"missionAffinity": mission.MissionAffinity,
			"abilityRecords": lo.Map(mission.AbilityRecords, func(ar hdc.AbilityRecord, _ int) map[string]interface{} {
				return map[string]interface{}{
					"abilityRecordId": ar.AbilityRecordID,
					"appName":         ar.AppName,
					"mainName":        ar.MainName,
					"bundleName":      ar.BundleName,
					"abilityType":     ar.AbilityType,
					"state":           ar.State,
					"startTime":       ar.StartTime,
					"appState":        ar.AppState,
					"ready":           ar.Ready,
					"windowAttached":  ar.WindowAttached,
					"launcher":        ar.Launcher,
					"isKeepAlive":     ar.IsKeepAlive,
				}
			}),
		}
	}), nil
}

// GetAppFullDetail 获取应用完整详情（包括权限和能力信息）
func (a *App) GetAppFullDetail(connectKey string, packageName string) (map[string]interface{}, error) {
	if isAndroidDevice(connectKey) {
		return a.getAndroidAppFullDetail(connectKey, packageName)
	}

	detail, err := hdc.GetAppFullDetail(connectKey, packageName)
	if err != nil {
		return nil, err
	}

	permissions := lo.Map(detail.Permissions, func(perm hdc.PermissionInfo, _ int) map[string]interface{} {
		permMap := map[string]interface{}{"name": perm.Name}
		if perm.Reason != "" {
			permMap["reason"] = perm.Reason
		}
		if perm.UsedScene != nil {
			usedScene := map[string]interface{}{}
			if perm.UsedScene.When != "" {
				usedScene["when"] = perm.UsedScene.When
			}
			if len(perm.UsedScene.Abilities) > 0 {
				usedScene["abilities"] = perm.UsedScene.Abilities
			}
			if len(usedScene) > 0 {
				permMap["usedScene"] = usedScene
			}
		}
		return permMap
	})

	abilities := lo.Map(detail.Abilities, func(ab hdc.AbilityInfo, _ int) map[string]interface{} {
		abMap := map[string]interface{}{"name": ab.Name}
		if ab.Label != "" {
			abMap["label"] = ab.Label
		}
		if ab.Description != "" {
			abMap["description"] = ab.Description
		}
		if ab.LaunchType != "" {
			abMap["launchType"] = ab.LaunchType
		}
		if len(ab.SupportWindowMode) > 0 {
			abMap["supportWindowMode"] = ab.SupportWindowMode
		}
		if len(ab.Skills) > 0 {
			abMap["skills"] = lo.Map(ab.Skills, func(skill hdc.SkillInfo, _ int) map[string]interface{} {
				skillMap := map[string]interface{}{}
				if len(skill.Actions) > 0 {
					skillMap["actions"] = skill.Actions
				}
				if len(skill.Entities) > 0 {
					skillMap["entities"] = skill.Entities
				}
				if len(skill.URIs) > 0 {
					skillMap["uris"] = lo.Map(skill.URIs, func(uri hdc.URIInfo, _ int) map[string]interface{} {
						uriMap := map[string]interface{}{}
						if uri.Scheme != "" {
							uriMap["scheme"] = uri.Scheme
						}
						if uri.Host != "" {
							uriMap["host"] = uri.Host
						}
						if uri.Path != "" {
							uriMap["path"] = uri.Path
						}
						return uriMap
					})
				}
				return skillMap
			})
		}
		return abMap
	})

	return map[string]interface{}{
		"packageName":      detail.PackageName,
		"versionName":      detail.VersionName,
		"versionCode":      detail.VersionCode,
		"installTime":      detail.InstallTime,
		"updateTime":       detail.UpdateTime,
		"firstInstallTime": detail.FirstInstallTime,
		"isSystemApp":      detail.IsSystemApp,
		"isEnabled":        detail.IsEnabled,
		"isPreInstallApp":  detail.IsPreInstallApp,
		"isNativeApp":      detail.IsNativeApp,
		"vendor":           detail.Vendor,
		"targetVersion":    detail.TargetVersion,
		"minSdkVersion":    detail.MinSdkVersion,
		"uid":              detail.Uid,
		"gid":              detail.Gid,
		"codePath":         detail.CodePath,
		"permissions":      permissions,
		"abilities":        abilities,
	}, nil
}

// getAndroidAppFullDetail 获取 Android 应用完整详情
func (a *App) getAndroidAppFullDetail(connectKey string, packageName string) (map[string]interface{}, error) {
	detail, err := adb.GetAppFullDetail(connectKey, packageName)
	if err != nil {
		return nil, err
	}

	// 按需获取应用名和图标（带缓存）
	appName, icon := adb.GetAppNameAndIconCached(connectKey, packageName)

	permissions := lo.Map(detail.Permissions, func(perm hdc.PermissionInfo, _ int) map[string]interface{} {
		return map[string]interface{}{"name": perm.Name}
	})

	abilities := lo.Map(detail.Abilities, func(ab hdc.AbilityInfo, _ int) map[string]interface{} {
		m := map[string]interface{}{"name": ab.Name}
		if ab.Label != "" {
			m["label"] = ab.Label
		}
		return m
	})

	return map[string]interface{}{
		"packageName":      detail.PackageName,
		"appName":          appName,
		"icon":             icon,
		"versionName":      detail.VersionName,
		"versionCode":      detail.VersionCode,
		"installTime":      detail.InstallTime,
		"updateTime":       detail.UpdateTime,
		"firstInstallTime": detail.FirstInstallTime,
		"isSystemApp":      detail.IsSystemApp,
		"isEnabled":        detail.IsEnabled,
		"isPreInstallApp":  detail.IsPreInstallApp,
		"isNativeApp":      detail.IsNativeApp,
		"vendor":           detail.Vendor,
		"targetVersion":    detail.TargetVersion,
		"minSdkVersion":    detail.MinSdkVersion,
		"uid":              detail.Uid,
		"gid":              detail.Gid,
		"codePath":         detail.CodePath,
		"permissions":      permissions,
		"abilities":        abilities,
	}, nil
}

// GetAppRunningRecords 获取运行中的应用记录
func (a *App) GetAppRunningRecords(connectKey string) ([]map[string]interface{}, error) {
	if isAndroidDevice(connectKey) {
		records, err := adb.GetRunningRecords(connectKey)
		if err != nil {
			return []map[string]interface{}{}, nil
		}
		return lo.Map(records, func(r hdc.RunningRecord, _ int) map[string]interface{} {
			return map[string]interface{}{
				"processName": r.ProcessName,
				"pid":         r.PID,
				"uid":         r.UID,
				"state":       r.State,
			}
		}), nil
	}

	records, err := hdc.GetAppRunningRecords(connectKey)
	if err != nil {
		return nil, err
	}

	return lo.Map(records, func(record hdc.RunningRecord, _ int) map[string]interface{} {
		return map[string]interface{}{
			"recordId":    record.RecordID,
			"processName": record.ProcessName,
			"pid":         record.PID,
			"uid":         record.UID,
			"state":       record.State,
			"uiExtensionProviders": lo.Map(record.UIExtensionProviders, func(provider hdc.Provider, _ int) map[string]interface{} {
				return map[string]interface{}{"pid": provider.PID}
			}),
			"rootCallers": lo.Map(record.RootCallers, func(caller hdc.Caller, _ int) map[string]interface{} {
				return map[string]interface{}{"pid": caller.PID}
			}),
		}
	}), nil
}

// =============== 日志管理相关方法 ===============

// GetLogFilePath 获取当前日志文件路径
func (a *App) GetLogFilePath() (string, error) {
	path := applogger.GetLogFilePath()
	if path == "" {
		return "", fmt.Errorf("日志文件路径未初始化")
	}
	return path, nil
}

// OpenLogFile 在系统日志查看器中打开日志文件
// macOS 上使用 Console.app 打开，支持实时流读取
func (a *App) OpenLogFile(filePath string) (map[string]interface{}, error) {
	// 检查文件是否存在
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		return map[string]interface{}{
			"success": false,
			"error":   "日志文件不存在",
		}, nil
	}

	var cmd *exec.Cmd
	if runtime.GOOS == "darwin" {
		// macOS: 使用 Console.app 打开，支持实时流读取
		cmd = exec.Command("open", "-a", "Console", filePath)
	} else if runtime.GOOS == "windows" {
		// Windows: 使用记事本打开
		cmd = exec.Command("notepad", filePath)
		// Windows 下隐藏命令窗口
		hdc.HideWindowsConsoleWindow(cmd)
	} else {
		// Linux: 尝试使用 xdg-open
		cmd = exec.Command("xdg-open", filePath)
	}

	err := cmd.Start()
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("打开日志文件失败: %v", err),
		}, nil
	}

	// 不等待命令完成（异步执行）
	go func() {
		_ = cmd.Wait()
	}()

	return map[string]interface{}{
		"success": true,
	}, nil
}

// =============== 更新检查相关方法 ===============

// UpdateInfo 更新信息结构
type UpdateInfo struct {
	Version      string `json:"version"`
	ReleaseDate  string `json:"releaseDate"`
	DownloadURL  string `json:"downloadUrl"`
	ReleaseNotes string `json:"releaseNotes"`
}

// CheckUpdate 检查更新
// updateCheckURL: 更新检查JSON的URL地址
// currentVersion: 当前软件版本号
func (a *App) CheckUpdate(updateCheckURL string, currentVersion string) (map[string]interface{}, error) {
	// 创建HTTP客户端，设置超时
	client := &http.Client{
		Timeout: 10 * time.Second,
	}

	// 发送GET请求获取更新信息
	resp, err := client.Get(updateCheckURL)
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("获取更新信息失败: %v", err),
		}, nil
	}
	defer resp.Body.Close()

	// 检查HTTP状态码
	if resp.StatusCode != http.StatusOK {
		return map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("获取更新信息失败: HTTP %d", resp.StatusCode),
		}, nil
	}

	// 读取响应体
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("读取更新信息失败: %v", err),
		}, nil
	}

	// 解析JSON
	var updateInfo UpdateInfo
	if err := json.Unmarshal(body, &updateInfo); err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("解析更新信息失败: %v", err),
		}, nil
	}

	// 比较版本号，只有当最新版本大于当前版本时才提示更新
	hasUpdate := compareVersion(updateInfo.Version, currentVersion) > 0

	return map[string]interface{}{
		"success":        true,
		"hasUpdate":      hasUpdate,
		"currentVersion": currentVersion,
		"latestVersion":  updateInfo.Version,
		"releaseDate":    updateInfo.ReleaseDate,
		"downloadURL":    updateInfo.DownloadURL,
		"releaseNotes":   updateInfo.ReleaseNotes,
	}, nil
}

// OpenBrowser 在系统浏览器中打开URL
func (a *App) OpenBrowser(url string) error {
	if a.app == nil {
		return fmt.Errorf("应用实例不可用")
	}
	a.app.Browser.OpenURL(url)
	return nil
}

// =============== Mock配置管理相关方法 ===============

// PushMockConfigToClient 推送Mock配置到Sophon客户端
func (a *App) PushMockConfigToClient(deviceId string, configJson string) error {
	log.Printf("[Mock] 开始推送配置到设备 %s, 配置内容: %s", deviceId, configJson)

	// 解析配置
	var config map[string]interface{}
	if err := json.Unmarshal([]byte(configJson), &config); err != nil {
		log.Printf("[Mock] 配置解析失败: %v", err)
		return err
	}

	// 更新全局 Mock 配置存储
	currentMockConfigMu.Lock()
	currentMockConfig = config
	currentMockConfigMu.Unlock()
	log.Printf("[Mock] 全局 Mock 配置已更新")

	// 查找该设备的TCP服务器
	serversMutex.RLock()
	var targetServer *CaptureServer
	for _, server := range captureServers {
		if server.DeviceID == deviceId {
			targetServer = server
			break
		}
	}
	serversMutex.RUnlock()

	if targetServer == nil {
		log.Printf("[Mock] 未找到设备 %s 的抓包服务器", deviceId)
		return fmt.Errorf("未找到设备 %s 的抓包服务器", deviceId)
	}

	// 构建推送数据包
	packet := map[string]interface{}{
		"version":   1,
		"timestamp": time.Now().UnixMilli(),
		"type":      "mock_config_update",
		"data":      config,
	}

	jsonData, err := json.Marshal(packet)
	if err != nil {
		log.Printf("[Mock] JSON序列化失败: %v", err)
		return err
	}

	log.Printf("[Mock] 数据包已构建: %s", jsonData)

	// 推送配置到所有连接的客户端
	targetServer.mu.Lock()
	log.Printf("[Mock] 当前已连接的客户端数量: %d", len(targetServer.Clients))
	successCount := 0
	for deviceId, client := range targetServer.Clients {
		log.Printf("[Mock] 检查客户端 %s: IsConnected=%v, Conn=%v", deviceId, client.IsConnected, client.Conn != nil)
		if client.IsConnected && client.Conn != nil {
			// 锁定客户端连接，避免并发写入冲突
			client.mu.Lock()
			bytesWritten, err := client.Conn.Write(append(jsonData, '\n'))
			client.mu.Unlock()

			if err != nil {
				log.Printf("[Mock] 推送配置到客户端 %s 失败: %v", client.DeviceID, err)
			} else {
				successCount++
				log.Printf("[Mock] 配置已成功推送到客户端 %s, 写入字节数: %d", client.DeviceID, bytesWritten)
			}
		}
	}
	targetServer.mu.Unlock()

	log.Printf("[Mock] 配置已推送到设备 %s: %d 个客户端", deviceId, successCount)
	return nil
}

// PushAndroidMockConfigToClient 推送 Mock 配置到 Android JVMTI Agent
func (a *App) PushAndroidMockConfigToClient(deviceId string, packageName string, configJson string) error {
	log.Printf("[AndroidMock] 开始推送配置到设备 %s, 包名 %s", deviceId, packageName)

	var config map[string]interface{}
	if err := json.Unmarshal([]byte(configJson), &config); err != nil {
		log.Printf("[AndroidMock] 配置解析失败: %v", err)
		return err
	}

	currentMockConfigMu.Lock()
	currentMockConfig = config
	currentMockConfigMu.Unlock()

	if err := android.PushMockConfigToAndroidCapture(deviceId, packageName, config); err != nil {
		log.Printf("[AndroidMock] 推送失败: %v", err)
		return err
	}
	return nil
}

func getCurrentMockConfigForAndroid() interface{} {
	currentMockConfigMu.RLock()
	defer currentMockConfigMu.RUnlock()
	if currentMockConfig == nil {
		return map[string]interface{}{
			"enabled": false,
			"rules":   []interface{}{},
		}
	}
	return currentMockConfig
}

// =============== Android 网络抓包相关方法 ===============

// GetAndroidDebuggableApps 获取 Android 可调试应用列表
func (a *App) GetAndroidDebuggableApps(deviceId string) ([]map[string]interface{}, error) {
	apps, err := android.GetDebuggableApps(deviceId)
	if err != nil {
		return nil, err
	}

	result := make([]map[string]interface{}, len(apps))
	for i, app := range apps {
		result[i] = map[string]interface{}{
			"packageName": app.PackageName,
			"processName": app.ProcessName,
			"pid":         app.PID,
			"name":        app.Name,
			"debuggable":  app.Debuggable,
		}
	}
	return result, nil
}

// StartAndroidNetworkCapture 启动 Android 网络抓包
func (a *App) StartAndroidNetworkCapture(deviceId string, packageName string, pid int, localPort int) error {
	// 本地 TCP 端口是全局资源。先清理由当前 Hadice 管理、但可能属于其他
	// 平台或旧设备连接的同端口 server，避免只按 deviceId 清理后仍 bind 失败。
	a.stopCaptureServersByPort(localPort)

	emitEvent := func(eventName string, data interface{}) {
		if a.app != nil {
			a.app.Event.Emit(eventName, data)
		}
	}

	return android.StartAndroidCapture(android.CaptureConfig{
		DeviceID:    deviceId,
		PackageName: packageName,
		PID:         pid,
		LocalPort:   localPort,
		EmitEvent:   emitEvent,
		MockConfig:  getCurrentMockConfigForAndroid,
	})
}

// GetAndroidPidByPackageName 按包名快速查询当前 PID（用于开始抓包前快速刷新 PID，避免漏请求）
// 返回 0 表示进程未在运行
func (a *App) GetAndroidPidByPackageName(deviceId string, packageName string) int {
	return android.GetPidByPackageName(deviceId, packageName)
}

// StopAndroidNetworkCapture 停止 Android 网络抓包
func (a *App) StopAndroidNetworkCapture(deviceId string, packageName string) error {
	return android.StopAndroidCapture(deviceId, packageName)
}

// StopAllAndroidCaptures 停止指定设备的所有 Android 抓包会话（按设备 ID 清理，不依赖 packageName）
// 用于强制停止/兜底场景：当 packageName 带有残留字符导致 sessionKey 不匹配时仍可清理
func (a *App) StopAllAndroidCaptures(deviceId string) int {
	return android.StopAllAndroidCaptures(deviceId)
}

// GetAndroidCaptureStatus 获取 Android 抓包状态
func (a *App) GetAndroidCaptureStatus(deviceId string, packageName string) map[string]interface{} {
	return android.GetAndroidCaptureStatus(deviceId, packageName)
}

// IsAndroidDevice 检测设备是否为 Android 设备
func (a *App) IsAndroidDevice(deviceId string) bool {
	return android.IsAndroidDevice(deviceId)
}

// GetAndroidDeviceList 获取 Android 设备列表
func (a *App) GetAndroidDeviceList() ([]map[string]interface{}, error) {
	devices, err := android.GetAndroidDeviceList()
	if err != nil {
		return nil, err
	}

	result := make([]map[string]interface{}, len(devices))
	for i, d := range devices {
		result[i] = map[string]interface{}{
			"deviceId":       d.DeviceID,
			"model":          d.Model,
			"brand":          d.Brand,
			"androidVersion": d.AndroidVer,
			"apiLevel":       d.APILevel,
			"isDebuggable":   d.IsDebuggable,
		}
	}
	return result, nil
}

// IsDeviceRooted 检测设备是否已 Root
func (a *App) IsDeviceRooted(deviceId string) bool {
	return android.IsDeviceRooted(deviceId)
}

// =============== HiProfiler 抓包相关方法 ===============

// GetHiProfilerApps 获取鸿蒙设备上可调试的应用列表（HiProfiler 模式）
func (a *App) GetHiProfilerApps(deviceId string) ([]map[string]interface{}, error) {
	apps, err := hiprofiler.GetDebuggableApps(deviceId)
	if err != nil {
		return nil, err
	}

	result := make([]map[string]interface{}, len(apps))
	for i, app := range apps {
		result[i] = map[string]interface{}{
			"bundleName":  app.BundleName,
			"appName":     app.AppName,
			"processName": app.ProcessName,
			"pid":         app.PID,
		}
	}
	return result, nil
}

// StartHiProfilerCapture 启动 HiProfiler 抓包
func (a *App) StartHiProfilerCapture(deviceId string, pid int, bundleName string, processName string) error {
	emitEvent := func(eventName string, data interface{}) {
		if a.app != nil {
			a.app.Event.Emit(eventName, data)
		}
	}

	return hiprofiler.StartCapture(hiprofiler.CaptureConfig{
		DeviceID:    deviceId,
		PID:         pid,
		BundleName:  bundleName,
		ProcessName: processName,
		EmitEvent:   emitEvent,
	})
}

// StopHiProfilerCapture 停止 HiProfiler 抓包
func (a *App) StopHiProfilerCapture(deviceId string, pid int) error {
	return hiprofiler.StopCapture(deviceId, pid)
}

// StopAllHiProfilerCaptures 停止指定设备由 Hadice 管理的全部 HiProfiler 会话。
func (a *App) StopAllHiProfilerCaptures(deviceId string) int {
	return hiprofiler.StopAllCaptures(deviceId)
}

// GetHiProfilerCaptureStatus 获取指定设备当前的 HiProfiler 会话状态。
func (a *App) GetHiProfilerCaptureStatus(deviceId string) map[string]interface{} {
	return hiprofiler.GetCaptureStatus(deviceId)
}

// GetHiProfilerProcessStatus 按完整进程名查询当前运行状态和 PID。
func (a *App) GetHiProfilerProcessStatus(deviceId string, processName string) (map[string]interface{}, error) {
	pid, found, err := hiprofiler.QueryPidByProcessName(deviceId, processName)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"alive": found,
		"pid":   pid,
	}, nil
}

// GetHadiceOutputDirectory 获取并创建 ~/Documents/Hadice 下的输出目录。
func (a *App) GetHadiceOutputDirectory(subdir string) (string, error) {
	if strings.TrimSpace(subdir) == "" {
		return getHadiceOutputDirectory()
	}
	cleanSubdir := filepath.Clean(strings.TrimSpace(subdir))
	if filepath.IsAbs(cleanSubdir) || cleanSubdir == ".." ||
		strings.HasPrefix(cleanSubdir, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("无效的输出目录")
	}
	return getHadiceOutputDirectory(cleanSubdir)
}

// SaveTextFile 将文本内容保存到 ~/Documents/Hadice/ 下的指定相对路径。
// filename: 文件名或相对路径（如 "network/capture_harmony_demo_20260730141620.csv"）
// content: 文件内容
// 返回保存的完整路径
func (a *App) SaveTextFile(filename string, content string) (string, error) {
	fullPath, err := resolveOutputRelativePath(filename)
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(fullPath, []byte(content), 0o644); err != nil {
		return "", fmt.Errorf("写入文件失败: %v", err)
	}

	return fullPath, nil
}
