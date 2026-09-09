package adb

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"Hadice/backend/hdc"
)

// =============== 应用名+图标缓存 ===============

type cachedAppInfo struct {
	AppName string
	Icon    string // base64 data URL
}

var appInfoCache = struct {
	sync.RWMutex
	data map[string]*cachedAppInfo // key: "deviceSn:packageName"
}{data: make(map[string]*cachedAppInfo)}

// GetAppNameAndIconCached 获取 Android 应用名和图标（带内存缓存）
// 只在用户点击应用详情时调用，不在列表页批量调用
func GetAppNameAndIconCached(deviceSn string, packageName string) (string, string) {
	cacheKey := deviceSn + ":" + packageName

	appInfoCache.RLock()
	if cached, ok := appInfoCache.data[cacheKey]; ok {
		appInfoCache.RUnlock()
		return cached.AppName, cached.Icon
	}
	appInfoCache.RUnlock()

	// 缓存未命中：pull APK → aapt 解析 → 缓存
	appName, icon := fetchAppNameAndIcon(deviceSn, packageName)

	appInfoCache.Lock()
	appInfoCache.data[cacheKey] = &cachedAppInfo{
		AppName: appName,
		Icon:    icon,
	}
	appInfoCache.Unlock()

	return appName, icon
}

// fetchAppNameAndIcon 通过 pull APK + 本地 aapt 解析获取应用名和图标
func fetchAppNameAndIcon(deviceSn string, packageName string) (string, string) {
	// 1. 获取 APK 路径
	apkPath, err := GetAppPath(deviceSn, packageName)
	if err != nil {
		return packageName, ""
	}

	// 2. Pull APK 到临时文件
	tmpDir := os.TempDir()
	localApk := filepath.Join(tmpDir, packageName+".apk")
	defer os.Remove(localApk)

	_, err = PullFileFromDevice(deviceSn, apkPath, localApk)
	if err != nil {
		return packageName, ""
	}

	// 3. 用本地 aapt 解析
	aaptPath := GetAaptPath()
	if aaptPath == "" {
		return packageName, ""
	}

	appName := packageName
	iconBase64 := ""

	// 解析应用名和图标路径
	badgingOut, _ := exec.Command(aaptPath, "dump", "badging", localApk).CombinedOutput()
	labelRe := regexp.MustCompile(`application: label='([^']*)'`)
	if m := labelRe.FindSubmatch(badgingOut); len(m) > 1 && string(m[1]) != "" {
		appName = string(m[1])
	}

	iconRe := regexp.MustCompile(`application:.*icon='([^']*)'`)
	if m := iconRe.FindSubmatch(badgingOut); len(m) > 1 {
		iconPath := string(m[1])
		iconData, err := extractIconFromApk(localApk, iconPath)
		if err == nil && iconData != "" {
			iconBase64 = iconData
		}
	}

	return appName, iconBase64
}

// =============== 应用详情 ===============

// GetAppFullDetail 通过 dumpsys package 获取 Android 应用完整详情
func GetAppFullDetail(deviceSn string, packageName string) (*hdc.AppFullDetail, error) {
	result, err := ExecuteAdbWithTimeout([]string{"-s", deviceSn, "shell", "dumpsys", "package", packageName}, 15*time.Second)
	if err != nil {
		return nil, err
	}

	if !result.Success || result.Output == "" {
		return nil, fmt.Errorf("获取应用详情失败: %s", packageName)
	}

	output := result.Output
	detail := &hdc.AppFullDetail{
		PackageName: packageName,
	}

	if m := regexp.MustCompile(`versionName=([^\s]+)`).FindStringSubmatch(output); len(m) > 1 {
		detail.VersionName = m[1]
	}
	// versionCode=1207020604 minSdk=24 targetSdk=35
	if m := regexp.MustCompile(`versionCode=(\d+)\s+minSdk=(\d+)\s+targetSdk=(\d+)`).FindStringSubmatch(output); len(m) > 3 {
		detail.VersionCode, _ = strconv.Atoi(m[1])
		detail.MinSdkVersion, _ = strconv.Atoi(m[2])
		detail.TargetVersion, _ = strconv.Atoi(m[3])
	}
	// firstInstallTime=2026-02-12 23:20:18 (日期字符串格式)
	if m := regexp.MustCompile(`firstInstallTime=(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})`).FindStringSubmatch(output); len(m) > 1 {
		if t, err := time.Parse("2006-01-02 15:04:05", m[1]); err == nil {
			detail.FirstInstallTime = t.UnixMilli()
			detail.InstallTime = t.UnixMilli()
		}
	}
	// lastUpdateTime=2026-02-12 23:20:18
	if m := regexp.MustCompile(`lastUpdateTime=(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})`).FindStringSubmatch(output); len(m) > 1 {
		if t, err := time.Parse("2006-01-02 15:04:05", m[1]); err == nil {
			detail.UpdateTime = t.UnixMilli()
		}
	}
	// 系统应用: flags=[ SYSTEM HAS_CODE ] 或 pkgFlags=[ SYSTEM ... ]
	if m := regexp.MustCompile(`flags=\[\s*([^\]]*)\]`).FindStringSubmatch(output); len(m) > 1 {
		detail.IsSystemApp = strings.Contains(m[1], "SYSTEM")
	}
	// enabled 状态在 User 0 行中: enabled=0 表示已启用，enabled=2 或 enabled=3 表示禁用
	// User 0: ... enabled=0 ...
	if m := regexp.MustCompile(`User 0:.*?enabled=(\d+)`).FindStringSubmatch(output); len(m) > 1 {
		enabled, _ := strconv.Atoi(m[1])
		detail.IsEnabled = enabled == 0
	}
	if m := regexp.MustCompile(`codePath=(\S+)`).FindStringSubmatch(output); len(m) > 1 {
		detail.CodePath = m[1]
	}
	// User ID: 从 User 0 行中获取，或从 userId= 字段
	// 在 dumpsys 中 userId 不直接出现在 Package 段中，用 appId
	if m := regexp.MustCompile(`appId=(\d+)`).FindStringSubmatch(output); len(m) > 1 {
		detail.Uid, _ = strconv.Atoi(m[1])
	}

	detail.Permissions = parseAndroidPermissions(output)
	detail.Abilities = parseAndroidActivities(output)

	return detail, nil
}

func parseAndroidPermissions(output string) []hdc.PermissionInfo {
	var perms []hdc.PermissionInfo
	seen := make(map[string]bool)

	// 匹配 install permissions 和 runtime permissions 中的权限行
	re := regexp.MustCompile(`^[\s]+(- )?(android\.[\w.]+)$`)
	lines := strings.Split(output, "\n")
	for _, line := range lines {
		if m := re.FindStringSubmatch(line); len(m) > 2 {
			name := m[2]
			if !seen[name] {
				seen[name] = true
				perms = append(perms, hdc.PermissionInfo{Name: name})
			}
		}
	}
	return perms
}

func parseAndroidActivities(output string) []hdc.AbilityInfo {
	var activities []hdc.AbilityInfo
	seen := make(map[string]bool)

	re := regexp.MustCompile(`([a-zA-Z][a-zA-Z0-9_.]*(?:\$[a-zA-Z0-9_]+)*) filter [0-9a-f]+`)
	matches := re.FindAllStringSubmatch(output, -1)
	for _, m := range matches {
		if len(m) > 1 && !seen[m[1]] {
			seen[m[1]] = true
			label := m[1]
			if idx := strings.LastIndex(label, "."); idx != -1 {
				label = label[idx+1:]
			}
			activities = append(activities, hdc.AbilityInfo{
				Name:  m[1],
				Label: label,
			})
		}
	}
	return activities
}

// =============== 运行中的应用 ===============

// GetRunningRecords 获取 Android 运行中的应用记录
func GetRunningRecords(deviceSn string) ([]hdc.RunningRecord, error) {
	result, err := ExecuteAdbWithTimeout([]string{"-s", deviceSn, "shell", "ps"}, 10*time.Second)
	if err != nil {
		return nil, err
	}

	var records []hdc.RunningRecord
	lines := strings.Split(result.Output, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "USER") {
			continue
		}
		fields := regexp.MustCompile(`\s+`).Split(line, -1)
		if len(fields) < 9 {
			continue
		}
		pkgName := fields[8]
		if !strings.Contains(pkgName, ".") || strings.HasPrefix(pkgName, "[") {
			continue
		}
		pid, _ := strconv.Atoi(fields[1])
		uid, _ := strconv.Atoi(fields[0])
		records = append(records, hdc.RunningRecord{
			ProcessName: pkgName,
			PID:         pid,
			UID:         uid,
		})
	}
	return records, nil
}

// =============== 快捷方式 ===============

// GetAppShortcuts Android 没有 HarmonyOS 风格的 shortcuts
func GetAppShortcuts(deviceSn string, packageName string) ([]hdc.ShortcutInfo, error) {
	return []hdc.ShortcutInfo{}, nil
}

// =============== 任务列表 ===============

// GetRecentTasks 获取 Android 最近任务列表
func GetRecentTasks(deviceSn string) ([]hdc.MissionInfo, error) {
	result, err := ExecuteAdbWithTimeout([]string{"-s", deviceSn, "shell", "dumpsys", "activity", "activities"}, 15*time.Second)
	if err != nil {
		return nil, err
	}

	var tasks []hdc.MissionInfo
	taskRe := regexp.MustCompile(`Task #(\d+).*affinity=(\S+)`)
	for _, line := range strings.Split(result.Output, "\n") {
		if m := taskRe.FindStringSubmatch(line); len(m) > 2 {
			taskID, _ := strconv.Atoi(m[1])
			tasks = append(tasks, hdc.MissionInfo{
				MissionID:       taskID,
				MissionAffinity: m[2],
			})
			if len(tasks) >= 20 {
				break
			}
		}
	}
	return tasks, nil
}

// ClearAppCache 清除 Android 应用缓存
func ClearAppCache(deviceSn string, packageName string) error {
	ExecuteAdb([]string{"-s", deviceSn, "shell", "rm", "-rf",
		fmt.Sprintf("/data/data/%s/cache", packageName)})
	return nil
}
