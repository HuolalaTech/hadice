package hdc

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"time"

	"github.com/samber/lo"
	"github.com/wailsapp/wails/v3/pkg/application"
)

var (
	appListLoading     bool
	appListLoadingLock sync.Mutex
)

func parseAppList(output string) []AppInfo {
	jsonStart := strings.Index(output, "[")
	if jsonStart == -1 {
		return parseAppListLegacy(output)
	}

	jsonStr := output[jsonStart:]
	var apps []map[string]interface{}
	if err := json.Unmarshal([]byte(jsonStr), &apps); err != nil {
		return parseAppListLegacy(output)
	}

	return lo.FilterMap(apps, func(app map[string]interface{}, _ int) (AppInfo, bool) {
		bundleName, ok := app["bundleName"].(string)
		if !ok || bundleName == "" {
			return AppInfo{}, false
		}

		appName := bundleName
		if label, ok := app["label"].(string); ok && label != "" {
			appName = label
		}

		isSystemApp := strings.HasPrefix(bundleName, "com.ohos.") ||
			strings.HasPrefix(bundleName, "ohos.") ||
			strings.HasPrefix(bundleName, "system.")

		return AppInfo{
			PackageName: bundleName,
			AppName:     appName,
			IsSystemApp: isSystemApp,
			IsEnabled:   true,
		}, true
	})
}

func parseAppListLegacy(output string) []AppInfo {
	lines := strings.Split(output, "\n")

	return lo.FilterMap(lines, func(line string, _ int) (AppInfo, bool) {
		line = strings.TrimSpace(line)
		if line == "" {
			return AppInfo{}, false
		}

		if strings.Contains(line, "bundleName") || strings.Contains(line, "---") {
			return AppInfo{}, false
		}

		if strings.HasPrefix(line, "ID:") {
			return AppInfo{}, false
		}

		fields := strings.Fields(line)
		if len(fields) == 0 {
			return AppInfo{}, false
		}
		packageName := fields[0]

		if !strings.Contains(packageName, ".") {
			return AppInfo{}, false
		}

		isSystemApp := strings.HasPrefix(packageName, "com.ohos.") ||
			strings.HasPrefix(packageName, "ohos.") ||
			strings.HasPrefix(packageName, "system.")

		return AppInfo{
			PackageName: packageName,
			AppName:     packageName,
			IsSystemApp: isSystemApp,
			IsEnabled:   true,
		}, true
	})
}

func parseRunningPackages(psOutput string) map[string]bool {
	if psOutput == "" {
		return make(map[string]bool)
	}

	lines := strings.Split(psOutput, "\n")

	runningPackages := make(map[string]bool)
	lo.ForEach(lines, func(line string, _ int) {
		line = strings.TrimSpace(line)
		if line == "" || strings.Contains(line, "PID") || strings.Contains(line, "USER") {
			return
		}

		parts := strings.Fields(line)
		if len(parts) >= 8 {
			packageName := parts[len(parts)-1]
			if strings.Contains(packageName, ".") && !strings.Contains(packageName, "/") && !strings.HasPrefix(packageName, "[") {
				runningPackages[packageName] = true
			}
		}
	})

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

func filterApps(apps []AppInfo, filter string) []AppInfo {
	if filter == "" || filter == "all" {
		return apps
	}

	return lo.Filter(apps, func(app AppInfo, _ int) bool {
		switch filter {
		case "system":
			return app.IsSystemApp
		case "thirdParty":
			return !app.IsSystemApp
		case "running":
			return app.IsRunning
		case "stopped":
			return !app.IsRunning
		default:
			return true
		}
	})
}

func GetAppList(connectKey string, filter string) (*AppListResult, error) {
	listChan := make(chan *HdcResult, 1)
	psChan := make(chan *HdcResult, 1)

	go func() {
		result, _ := ExecuteHdc([]string{"-t", connectKey, "shell", "bm", "dump", "-a", "-l"})
		listChan <- result
	}()

	go func() {
		result, _ := ExecuteHdc([]string{"-t", connectKey, "shell", "ps", "-A"})
		psChan <- result
	}()

	listResult := <-listChan
	psResult := <-psChan

	if listResult == nil || !listResult.Success || listResult.Output == "" {
		return &AppListResult{
			Stats: AppStats{},
			Apps:  []AppInfo{},
		}, nil
	}

	apps := parseAppList(listResult.Output)
	runningPackages := parseRunningPackages(psResult.Output)

	for i := range apps {
		apps[i].IsRunning = runningPackages[apps[i].PackageName]
	}

	stats := calculateAppStats(apps)
	filteredApps := filterApps(apps, filter)

	return &AppListResult{
		Stats: stats,
		Apps:  filteredApps,
	}, nil
}

func GetCachedAppList() (*AppListResult, error) {
	cachedApps := GetAllCachedApps()
	if len(cachedApps) == 0 {
		return nil, nil
	}

	apps := lo.Map(cachedApps, func(cached *CachedAppInfo, _ int) AppInfo {
		return AppInfo{
			PackageName: cached.PackageName,
			AppName:     cached.AppName,
			IsSystemApp: cached.IsSystemApp,
			IsRunning:   cached.IsRunning,
			IsEnabled:   true,
		}
	})

	stats := calculateAppStats(apps)

	return &AppListResult{
		Stats: stats,
		Apps:  apps,
	}, nil
}

func startAppListLoading() bool {
	appListLoadingLock.Lock()
	defer appListLoadingLock.Unlock()

	if appListLoading {
		return false
	}
	appListLoading = true
	return true
}

func stopAppListLoading() {
	appListLoadingLock.Lock()
	defer appListLoadingLock.Unlock()
	appListLoading = false
}

func GetAppListWithDiskCache(ctx context.Context, connectKey string, filter string) (*AppListResult, error) {
	cachedApps := GetAllCachedApps()
	if len(cachedApps) > 0 {
		apps := lo.Map(cachedApps, func(cached *CachedAppInfo, _ int) AppInfo {
			return AppInfo{
				PackageName: cached.PackageName,
				AppName:     cached.AppName,
				IsSystemApp: cached.IsSystemApp,
				IsRunning:   cached.IsRunning,
				IsEnabled:   true,
			}
		})
		filteredApps := filterApps(apps, filter)
		stats := calculateAppStats(filteredApps)

		basicData := map[string]interface{}{
			"apps":      filteredApps,
			"stats":     stats,
			"fromCache": true,
		}
		if app := application.Get(); app != nil {
			app.Event.Emit("app-list-cache", basicData)
		}
	}

	if !startAppListLoading() {
		return nil, nil
	}

	go func() {
		defer stopAppListLoading()
		_, _ = fetchAndUpdateAppList(ctx, connectKey, filter)
	}()

	if len(cachedApps) > 0 {
		apps := lo.Map(cachedApps, func(cached *CachedAppInfo, _ int) AppInfo {
			return AppInfo{
				PackageName: cached.PackageName,
				AppName:     cached.AppName,
				IsSystemApp: cached.IsSystemApp,
				IsRunning:   cached.IsRunning,
				IsEnabled:   true,
			}
		})
		filteredApps := filterApps(apps, filter)
		stats := calculateAppStats(filteredApps)

		return &AppListResult{
			Stats: stats,
			Apps:  filteredApps,
		}, nil
	}

	return nil, nil
}

func fetchAndUpdateAppList(ctx context.Context, connectKey string, filter string) (*AppListResult, error) {
	listChan := make(chan *HdcResult, 1)
	psChan := make(chan *HdcResult, 1)

	go func() {
		result, _ := ExecuteHdc([]string{"-t", connectKey, "shell", "bm", "dump", "-a", "-l"})
		listChan <- result
	}()

	go func() {
		result, _ := ExecuteHdc([]string{"-t", connectKey, "shell", "ps", "-A"})
		psChan <- result
	}()

	listResult := <-listChan
	psResult := <-psChan

	if listResult == nil || !listResult.Success || listResult.Output == "" {
		return &AppListResult{
			Stats: AppStats{},
			Apps:  []AppInfo{},
		}, nil
	}

	apps := parseAppList(listResult.Output)
	runningPackages := parseRunningPackages(psResult.Output)

	for i := range apps {
		apps[i].IsRunning = runningPackages[apps[i].PackageName]
	}

	stats := calculateAppStats(apps)
	filteredApps := filterApps(apps, filter)

	if ctx != nil {
		basicData := map[string]interface{}{
			"apps":  filteredApps,
			"stats": stats,
		}
		if app := application.Get(); app != nil {
			app.Event.Emit("app-list-basic", basicData)
		}
	}

	_ = BatchUpdateAppCache(filteredApps)

	go func() {
		thirdPartyApps := lo.Filter(filteredApps, func(app AppInfo, _ int) bool {
			return !app.IsSystemApp
		})
		systemApps := lo.Filter(filteredApps, func(app AppInfo, _ int) bool {
			return app.IsSystemApp
		})

		loadIconsWithDiskCache := func(appList []AppInfo) {
			for _, app := range appList {
				if ctx != nil && ctx.Err() != nil {
					return
				}

				cached := GetCachedAppInfo(app.PackageName)
				if cached != nil && cached.IconPath != "" {
					base64Icon, err := ReadIconAsBase64(app.PackageName)
					if err == nil && base64Icon != "" {
						if ctx != nil {
							iconData := map[string]interface{}{
								"packageName": app.PackageName,
								"icon":        base64Icon,
								"fromCache":   true,
							}
							if appInstance := application.Get(); appInstance != nil {
								appInstance.Event.Emit("app-icon-updated", iconData)
							}
						}
						continue
					}
				}

				onlineInfo, err := GetOnlineAppInfoWithDiskCache(app.PackageName, app.IsSystemApp)
				if err == nil && onlineInfo != nil && onlineInfo.Icon != "" {
					if ctx != nil {
						iconData := map[string]interface{}{
							"packageName": app.PackageName,
							"icon":        onlineInfo.Icon,
							"fromCache":   onlineInfo.FromCache,
						}
						if appInstance := application.Get(); appInstance != nil {
							appInstance.Event.Emit("app-icon-updated", iconData)
						}
					}
				}

				time.Sleep(100 * time.Millisecond)
			}
		}

		if len(thirdPartyApps) > 0 {
			loadIconsWithDiskCache(thirdPartyApps)
		}
		if len(systemApps) > 0 {
			loadIconsWithDiskCache(systemApps)
		}

		if ctx != nil {
			if appInstance := application.Get(); appInstance != nil {
				appInstance.Event.Emit("app-list-complete", map[string]interface{}{})
			}
		}
	}()

	return &AppListResult{
		Stats: stats,
		Apps:  filteredApps,
	}, nil
}

func GetAppListIncremental(ctx context.Context, connectKey string, filter string) (*AppListResult, error) {
	return GetAppListWithDiskCache(ctx, connectKey, filter)
}
