package hdc

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/samber/lo"
)

// parseAppDetail 解析应用详情输出（JSON格式）
func parseAppDetail(output string, packageName string, isSystemApp bool) (*AppInfo, error) {
	// 查找 JSON 开始位置
	jsonStart := strings.Index(output, "{")
	if jsonStart == -1 {
		return nil, fmt.Errorf("未找到JSON数据")
	}

	jsonStr := output[jsonStart:]
	var data map[string]interface{}
	if err := json.Unmarshal([]byte(jsonStr), &data); err != nil {
		return nil, fmt.Errorf("解析JSON失败: %v", err)
	}

	app := &AppInfo{
		PackageName: packageName,
		IsSystemApp: isSystemApp,
		IsEnabled:   true,
	}

	// 提取应用名称（优先从多个地方获取）
	appName := extractAppName(data, isSystemApp, packageName)
	if appName != "" {
		app.AppName = appName
	} else {
		app.AppName = packageName // 默认使用包名
	}

	// 提取版本信息
	versionName, versionCode := extractVersionInfo(data)
	if versionName != "" && versionCode > 0 {
		app.Version = fmt.Sprintf("%s (%d)", versionName, versionCode)
		app.VersionCode = versionCode
	} else if versionName != "" {
		app.Version = versionName
	} else if versionCode > 0 {
		app.Version = fmt.Sprintf("(%d)", versionCode)
		app.VersionCode = versionCode
	}

	// 提取安装时间
	if installTime, ok := data["installTime"].(float64); ok {
		app.InstallTime = int64(installTime)
	}

	// 提取是否启用
	if appInfo, ok := data["applicationInfo"].(map[string]interface{}); ok {
		if enabled, ok := appInfo["enabled"].(bool); ok {
			app.IsEnabled = enabled
		}
		if isSysApp, ok := appInfo["isSystemApp"].(bool); ok {
			app.IsSystemApp = isSysApp
		}
	}

	// 提取大小（暂时设为0，因为获取大小需要额外命令）
	app.Size = 0

	return app, nil
}

// extractAppName 从数据中提取应用名称
func extractAppName(data map[string]interface{}, isSystemApp bool, packageName string) string {
	appName := ""

	// 方法1: 从 hapModuleInfos 中查找 label
	if hapModules, ok := data["hapModuleInfos"].([]interface{}); ok && len(hapModules) > 0 {
		if mainModule, ok := hapModules[0].(map[string]interface{}); ok {
			if label, ok := mainModule["label"].(string); ok && label != "" && !strings.HasPrefix(label, "$") {
				appName = label
			}
		}
	}

	// 方法2: 从 applicationInfo.label 获取
	if appName == "" {
		if appInfo, ok := data["applicationInfo"].(map[string]interface{}); ok {
			if label, ok := appInfo["label"].(string); ok && label != "" && !strings.HasPrefix(label, "$") {
				appName = label
			}
		}
	}

	// 方法3: 从 abilityInfos 中查找
	if appName == "" {
		if hapModules, ok := data["hapModuleInfos"].([]interface{}); ok && len(hapModules) > 0 {
			if mainModule, ok := hapModules[0].(map[string]interface{}); ok {
				if abilities, ok := mainModule["abilityInfos"].([]interface{}); ok && len(abilities) > 0 {
					// 优先查找 launcher ability
					for _, ability := range abilities {
						if ab, ok := ability.(map[string]interface{}); ok {
							if isLauncher, ok := ab["isLauncherAbility"].(bool); ok && isLauncher {
								if label, ok := ab["label"].(string); ok && label != "" && !strings.HasPrefix(label, "$") {
									appName = label
									break
								}
							}
						}
					}
					// 如果没有找到 launcher ability，使用第一个 ability
					if appName == "" {
						if firstAbility, ok := abilities[0].(map[string]interface{}); ok {
							if label, ok := firstAbility["label"].(string); ok && label != "" && !strings.HasPrefix(label, "$") {
								appName = label
							}
						}
					}
				}
			}
		}
	}

	// 对于非系统应用，如果本地没有找到名称，尝试从网络获取
	if !isSystemApp && appName == "" {
		if onlineInfo, err := GetOnlineAppInfo(packageName); err == nil {
			if onlineInfo.Name != "" {
				appName = onlineInfo.Name
			}
		}
	}

	return appName
}

// extractVersionInfo 从数据中提取版本信息
func extractVersionInfo(data map[string]interface{}) (string, int) {
	versionName := ""
	versionCode := 0

	if appInfo, ok := data["applicationInfo"].(map[string]interface{}); ok {
		if vn, ok := appInfo["versionName"].(string); ok {
			versionName = vn
		}
		if vc, ok := appInfo["versionCode"].(float64); ok {
			versionCode = int(vc)
		}
	}

	// 如果 applicationInfo 中没有，从根级别获取
	if versionName == "" {
		if vn, ok := data["versionName"].(string); ok {
			versionName = vn
		}
	}
	if versionCode == 0 {
		if vc, ok := data["versionCode"].(float64); ok {
			versionCode = int(vc)
		}
	}

	return versionName, versionCode
}

// findLauncherAbility 查找应用的 launcher ability
func findLauncherAbility(data map[string]interface{}) string {
	if hapModules, ok := data["hapModuleInfos"].([]interface{}); ok {
		for _, module := range hapModules {
			if moduleMap, ok := module.(map[string]interface{}); ok {
				if abilities, ok := moduleMap["abilityInfos"].([]interface{}); ok {
					// 优先查找 launcher ability
					for _, ability := range abilities {
						if abilityMap, ok := ability.(map[string]interface{}); ok {
							if isLauncher, ok := abilityMap["isLauncherAbility"].(bool); ok && isLauncher {
								if name, ok := abilityMap["name"].(string); ok && name != "" {
									return name
								}
							}
						}
					}
					// 如果没有找到 launcher ability，使用第一个 ability
					if len(abilities) > 0 {
						if firstAbility, ok := abilities[0].(map[string]interface{}); ok {
							if name, ok := firstAbility["name"].(string); ok && name != "" {
								return name
							}
						}
					}
				}
			}
		}
	}
	return ""
}

// StartApp 启动应用
func StartApp(connectKey string, packageName string) (*HdcResult, error) {
	// 首先尝试获取应用的 launcher ability（增加超时时间到15秒）
	detailResult, err := ExecuteHdcWithTimeout([]string{"-t", connectKey, "shell", "bm", "dump", "-n", packageName}, 15*time.Second)
	if err == nil && detailResult != nil && detailResult.Success {
		// 解析 JSON 查找 launcher ability
		jsonStart := strings.Index(detailResult.Output, "{")
		if jsonStart != -1 {
			jsonStr := detailResult.Output[jsonStart:]
			var data map[string]interface{}
			if err := json.Unmarshal([]byte(jsonStr), &data); err == nil {
				abilityName := findLauncherAbility(data)
				if abilityName != "" {
					result, err := ExecuteHdc([]string{"-t", connectKey, "shell", "aa", "start", "-a", abilityName, "-b", packageName})
					if err == nil && result != nil && !containsStartError(result.Output) {
						return &HdcResult{Success: true, Output: "应用已启动"}, nil
					}
					// 如果能找到 ability 但启动失败，直接返回错误，不再尝试其他名称
					if result != nil {
						errorMsg := result.Output
						if errorMsg == "" {
							errorMsg = result.Error
						}
						return &HdcResult{
							Success: false,
							Error:   errorMsg,
							Output:  result.Output,
						}, fmt.Errorf("启动失败: %s", errorMsg)
					}
				}
			}
		}
	}

	// 如果无法获取 launcher ability，只尝试 EntryAbility 一次
	result, err := ExecuteHdc([]string{"-t", connectKey, "shell", "aa", "start", "-a", "EntryAbility", "-b", packageName})
	if err != nil {
		return &HdcResult{Success: false, Error: err.Error()}, err
	}
	if result != nil && !containsStartError(result.Output) {
		return &HdcResult{Success: true, Output: "应用已启动"}, nil
	}

	errorMsg := "启动失败"
	if result != nil && result.Output != "" {
		errorMsg = result.Output
	} else if result != nil && result.Error != "" {
		errorMsg = result.Error
	}

	return &HdcResult{
		Success: false,
		Error:   errorMsg,
		Output:  result.Output,
	}, fmt.Errorf("启动失败: %s", errorMsg)
}

// containsStartError 检查启动命令输出是否包含错误信息
func containsStartError(output string) bool {
	lowerOutput := strings.ToLower(output)
	return strings.Contains(lowerOutput, "error: failed to start") ||
		strings.Contains(lowerOutput, "resolve ability err") ||
		strings.Contains(lowerOutput, "bundle not found") ||
		strings.Contains(lowerOutput, "ability not found") ||
		strings.Contains(lowerOutput, "permission denied")
}

// StopApp 停止应用
func StopApp(connectKey string, packageName string) (*HdcResult, error) {
	result, err := ExecuteHdc([]string{"-t", connectKey, "shell", "aa", "force-stop", packageName})
	if err != nil {
		return &HdcResult{Success: false, Error: err.Error()}, err
	}
	if result != nil && result.Success {
		return &HdcResult{Success: true, Output: "应用已停止"}, nil
	}
	return &HdcResult{
		Success: false,
		Error:   result.Error,
		Output:  result.Output,
	}, fmt.Errorf("停止失败: %s", result.Error)
}

// ClearAppData 清除应用数据
func ClearAppData(connectKey string, packageName string) (*HdcResult, error) {
	result, err := ExecuteHdc([]string{"-t", connectKey, "shell", "bm", "clean", "-d", "-n", packageName})
	if err != nil {
		return &HdcResult{Success: false, Error: err.Error()}, err
	}
	if result != nil && result.Success {
		return &HdcResult{Success: true, Output: "应用数据已清除"}, nil
	}
	return &HdcResult{
		Success: false,
		Error:   result.Error,
		Output:  result.Output,
	}, fmt.Errorf("清除失败: %s", result.Error)
}

// ClearAppCache 清除应用缓存
func ClearAppCache(connectKey string, packageName string) (*HdcResult, error) {
	result, err := ExecuteHdc([]string{"-t", connectKey, "shell", "bm", "clean", "-c", "-n", packageName})
	if err != nil {
		return &HdcResult{Success: false, Error: err.Error()}, err
	}
	if result != nil && result.Success {
		return &HdcResult{Success: true, Output: "应用缓存已清除"}, nil
	}
	return &HdcResult{
		Success: false,
		Error:   result.Error,
		Output:  result.Output,
	}, fmt.Errorf("清除缓存失败: %s", result.Error)
}

// UninstallApp 卸载应用
func UninstallApp(connectKey string, packageName string) (*HdcResult, error) {
	result, err := ExecuteHdc([]string{"-t", connectKey, "shell", "bm", "uninstall", "-n", packageName})
	if err != nil {
		return &HdcResult{Success: false, Error: err.Error()}, err
	}
	if result != nil && result.Success {
		return &HdcResult{Success: true, Output: "应用已卸载"}, nil
	}
	return &HdcResult{
		Success: false,
		Error:   result.Error,
		Output:  result.Output,
	}, fmt.Errorf("卸载失败: %s", result.Error)
}

// InstallApp 安装应用
func InstallApp(connectKey string, filePath string, replace bool, sharedBundle bool) (*HdcResult, error) {
	args := []string{"-t", connectKey, "install", filePath}
	if replace {
		args = append(args, "-r")
	}
	if sharedBundle {
		args = append(args, "-s")
	}

	// 安装可能需要较长时间，使用120秒超时
	result, err := ExecuteHdcWithTimeout(args, 120*time.Second)
	if err != nil {
		return &HdcResult{Success: false, Error: err.Error()}, err
	}

	if result != nil {
		// 合并输出和错误信息
		fullOutput := result.Output
		if result.Error != "" {
			fullOutput = fullOutput + "\n" + result.Error
		}
		fullOutput = strings.TrimSpace(fullOutput)
		outputLower := strings.ToLower(fullOutput)

		// 根据输出内容判断是否成功
		success := result.Success && (strings.Contains(outputLower, "success") ||
			(!strings.Contains(outputLower, "error") && !strings.Contains(outputLower, "fail") && fullOutput != ""))

		return &HdcResult{
			Success: success,
			Output:  result.Output,
			Error:   result.Error,
		}, nil
	}

	return &HdcResult{Success: false, Error: "安装失败"}, fmt.Errorf("安装失败")
}

// GetAppShortcuts 获取应用快捷方式
func GetAppShortcuts(connectKey string, packageName string) ([]ShortcutInfo, error) {
	// 使用 -s 参数获取快捷方式信息
	result, err := ExecuteHdcWithTimeout([]string{"-t", connectKey, "shell", "bm", "dump", "-s", "-n", packageName}, 15*time.Second)
	if err != nil {
		return nil, err
	}

	if !result.Success || result.Output == "" {
		return []ShortcutInfo{}, nil
	}

	// 解析输出（格式为多个 JSON 对象，每个以 "shortcut": 开头）
	var shortcuts []ShortcutInfo

	// 查找所有快捷方式 JSON 块
	output := result.Output
	for {
		// 查找 "shortcut": 关键字
		shortcutIdx := strings.Index(output, "\"shortcut\":")
		if shortcutIdx == -1 {
			break
		}

		// 查找 JSON 开始位置
		jsonStart := strings.Index(output[shortcutIdx:], "{")
		if jsonStart == -1 {
			break
		}
		jsonStart += shortcutIdx

		// 查找 JSON 结束位置
		jsonEnd := jsonStart + 1
		braceCount := 1
		for jsonEnd < len(output) && braceCount > 0 {
			if output[jsonEnd] == '{' {
				braceCount++
			} else if output[jsonEnd] == '}' {
				braceCount--
			}
			jsonEnd++
		}

		// 解析 JSON
		jsonStr := output[jsonStart:jsonEnd]
		var shortcutMap map[string]interface{}
		if err := json.Unmarshal([]byte(jsonStr), &shortcutMap); err == nil {
			shortcutInfo := parseShortcutMap(shortcutMap)
			if shortcutInfo.ID != "" {
				shortcuts = append(shortcuts, shortcutInfo)
			}
		}

		// 继续查找下一个快捷方式
		output = output[jsonEnd:]
	}

	return shortcuts, nil
}

// parseShortcutMap 解析快捷方式map
func parseShortcutMap(shortcutMap map[string]interface{}) ShortcutInfo {
	shortcutInfo := ShortcutInfo{Intents: []interface{}{}}
	if id, ok := shortcutMap["id"].(string); ok {
		shortcutInfo.ID = id
	}
	if label, ok := shortcutMap["label"].(string); ok {
		shortcutInfo.Label = label
	}
	if labelId, ok := shortcutMap["labelId"].(float64); ok {
		shortcutInfo.LabelID = int(labelId)
	}
	if icon, ok := shortcutMap["icon"].(string); ok {
		shortcutInfo.Icon = icon
	}
	if iconId, ok := shortcutMap["iconId"].(float64); ok {
		shortcutInfo.IconID = int(iconId)
	}
	if bundleName, ok := shortcutMap["bundleName"].(string); ok {
		shortcutInfo.BundleName = bundleName
	}
	if moduleName, ok := shortcutMap["moduleName"].(string); ok {
		shortcutInfo.ModuleName = moduleName
	}
	if isEnables, ok := shortcutMap["isEnables"].(bool); ok {
		shortcutInfo.IsEnables = isEnables
	}
	if isHomeShortcut, ok := shortcutMap["isHomeShortcut"].(bool); ok {
		shortcutInfo.IsHomeShortcut = isHomeShortcut
	}
	if isStatic, ok := shortcutMap["isStatic"].(bool); ok {
		shortcutInfo.IsStatic = isStatic
	}
	if intents, ok := shortcutMap["intents"].([]interface{}); ok {
		shortcutInfo.Intents = intents
	}
	return shortcutInfo
}

// GetMissionList 获取任务列表
func GetMissionList(connectKey string) ([]MissionInfo, error) {
	result, err := ExecuteHdcWithTimeout([]string{"-t", connectKey, "shell", "aa", "dump"}, 15*time.Second)
	if err != nil {
		return nil, err
	}

	if !result.Success || result.Output == "" {
		return []MissionInfo{}, nil
	}

	// 解析 JSON 输出
	jsonStart := strings.Index(result.Output, "{")
	if jsonStart == -1 {
		return []MissionInfo{}, nil
	}

	jsonStr := result.Output[jsonStart:]
	var data map[string]interface{}
	if err := json.Unmarshal([]byte(jsonStr), &data); err != nil {
		return nil, fmt.Errorf("解析JSON失败: %v", err)
	}

	// 从 missionList 中提取任务信息（使用lo.FilterMap优化）
	missionList, _ := data["missionList"].([]interface{})
	missions := lo.FilterMap(missionList, func(mission interface{}, _ int) (MissionInfo, bool) {
		missionMap, ok := mission.(map[string]interface{})
		if !ok {
			return MissionInfo{}, false
		}
		missionInfo := parseMissionMap(missionMap)
		return missionInfo, true
	})

	return missions, nil
}

// parseMissionMap 解析任务map
func parseMissionMap(missionMap map[string]interface{}) MissionInfo {
	missionInfo := MissionInfo{AbilityRecords: []AbilityRecord{}}
	if missionId, ok := missionMap["missionId"].(float64); ok {
		missionInfo.MissionID = int(missionId)
	}
	if missionName, ok := missionMap["missionName"].(string); ok {
		missionInfo.MissionName = missionName
	}
	if lockedState, ok := missionMap["lockedState"].(float64); ok {
		missionInfo.LockedState = int(lockedState)
	}
	if missionAffinity, ok := missionMap["missionAffinity"].(string); ok {
		missionInfo.MissionAffinity = missionAffinity
	}
	// 提取能力记录（使用lo.FilterMap优化）
	if abilityRecords, ok := missionMap["abilityRecords"].([]interface{}); ok {
		missionInfo.AbilityRecords = lo.FilterMap(abilityRecords, func(ar interface{}, _ int) (AbilityRecord, bool) {
			arMap, ok := ar.(map[string]interface{})
			if !ok {
				return AbilityRecord{}, false
			}
			return parseAbilityRecordMap(arMap), true
		})
	}
	return missionInfo
}

// parseAbilityRecordMap 解析能力记录map
func parseAbilityRecordMap(arMap map[string]interface{}) AbilityRecord {
	ar := AbilityRecord{}
	if abilityRecordId, ok := arMap["abilityRecordId"].(float64); ok {
		ar.AbilityRecordID = int(abilityRecordId)
	}
	if appName, ok := arMap["appName"].(string); ok {
		ar.AppName = appName
	}
	if mainName, ok := arMap["mainName"].(string); ok {
		ar.MainName = mainName
	}
	if bundleName, ok := arMap["bundleName"].(string); ok {
		ar.BundleName = bundleName
	}
	if abilityType, ok := arMap["abilityType"].(float64); ok {
		ar.AbilityType = int(abilityType)
	}
	if state, ok := arMap["state"].(float64); ok {
		ar.State = int(state)
	}
	if startTime, ok := arMap["startTime"].(float64); ok {
		ar.StartTime = int64(startTime)
	}
	if appState, ok := arMap["appState"].(float64); ok {
		ar.AppState = int(appState)
	}
	if ready, ok := arMap["ready"].(bool); ok {
		ar.Ready = ready
	}
	if windowAttached, ok := arMap["windowAttached"].(bool); ok {
		ar.WindowAttached = windowAttached
	}
	if launcher, ok := arMap["launcher"].(bool); ok {
		ar.Launcher = launcher
	}
	if isKeepAlive, ok := arMap["isKeepAlive"].(bool); ok {
		ar.IsKeepAlive = isKeepAlive
	}
	return ar
}

// GetAppRunningRecords 获取运行中的应用记录
func GetAppRunningRecords(connectKey string) ([]RunningRecord, error) {
	result, err := ExecuteHdcWithTimeout([]string{"-t", connectKey, "shell", "aa", "dump"}, 15*time.Second)
	if err != nil {
		return nil, err
	}

	if !result.Success || result.Output == "" {
		return []RunningRecord{}, nil
	}

	// 解析 JSON 输出
	jsonStart := strings.Index(result.Output, "{")
	if jsonStart == -1 {
		return []RunningRecord{}, nil
	}

	jsonStr := result.Output[jsonStart:]
	var data map[string]interface{}
	if err := json.Unmarshal([]byte(jsonStr), &data); err != nil {
		return nil, fmt.Errorf("解析JSON失败: %v", err)
	}

	// 从 abilityRecordList 中提取运行中的应用记录（使用lo.FilterMap优化）
	abilityRecordList, _ := data["abilityRecordList"].([]interface{})
	records := lo.FilterMap(abilityRecordList, func(record interface{}, _ int) (RunningRecord, bool) {
		recordMap, ok := record.(map[string]interface{})
		if !ok {
			return RunningRecord{}, false
		}
		return parseRunningRecordMap(recordMap), true
	})

	return records, nil
}

// parseRunningRecordMap 解析运行记录map
func parseRunningRecordMap(recordMap map[string]interface{}) RunningRecord {
	runningRecord := RunningRecord{
		UIExtensionProviders: []Provider{},
		RootCallers:          []Caller{},
	}
	if recordId, ok := recordMap["recordId"].(float64); ok {
		runningRecord.RecordID = int(recordId)
	}
	if processName, ok := recordMap["processName"].(string); ok {
		runningRecord.ProcessName = processName
	}
	if pid, ok := recordMap["pid"].(float64); ok {
		runningRecord.PID = int(pid)
	}
	if uid, ok := recordMap["uid"].(float64); ok {
		runningRecord.UID = int(uid)
	}
	if state, ok := recordMap["state"].(float64); ok {
		runningRecord.State = int(state)
	}
	// 提取 UI 扩展提供者（使用lo.FilterMap优化）
	if uiExtensionProviders, ok := recordMap["uiExtensionProviders"].([]interface{}); ok {
		runningRecord.UIExtensionProviders = lo.FilterMap(uiExtensionProviders, func(provider interface{}, _ int) (Provider, bool) {
			providerMap, ok := provider.(map[string]interface{})
			if !ok {
				return Provider{}, false
			}
			p := Provider{}
			if pid, ok := providerMap["pid"].(float64); ok {
				p.PID = int(pid)
			}
			return p, true
		})
	}
	// 提取根调用者（使用lo.FilterMap优化）
	if rootCallers, ok := recordMap["rootCallers"].([]interface{}); ok {
		runningRecord.RootCallers = lo.FilterMap(rootCallers, func(caller interface{}, _ int) (Caller, bool) {
			callerMap, ok := caller.(map[string]interface{})
			if !ok {
				return Caller{}, false
			}
			c := Caller{}
			if pid, ok := callerMap["pid"].(float64); ok {
				c.PID = int(pid)
			}
			return c, true
		})
	}
	return runningRecord
}
