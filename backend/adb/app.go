package adb

import (
	"archive/zip"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"Hadice/backend/device"
)

type AppInfo struct {
	PackageName string `json:"packageName"`
	AppName     string `json:"appName"`
	Version     string `json:"version"`
	VersionCode int    `json:"versionCode"`
	Size        int64  `json:"size"`
	Icon        string `json:"icon"`
	IsSystemApp bool   `json:"isSystemApp"`
	IsRunning   bool   `json:"isRunning"`
	IsEnabled   bool   `json:"isEnabled"`
	InstallTime int64  `json:"installTime"`
}

type AppStats struct {
	Total      int `json:"total"`
	System     int `json:"system"`
	ThirdParty int `json:"thirdParty"`
	Running    int `json:"running"`
}

type AppListResult struct {
	Stats AppStats  `json:"stats"`
	Apps  []AppInfo `json:"apps"`
}

// AndroidAppInfo 简化的安卓应用信息（用于日志页面等场景）
type AndroidAppInfo struct {
	PackageName string `json:"packageName"`
	AppName     string `json:"appName"`
	Pid         int    `json:"pid"`
	IsSystemApp bool   `json:"isSystemApp"`
	IsRunning   bool   `json:"isRunning"`
}

// AndroidAppListResult 简化的安卓应用列表结果
type AndroidAppListResult struct {
	Apps []AndroidAppInfo `json:"apps"`
}

// GetAndroidAppList 获取简化的安卓应用列表（带运行 PID）
func GetAndroidAppList(connectKey string) (*AndroidAppListResult, error) {
	args := []string{"-s", connectKey, "shell", "pm", "list", "packages", "-3"}
	result, err := ExecuteAdbWithTimeout(args, 30*time.Second)
	if err != nil {
		return nil, err
	}

	thirdPartyPackages := parsePackageList(result.Output)

	args = []string{"-s", connectKey, "shell", "pm", "list", "packages", "-s"}
	result, err = ExecuteAdbWithTimeout(args, 30*time.Second)
	if err != nil {
		return nil, err
	}

	systemPackages := parsePackageList(result.Output)

	args = []string{"-s", connectKey, "shell", "pidof", strings.Join(append(thirdPartyPackages, systemPackages...), " ")}
	result, _ = ExecuteAdbWithTimeout(args, 10*time.Second)
	runningPids := parsePidofOutput(result.Output)

	apps := make([]AndroidAppInfo, 0)
	for _, pkg := range thirdPartyPackages {
		app := AndroidAppInfo{
			PackageName: pkg,
			AppName:     pkg,
			IsSystemApp: false,
			IsRunning:   runningPids[pkg] > 0,
			Pid:         runningPids[pkg],
		}
		apps = append(apps, app)
	}
	for _, pkg := range systemPackages {
		app := AndroidAppInfo{
			PackageName: pkg,
			AppName:     pkg,
			IsSystemApp: true,
			IsRunning:   runningPids[pkg] > 0,
			Pid:         runningPids[pkg],
		}
		apps = append(apps, app)
	}

	return &AndroidAppListResult{Apps: apps}, nil
}

func parsePackageList(output string) []string {
	lines := strings.Split(output, "\n")
	packages := make([]string, 0)
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "package:") {
			pkg := strings.TrimPrefix(line, "package:")
			pkg = strings.TrimSpace(pkg)
			if pkg != "" {
				packages = append(packages, pkg)
			}
		}
	}
	return packages
}

func parsePidofOutput(output string) map[string]int {
	result := make(map[string]int)
	if output == "" {
		return result
	}

	re := regexp.MustCompile(`(\d+)\s+(\S+)`)
	matches := re.FindAllStringSubmatch(output, -1)
	for _, match := range matches {
		if len(match) >= 3 {
			pid, _ := strconv.Atoi(match[1])
			pkg := match[2]
			result[pkg] = pid
		}
	}
	return result
}

// InstallApp 安装 Android 应用 (APK)
// connectKey: 设备连接标识 (如 "192.168.1.100:5555" 或 "emulator-5554")
// filePath: APK 文件路径
// replace: 是否覆盖安装 (-r 参数)
func InstallApp(connectKey string, filePath string, replace bool) (*AdbResult, error) {
	args := []string{"-s", connectKey, "install"}
	if replace {
		args = append(args, "-r")
	}
	args = append(args, filePath)

	result, err := ExecuteAdbWithTimeout(args, 120*time.Second)
	if err != nil {
		return &AdbResult{Success: false, Error: err.Error()}, err
	}

	if result != nil {
		fullOutput := result.Output
		if result.Error != "" {
			fullOutput = fullOutput + "\n" + result.Error
		}
		fullOutput = strings.TrimSpace(fullOutput)
		outputLower := strings.ToLower(fullOutput)

		success := result.Success && (strings.Contains(outputLower, "success") ||
			(!strings.Contains(outputLower, "error") && !strings.Contains(outputLower, "failure") && fullOutput != ""))

		return &AdbResult{
			Success: success,
			Output:  result.Output,
			Error:   result.Error,
		}, nil
	}

	return &AdbResult{Success: false, Error: "安装失败"}, nil
}

// UninstallApp 卸载 Android 应用
// connectKey: 设备连接标识
// packageName: 应用包名
func UninstallApp(connectKey string, packageName string) (*AdbResult, error) {
	args := []string{"-s", connectKey, "uninstall", packageName}

	result, err := ExecuteAdbWithTimeout(args, 60*time.Second)
	if err != nil {
		return &AdbResult{Success: false, Error: err.Error()}, err
	}

	if result != nil {
		outputLower := strings.ToLower(result.Output)
		success := strings.Contains(outputLower, "success")

		return &AdbResult{
			Success: success,
			Output:  result.Output,
			Error:   result.Error,
		}, nil
	}

	return &AdbResult{Success: false, Error: "卸载失败"}, nil
}

func GetAppList(connectKey string, filter string) (*AppListResult, error) {
	var args []string
	switch filter {
	case "system":
		args = []string{"-s", connectKey, "shell", "pm", "list", "packages", "-s"}
	case "thirdParty":
		args = []string{"-s", connectKey, "shell", "pm", "list", "packages", "-3"}
	default:
		args = []string{"-s", connectKey, "shell", "pm", "list", "packages"}
	}

	result, err := ExecuteAdb(args)
	if err != nil {
		return nil, fmt.Errorf("failed to get app list: %w", err)
	}

	defaultResult := &AppListResult{
		Stats: AppStats{},
		Apps:  []AppInfo{},
	}

	if !result.Success || result.Output == "" {
		return defaultResult, nil
	}

	lines := strings.Split(result.Output, "\n")
	apps := []AppInfo{}

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "package:") {
			continue
		}

		packageName := strings.TrimPrefix(line, "package:")
		if packageName == "" {
			continue
		}

		if strings.Contains(packageName, "Error:") {
			continue
		}

		isSystemApp := filter == "system"
		if filter == "all" || filter == "" {
			isSystemApp = isSystemPackage(packageName)
		}

		apps = append(apps, AppInfo{
			PackageName: packageName,
			AppName:     packageName,
			IsSystemApp: isSystemApp,
			IsEnabled:   true,
		})
	}

	runningPackages := make(map[string]bool)
	psResult, _ := ExecuteAdb([]string{"-s", connectKey, "shell", "ps"})
	if psResult != nil && psResult.Success && psResult.Output != "" {
		runningPackages = parseRunningPackages(psResult.Output)
	}

	for i := range apps {
		apps[i].IsRunning = runningPackages[apps[i].PackageName]
	}

	stats := calculateAppStats(apps)

	return &AppListResult{
		Stats: stats,
		Apps:  apps,
	}, nil
}

func isSystemPackage(packageName string) bool {
	systemPrefixes := []string{
		"com.android.",
		"com.google.android.",
		"android.",
		"com.samsung.",
		"com.sec.",
		"com.huawei.",
		"com.xiaomi.",
		"com.vivo.",
		"com.oppo.",
		"com.meizu.",
		"com.oneplus.",
		"com.mediatek.",
		"com.qualcomm.",
	}
	for _, prefix := range systemPrefixes {
		if strings.HasPrefix(packageName, prefix) {
			return true
		}
	}
	return false
}

func parseRunningPackages(output string) map[string]bool {
	runningPackages := make(map[string]bool)
	lines := strings.Split(output, "\n")

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.Contains(line, "USER") || strings.Contains(line, "PID") {
			continue
		}

		parts := regexp.MustCompile(`\s+`).Split(line, -1)
		if len(parts) >= 9 {
			name := parts[8]
			if strings.Contains(name, ".") && !strings.Contains(name, "/") && !strings.HasPrefix(name, "[") {
				runningPackages[name] = true
			}
		}
	}

	return runningPackages
}

func calculateAppStats(apps []AppInfo) AppStats {
	stats := AppStats{
		Total:      len(apps),
		System:     0,
		ThirdParty: 0,
		Running:    0,
	}

	for _, app := range apps {
		if app.IsSystemApp {
			stats.System++
		} else {
			stats.ThirdParty++
		}
		if app.IsRunning {
			stats.Running++
		}
	}

	return stats
}

func GetAppDetail(connectKey string, packageName string) (*AppInfo, error) {
	result, err := ExecuteAdb([]string{"-s", connectKey, "shell", "dumpsys", "package", packageName})
	if err != nil {
		return nil, fmt.Errorf("failed to get app detail: %w", err)
	}

	info := &AppInfo{
		PackageName: packageName,
		AppName:     packageName,
		IsSystemApp: isSystemPackage(packageName),
		IsEnabled:   true,
	}

	if !result.Success || result.Output == "" {
		return info, nil
	}

	output := result.Output

	versionNameRe := regexp.MustCompile(`versionName=([^\s]+)`)
	if match := versionNameRe.FindStringSubmatch(output); len(match) > 1 {
		info.Version = match[1]
	}

	versionCodeRe := regexp.MustCompile(`versionCode=(\d+)`)
	if match := versionCodeRe.FindStringSubmatch(output); len(match) > 1 {
		info.VersionCode, _ = strconv.Atoi(match[1])
	}

	firstInstallRe := regexp.MustCompile(`firstInstallTime=(\d+)`)
	if match := firstInstallRe.FindStringSubmatch(output); len(match) > 1 {
		installTime, _ := strconv.ParseInt(match[1], 10, 64)
		info.InstallTime = installTime
	}

	enabledRe := regexp.MustCompile(`enabled=(\d+)`)
	if match := enabledRe.FindStringSubmatch(output); len(match) > 1 {
		enabled, _ := strconv.Atoi(match[1])
		info.IsEnabled = enabled != 0 && enabled != 2
	}

	return info, nil
}

func StartApp(connectKey string, packageName string) (*AdbResult, error) {
	return ExecuteAdb([]string{"-s", connectKey, "shell", "monkey", "-p", packageName, "-c", "android.intent.category.LAUNCHER", "1"})
}

func StopApp(connectKey string, packageName string) (*AdbResult, error) {
	return ExecuteAdb([]string{"-s", connectKey, "shell", "am", "force-stop", packageName})
}

func ClearAppData(connectKey string, packageName string) (*AdbResult, error) {
	return ExecuteAdb([]string{"-s", connectKey, "shell", "pm", "clear", packageName})
}

func GetRunningPackages(connectKey string) (map[string]int, error) {
	result, err := ExecuteAdb([]string{"-s", connectKey, "shell", "ps"})
	if err != nil {
		return nil, err
	}

	runningPackages := make(map[string]int)
	if !result.Success || result.Output == "" {
		return runningPackages, nil
	}

	lines := strings.Split(result.Output, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.Contains(line, "USER") || strings.Contains(line, "PID") {
			continue
		}

		parts := regexp.MustCompile(`\s+`).Split(line, -1)
		if len(parts) >= 9 {
			pid, _ := strconv.Atoi(parts[1])
			name := parts[8]
			if strings.Contains(name, ".") && !strings.Contains(name, "/") && !strings.HasPrefix(name, "[") {
				runningPackages[name] = pid
			}
		}
	}

	return runningPackages, nil
}

func GetAppPath(connectKey string, packageName string) (string, error) {
	result, err := ExecuteAdb([]string{"-s", connectKey, "shell", "pm", "path", packageName})
	if err != nil {
		return "", err
	}

	if !result.Success || result.Output == "" {
		return "", fmt.Errorf("package not found: %s", packageName)
	}

	lines := strings.Split(result.Output, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "package:") {
			return strings.TrimPrefix(line, "package:"), nil
		}
	}

	return "", fmt.Errorf("package path not found: %s", packageName)
}

type AndroidManifest struct {
	Package     string `xml:"package,attr"`
	VersionCode string `xml:"versionCode,attr"`
	VersionName string `xml:"versionName,attr"`
	Application struct {
		Label string `xml:"label,attr"`
		Icon  string `xml:"icon,attr"`
	} `xml:"application"`
}

func ParseApkInfo(apkPath string) (string, string, error) {
	reader, err := zip.OpenReader(apkPath)
	if err != nil {
		return "", "", err
	}
	defer reader.Close()

	var appName string
	var iconBase64 string

	for _, file := range reader.File {
		if file.Name == "AndroidManifest.xml" {
			rc, err := file.Open()
			if err != nil {
				continue
			}
			data, err := io.ReadAll(rc)
			rc.Close()
			if err != nil {
				continue
			}
			appName = extractLabelFromManifest(data)
		}

		if strings.HasPrefix(file.Name, "res/drawable") || strings.HasPrefix(file.Name, "res/mipmap") {
			if strings.Contains(strings.ToLower(file.Name), "ic_launcher") || strings.Contains(strings.ToLower(file.Name), "icon") {
				rc, err := file.Open()
				if err != nil {
					continue
				}
				data, err := io.ReadAll(rc)
				rc.Close()
				if err != nil {
					continue
				}
				iconBase64 = "data:image/png;base64," + encodeBase64(data)
				break
			}
		}
	}

	return appName, iconBase64, nil
}

func extractLabelFromManifest(data []byte) string {
	labelRe := regexp.MustCompile(`android:label="([^"]+)"`)
	if match := labelRe.FindSubmatch(data); len(match) > 1 {
		return string(match[1])
	}

	labelRe = regexp.MustCompile(`@string/(\w+)`)
	if match := labelRe.FindSubmatch(data); len(match) > 1 {
		return string(match[1])
	}

	return ""
}

func encodeBase64(data []byte) string {
	const base64Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
	result := make([]byte, 0, (len(data)+2)/3*4)

	for i := 0; i < len(data); i += 3 {
		var n uint32
		remaining := len(data) - i

		if remaining >= 3 {
			n = uint32(data[i])<<16 | uint32(data[i+1])<<8 | uint32(data[i+2])
			result = append(result, base64Chars[n>>18&0x3F], base64Chars[n>>12&0x3F], base64Chars[n>>6&0x3F], base64Chars[n&0x3F])
		} else if remaining == 2 {
			n = uint32(data[i])<<16 | uint32(data[i+1])<<8
			result = append(result, base64Chars[n>>18&0x3F], base64Chars[n>>12&0x3F], base64Chars[n>>6&0x3F], '=')
		} else {
			n = uint32(data[i]) << 16
			result = append(result, base64Chars[n>>18&0x3F], base64Chars[n>>12&0x3F], '=', '=')
		}
	}

	return string(result)
}

func GetAppNameFromApk(connectKey string, packageName string) (string, string, error) {
	apkPath, err := GetAppPath(connectKey, packageName)
	if err != nil {
		return packageName, "", err
	}

	tmpDir := os.TempDir()
	localApkPath := filepath.Join(tmpDir, packageName+".apk")
	defer os.Remove(localApkPath)

	result, err := ExecuteAdb([]string{"-s", connectKey, "pull", apkPath, localApkPath})
	if err != nil || !result.Success {
		return packageName, "", err
	}

	appName, iconBase64, err := ParseApkInfo(localApkPath)
	if err != nil {
		return packageName, "", err
	}

	if appName == "" {
		appName = packageName
	}

	return appName, iconBase64, nil
}

func GetAppListWithDetails(connectKey string, filter string) (*AppListResult, error) {
	result, err := GetAppList(connectKey, filter)
	if err != nil {
		return nil, err
	}

	var wg sync.WaitGroup
	mu := sync.Mutex{}

	for i := range result.Apps {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			app := &result.Apps[idx]

			detail, err := GetAppDetail(connectKey, app.PackageName)
			if err == nil && detail != nil {
				mu.Lock()
				app.Version = detail.Version
				app.VersionCode = detail.VersionCode
				app.InstallTime = detail.InstallTime
				app.IsEnabled = detail.IsEnabled
				mu.Unlock()
			}
		}(i)
	}
	wg.Wait()

	return result, nil
}

type AppProvider struct{}

var appProvider = &AppProvider{}

func GetAppProvider() *AppProvider {
	return appProvider
}

func (p *AppProvider) GetAppList(connectKey string, filter string) (*AppListResult, error) {
	return GetAppList(connectKey, filter)
}

func (p *AppProvider) GetAppDetail(connectKey string, packageName string) (*AppInfo, error) {
	return GetAppDetail(connectKey, packageName)
}

func (p *AppProvider) StartApp(connectKey string, packageName string) (*device.CommandResult, error) {
	result, err := StartApp(connectKey, packageName)
	if err != nil {
		return nil, err
	}
	return &device.CommandResult{
		Success: result.Success,
		Output:  result.Output,
		Error:   result.Error,
	}, nil
}

func (p *AppProvider) StopApp(connectKey string, packageName string) (*device.CommandResult, error) {
	result, err := StopApp(connectKey, packageName)
	if err != nil {
		return nil, err
	}
	return &device.CommandResult{
		Success: result.Success,
		Output:  result.Output,
		Error:   result.Error,
	}, nil
}

func (p *AppProvider) ClearAppData(connectKey string, packageName string) (*device.CommandResult, error) {
	result, err := ClearAppData(connectKey, packageName)
	if err != nil {
		return nil, err
	}
	return &device.CommandResult{
		Success: result.Success,
		Output:  result.Output,
		Error:   result.Error,
	}, nil
}

func (p *AppProvider) UninstallApp(connectKey string, packageName string) (*device.CommandResult, error) {
	result, err := UninstallApp(connectKey, packageName)
	if err != nil {
		return nil, err
	}
	return &device.CommandResult{
		Success: result.Success,
		Output:  result.Output,
		Error:   result.Error,
	}, nil
}

func FetchAppDetailsAsync(connectKey string, apps []AppInfo, onDetail func(packageName string, appName string, icon string)) {
	go func() {
		for i := range apps {
			appName, icon, err := GetAppNameFromApk(connectKey, apps[i].PackageName)
			if err != nil {
				log.Printf("[ADB] Failed to get app info for %s: %v", apps[i].PackageName, err)
				continue
			}

			if appName != "" && appName != apps[i].PackageName {
				if onDetail != nil {
					onDetail(apps[i].PackageName, appName, icon)
				}
			}

			time.Sleep(100 * time.Millisecond)
		}
	}()
}

func GetAppListIncremental(connectKey string, filter string, callback func(event string, data interface{})) (*AppListResult, error) {
	var args []string
	switch filter {
	case "system":
		args = []string{"-s", connectKey, "shell", "pm", "list", "packages", "-s"}
	case "thirdParty":
		args = []string{"-s", connectKey, "shell", "pm", "list", "packages", "-3"}
	default:
		args = []string{"-s", connectKey, "shell", "pm", "list", "packages"}
	}

	result, err := ExecuteAdb(args)
	if err != nil {
		return nil, fmt.Errorf("failed to get app list: %w", err)
	}

	defaultResult := &AppListResult{
		Stats: AppStats{},
		Apps:  []AppInfo{},
	}

	if !result.Success || result.Output == "" {
		return defaultResult, nil
	}

	lines := strings.Split(result.Output, "\n")
	apps := []AppInfo{}

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "package:") {
			continue
		}

		packageName := strings.TrimPrefix(line, "package:")
		if packageName == "" {
			continue
		}

		if strings.Contains(packageName, "Error:") {
			continue
		}

		isSystemApp := filter == "system"
		if filter == "all" || filter == "" {
			isSystemApp = isSystemPackage(packageName)
		}

		apps = append(apps, AppInfo{
			PackageName: packageName,
			AppName:     packageName,
			IsSystemApp: isSystemApp,
			IsEnabled:   true,
		})
	}

	if callback != nil {
		callback("basic", map[string]interface{}{
			"apps":  apps,
			"stats": calculateAppStats(apps),
		})
	}

	go func() {
		runningPackages, _ := GetRunningPackages(connectKey)
		var wg sync.WaitGroup
		mu := sync.Mutex{}

		for i := range apps {
			wg.Add(1)
			go func(idx int) {
				defer wg.Done()
				if pid, running := runningPackages[apps[idx].PackageName]; running {
					mu.Lock()
					apps[idx].IsRunning = true
					mu.Unlock()
					_ = pid
				}
			}(i)
		}
		wg.Wait()

		if callback != nil {
			callback("complete", map[string]interface{}{
				"apps":  apps,
				"stats": calculateAppStats(apps),
			})
		}

		for i := range apps {
			appName, icon, err := GetAppNameFromApk(connectKey, apps[i].PackageName)
			if err != nil {
				time.Sleep(50 * time.Millisecond)
				continue
			}

			if appName != "" && appName != apps[i].PackageName {
				mu.Lock()
				apps[i].AppName = appName
				if icon != "" {
					apps[i].Icon = icon
				}
				mu.Unlock()

				if callback != nil {
					callback("detail-updated", map[string]interface{}{
						"packageName": apps[i].PackageName,
						"appName":     appName,
						"icon":        icon,
					})
				}
			}

			time.Sleep(100 * time.Millisecond)
		}
	}()

	stats := calculateAppStats(apps)
	return &AppListResult{
		Stats: stats,
		Apps:  apps,
	}, nil
}
