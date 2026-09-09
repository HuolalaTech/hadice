package hdc

import (
	"archive/zip"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
)

// ParseHapAppInfo 解析 HAP 应用信息
// HAP 文件是 ZIP 格式，需要提取 module.json 并解析
func ParseHapAppInfo(hapFilePath string) (*HapAppInfo, error) {
	// 获取文件大小
	fileInfo, err := os.Stat(hapFilePath)
	if err != nil {
		return nil, fmt.Errorf("无法读取文件: %v", err)
	}
	fileSize := fileInfo.Size()

	// 打开 ZIP 文件
	zipReader, err := zip.OpenReader(hapFilePath)
	if err != nil {
		return nil, fmt.Errorf("无法打开 HAP 文件（ZIP格式）: %v", err)
	}
	defer zipReader.Close()

	// 查找 module.json 文件
	var moduleJsonData []byte
	for _, file := range zipReader.File {
		if file.Name == "module.json" || file.Name == "entry/module.json" {
			rc, err := file.Open()
			if err != nil {
				continue
			}
			moduleJsonData, err = io.ReadAll(rc)
			rc.Close()
			if err != nil {
				continue
			}
			break
		}
	}

	if moduleJsonData == nil {
		return nil, fmt.Errorf("未找到 module.json 文件")
	}

	// 解析 JSON
	var moduleJson map[string]interface{}
	if err := json.Unmarshal(moduleJsonData, &moduleJson); err != nil {
		return nil, fmt.Errorf("解析 module.json 失败: %v", err)
	}

	// 提取应用信息
	app := getMapValue(moduleJson, "app", map[string]interface{}{})
	module := getMapValue(moduleJson, "module", map[string]interface{}{})

	// 运行 restool dump 命令获取 resdump 数据
	var resdump *ResdumpJson
	resdumpResult, err := RunRestoolDump(hapFilePath)
	if err == nil && resdumpResult != nil {
		resdump = resdumpResult
	}

	// 提取应用名称（优先从资源引用中解析）
	appName := getStringValue(app, "label", "")
	if appName == "" {
		appName = "Unknown"
	} else if resdump != nil {
		// 如果 app.label 是资源引用格式（如 "$string:app_name"），从 resdump 中查找
		resourceValue := FindResourceValue(resdump, appName, "zh", "CN")
		if resourceValue == "" {
			resourceValue = FindResourceValue(resdump, appName, "zh", "")
		}
		if resourceValue == "" {
			resourceValue = FindResourceValue(resdump, appName, "", "")
		}
		if resourceValue != "" {
			appName = resourceValue
		}
	}

	// 如果还没有找到，尝试通过 labelId 查找
	if (appName == "" || appName == "Unknown") && resdump != nil {
		if labelId, ok := app["labelId"].(float64); ok {
			labelIdInt := int(labelId)
			resourceValue := FindResourceValueById(resdump, labelIdInt, "zh", "CN")
			if resourceValue == "" {
				resourceValue = FindResourceValueById(resdump, labelIdInt, "zh", "")
			}
			if resourceValue == "" {
				resourceValue = FindResourceValueById(resdump, labelIdInt, "", "")
			}
			if resourceValue != "" {
				appName = resourceValue
			}
		}
	}

	if appName == "" || appName == "Unknown" {
		appName = getStringValue(app, "bundleName", "Unknown")
	}

	bundleName := getStringValue(app, "bundleName", "unknown")
	versionName := getStringValue(app, "versionName", "1.0.0")
	versionCode := getIntValue(app, "versionCode", 1)
	vendor := getStringValue(app, "vendor", "Unknown")
	moduleName := getStringValue(module, "name", "entry")
	moduleDescription := getStringValue(module, "description", "")

	// 如果 module.description 是资源引用格式，从 resdump 中查找
	if moduleDescription != "" && resdump != nil {
		resourceValue := FindResourceValue(resdump, moduleDescription, "zh", "CN")
		if resourceValue == "" {
			resourceValue = FindResourceValue(resdump, moduleDescription, "zh", "")
		}
		if resourceValue == "" {
			resourceValue = FindResourceValue(resdump, moduleDescription, "", "")
		}
		if resourceValue != "" {
			moduleDescription = resourceValue
		}
	}

	// 如果还没有找到，尝试通过 descriptionId 查找
	if moduleDescription == "" && resdump != nil {
		if descriptionId, ok := module["descriptionId"].(float64); ok {
			descriptionIdInt := int(descriptionId)
			resourceValue := FindResourceValueById(resdump, descriptionIdInt, "zh", "CN")
			if resourceValue == "" {
				resourceValue = FindResourceValueById(resdump, descriptionIdInt, "zh", "")
			}
			if resourceValue == "" {
				resourceValue = FindResourceValueById(resdump, descriptionIdInt, "", "")
			}
			if resourceValue != "" {
				moduleDescription = resourceValue
			}
		}
	}

	// 提取 API 版本信息
	minAPIVersion := 0
	if val, ok := app["minAPIVersion"].(float64); ok {
		minAPIVersion = int(val)
	}
	targetAPIVersion := 0
	if val, ok := app["targetAPIVersion"].(float64); ok {
		targetAPIVersion = int(val)
	}

	// 提取编译信息
	compileSdkVersion := getStringValue(app, "compileSdkVersion", "")
	compileMode := getStringValue(module, "compileMode", "")
	virtualMachine := getStringValue(module, "virtualMachine", "")

	// 提取设备类型
	deviceTypes := []string{}
	if dt, ok := module["deviceTypes"].([]interface{}); ok {
		for _, dtItem := range dt {
			if dtStr, ok := dtItem.(string); ok {
				deviceTypes = append(deviceTypes, dtStr)
			}
		}
	}

	// 提取权限信息（包含更完整的权限信息）
	permissions := []map[string]interface{}{}
	if reqPermissions, ok := module["requestPermissions"].([]interface{}); ok {
		for _, perm := range reqPermissions {
			if permMap, ok := perm.(map[string]interface{}); ok {
				permInfo := map[string]interface{}{
					"name": getStringValue(permMap, "name", ""),
				}
				if reason, ok := permMap["reason"].(string); ok && reason != "" {
					permInfo["reason"] = reason
				}
				// 提取使用场景信息
				if usedScene, ok := permMap["usedScene"].(map[string]interface{}); ok {
					sceneInfo := map[string]interface{}{}
					if when, ok := usedScene["when"].(string); ok && when != "" {
						sceneInfo["when"] = when
					}
					if abilities, ok := usedScene["abilities"].([]interface{}); ok && len(abilities) > 0 {
						abilityList := []string{}
						for _, ab := range abilities {
							if abStr, ok := ab.(string); ok {
								abilityList = append(abilityList, abStr)
							}
						}
						if len(abilityList) > 0 {
							sceneInfo["abilities"] = abilityList
						}
					}
					if len(sceneInfo) > 0 {
						permInfo["usedScene"] = sceneInfo
					}
				}
				permissions = append(permissions, permInfo)
			}
		}
	}

	// 提取能力信息（包含更完整的能力信息）
	abilities := []map[string]interface{}{}
	if abilitiesList, ok := module["abilities"].([]interface{}); ok {
		for _, ab := range abilitiesList {
			if abMap, ok := ab.(map[string]interface{}); ok {
				abilityInfo := map[string]interface{}{
					"name": getStringValue(abMap, "name", ""),
				}
				if label, ok := abMap["label"].(string); ok && label != "" {
					abilityInfo["label"] = label
				}
				if desc, ok := abMap["description"].(string); ok && desc != "" {
					abilityInfo["description"] = desc
				}
				if launchType, ok := abMap["launchType"].(string); ok && launchType != "" {
					abilityInfo["launchType"] = launchType
				}
				// 提取窗口模式
				if windowModes, ok := abMap["supportWindowMode"].([]interface{}); ok && len(windowModes) > 0 {
					modeList := []string{}
					for _, mode := range windowModes {
						if modeStr, ok := mode.(string); ok {
							modeList = append(modeList, modeStr)
						}
					}
					if len(modeList) > 0 {
						abilityInfo["supportWindowMode"] = modeList
					}
				}
				// 提取技能信息（URL Schemes等）
				if skills, ok := abMap["skills"].([]interface{}); ok && len(skills) > 0 {
					skillList := []map[string]interface{}{}
					for _, skill := range skills {
						if skillMap, ok := skill.(map[string]interface{}); ok {
							skillInfo := map[string]interface{}{}
							// 提取 actions
							if actions, ok := skillMap["actions"].([]interface{}); ok && len(actions) > 0 {
								actionList := []string{}
								for _, action := range actions {
									if actionStr, ok := action.(string); ok {
										actionList = append(actionList, actionStr)
									}
								}
								if len(actionList) > 0 {
									skillInfo["actions"] = actionList
								}
							}
							// 提取 entities
							if entities, ok := skillMap["entities"].([]interface{}); ok && len(entities) > 0 {
								entityList := []string{}
								for _, entity := range entities {
									if entityStr, ok := entity.(string); ok {
										entityList = append(entityList, entityStr)
									}
								}
								if len(entityList) > 0 {
									skillInfo["entities"] = entityList
								}
							}
							// 提取 uris
							if uris, ok := skillMap["uris"].([]interface{}); ok && len(uris) > 0 {
								uriList := []map[string]interface{}{}
								for _, uri := range uris {
									if uriMap, ok := uri.(map[string]interface{}); ok {
										uriInfo := map[string]interface{}{}
										if scheme, ok := uriMap["scheme"].(string); ok && scheme != "" {
											uriInfo["scheme"] = scheme
										}
										if host, ok := uriMap["host"].(string); ok && host != "" {
											uriInfo["host"] = host
										}
										if path, ok := uriMap["path"].(string); ok && path != "" {
											uriInfo["path"] = path
										}
										if len(uriInfo) > 0 {
											uriList = append(uriList, uriInfo)
										}
									}
								}
								if len(uriList) > 0 {
									skillInfo["uris"] = uriList
								}
							}
							if len(skillInfo) > 0 {
								skillList = append(skillList, skillInfo)
							}
						}
					}
					if len(skillList) > 0 {
						abilityInfo["skills"] = skillList
					}
				}
				abilities = append(abilities, abilityInfo)
			}
		}
	}

	// 提取应用图标
	var appIcon string
	var layeredIcon map[string]string

	// 策略1：优先从 ability.icon 获取
	iconRef := ""
	moduleAbilities := getSliceValue(module, "abilities", []interface{}{})
	if len(moduleAbilities) > 0 {
		mainElement := getStringValue(module, "mainElement", "")
		var targetAbility map[string]interface{}
		for _, ab := range moduleAbilities {
			if abMap, ok := ab.(map[string]interface{}); ok {
				if mainElement != "" && getStringValue(abMap, "name", "") == mainElement {
					targetAbility = abMap
					break
				}
			}
		}
		if targetAbility == nil && len(moduleAbilities) > 0 {
			if abMap, ok := moduleAbilities[0].(map[string]interface{}); ok {
				targetAbility = abMap
			}
		}
		if targetAbility != nil {
			iconRef = getStringValue(targetAbility, "icon", "")
		}
	}

	// 策略2：如果 ability 中没有，使用 app.icon
	if iconRef == "" {
		iconRef = getStringValue(app, "icon", "")
	}

	// 策略3：使用 resdump 获取准确路径
	if iconRef != "" && resdump != nil {
		iconPath := FindResourceValue(resdump, iconRef, "zh", "CN")
		if iconPath == "" {
			iconPath = FindResourceValue(resdump, iconRef, "zh", "")
		}
		if iconPath == "" {
			iconPath = FindResourceValue(resdump, iconRef, "", "")
		}
		if iconPath != "" {
			extractedIcon, err := extractIconFromHap(hapFilePath, iconPath, zipReader)
			if err == nil && extractedIcon != "" {
				if strings.HasPrefix(extractedIcon, "LAYERED_ICON_CONFIG:") {
					// 处理分层图标
					layeredIcon = parseLayeredIcon(hapFilePath, extractedIcon, resdump, zipReader)
				} else {
					appIcon = extractedIcon
				}
			}
		}
	}

	// 策略4：如果 resdump 失败，尝试通过 iconId 查找
	if appIcon == "" && layeredIcon == nil && resdump != nil {
		if iconId, ok := app["iconId"].(float64); ok {
			iconIdInt := int(iconId)
			iconPath := FindResourceValueById(resdump, iconIdInt, "zh", "CN")
			if iconPath == "" {
				iconPath = FindResourceValueById(resdump, iconIdInt, "zh", "")
			}
			if iconPath == "" {
				iconPath = FindResourceValueById(resdump, iconIdInt, "", "")
			}
			if iconPath != "" {
				extractedIcon, err := extractIconFromHap(hapFilePath, iconPath, zipReader)
				if err == nil && extractedIcon != "" {
					if strings.HasPrefix(extractedIcon, "LAYERED_ICON_CONFIG:") {
						layeredIcon = parseLayeredIcon(hapFilePath, extractedIcon, resdump, zipReader)
					} else {
						appIcon = extractedIcon
					}
				}
			}
		}
	}

	// 提取权限信息中的资源引用
	for i := range permissions {
		perm := permissions[i]
		if reason, ok := perm["reason"].(string); ok && reason != "" && resdump != nil {
			resourceValue := FindResourceValue(resdump, reason, "zh", "CN")
			if resourceValue == "" {
				resourceValue = FindResourceValue(resdump, reason, "zh", "")
			}
			if resourceValue == "" {
				resourceValue = FindResourceValue(resdump, reason, "", "")
			}
			if resourceValue != "" {
				perm["reason"] = resourceValue
			}
		}
		if reasonId, ok := perm["reasonId"].(float64); ok && resdump != nil {
			reasonIdInt := int(reasonId)
			resourceValue := FindResourceValueById(resdump, reasonIdInt, "zh", "CN")
			if resourceValue == "" {
				resourceValue = FindResourceValueById(resdump, reasonIdInt, "zh", "")
			}
			if resourceValue == "" {
				resourceValue = FindResourceValueById(resdump, reasonIdInt, "", "")
			}
			if resourceValue != "" {
				perm["reason"] = resourceValue
			}
		}
	}

	// 提取能力信息中的资源引用
	for i := range abilities {
		ability := abilities[i]
		if label, ok := ability["label"].(string); ok && label != "" && resdump != nil {
			resourceValue := FindResourceValue(resdump, label, "zh", "CN")
			if resourceValue == "" {
				resourceValue = FindResourceValue(resdump, label, "zh", "")
			}
			if resourceValue == "" {
				resourceValue = FindResourceValue(resdump, label, "", "")
			}
			if resourceValue != "" {
				ability["label"] = resourceValue
			}
		}
		if labelId, ok := ability["labelId"].(float64); ok && resdump != nil {
			labelIdInt := int(labelId)
			resourceValue := FindResourceValueById(resdump, labelIdInt, "zh", "CN")
			if resourceValue == "" {
				resourceValue = FindResourceValueById(resdump, labelIdInt, "zh", "")
			}
			if resourceValue == "" {
				resourceValue = FindResourceValueById(resdump, labelIdInt, "", "")
			}
			if resourceValue != "" {
				ability["label"] = resourceValue
			}
		}
		if description, ok := ability["description"].(string); ok && description != "" && resdump != nil {
			resourceValue := FindResourceValue(resdump, description, "zh", "CN")
			if resourceValue == "" {
				resourceValue = FindResourceValue(resdump, description, "zh", "")
			}
			if resourceValue == "" {
				resourceValue = FindResourceValue(resdump, description, "", "")
			}
			if resourceValue != "" {
				ability["description"] = resourceValue
			}
		}
		if descriptionId, ok := ability["descriptionId"].(float64); ok && resdump != nil {
			descriptionIdInt := int(descriptionId)
			resourceValue := FindResourceValueById(resdump, descriptionIdInt, "zh", "CN")
			if resourceValue == "" {
				resourceValue = FindResourceValueById(resdump, descriptionIdInt, "zh", "")
			}
			if resourceValue == "" {
				resourceValue = FindResourceValueById(resdump, descriptionIdInt, "", "")
			}
			if resourceValue != "" {
				ability["description"] = resourceValue
			}
		}
	}

	result := &HapAppInfo{
		FilePath:          hapFilePath,
		FileSize:          fileSize,
		AppName:           appName,
		BundleName:        bundleName,
		VersionName:       versionName,
		VersionCode:       versionCode,
		Vendor:            vendor,
		ModuleName:        moduleName,
		ModuleDescription: moduleDescription,
		MinAPIVersion:     minAPIVersion,
		TargetAPIVersion:  targetAPIVersion,
		CompileSdkVersion: compileSdkVersion,
		CompileMode:       compileMode,
		VirtualMachine:    virtualMachine,
		DeviceTypes:       deviceTypes,
		Permissions:       permissions,
		Abilities:         abilities,
	}

	if appIcon != "" {
		result.Icon = appIcon
	}
	if layeredIcon != nil && len(layeredIcon) > 0 {
		result.LayeredIcon = layeredIcon
	}

	return result, nil
}

// 辅助函数：从 map 中获取值
func getMapValue(m map[string]interface{}, key string, defaultValue map[string]interface{}) map[string]interface{} {
	if val, ok := m[key].(map[string]interface{}); ok {
		return val
	}
	return defaultValue
}

func getStringValue(m map[string]interface{}, key string, defaultValue string) string {
	if val, ok := m[key].(string); ok {
		return val
	}
	return defaultValue
}

func getIntValue(m map[string]interface{}, key string, defaultValue int) int {
	if val, ok := m[key].(float64); ok {
		return int(val)
	}
	return defaultValue
}

func getSliceValue(m map[string]interface{}, key string, defaultValue []interface{}) []interface{} {
	if val, ok := m[key].([]interface{}); ok {
		return val
	}
	return defaultValue
}

// extractIconFromHap 从 HAP 文件中提取图标
func extractIconFromHap(hapFilePath string, iconPath string, zipReader *zip.ReadCloser) (string, error) {
	// 处理路径：如果路径以 entry/ 开头，去掉它；否则保持原样
	normalizedPath := iconPath
	if strings.HasPrefix(iconPath, "entry/") {
		normalizedPath = iconPath[6:]
	}

	// 查找匹配的图标文件
	for _, file := range zipReader.File {
		if file.Name == iconPath || file.Name == normalizedPath ||
			strings.HasSuffix(file.Name, iconPath) || strings.HasSuffix(file.Name, normalizedPath) {
			rc, err := file.Open()
			if err != nil {
				continue
			}
			defer rc.Close()

			data, err := io.ReadAll(rc)
			if err != nil {
				continue
			}

			// 判断文件类型
			fileName := strings.ToLower(file.Name)
			var mimeType string
			if strings.HasSuffix(fileName, ".png") {
				mimeType = "image/png"
			} else if strings.HasSuffix(fileName, ".jpg") || strings.HasSuffix(fileName, ".jpeg") {
				mimeType = "image/jpeg"
			} else if strings.HasSuffix(fileName, ".webp") {
				mimeType = "image/webp"
			} else if strings.HasSuffix(fileName, ".json") {
				// 如果是 JSON 文件，可能是分层图标
				jsonContent := string(data)
				return "LAYERED_ICON_CONFIG:" + jsonContent, nil
			} else {
				mimeType = "image/png" // 默认
			}

			// 转换为 base64 data URL
			base64Data := base64.StdEncoding.EncodeToString(data)
			return fmt.Sprintf("data:%s;base64,%s", mimeType, base64Data), nil
		}
	}

	return "", fmt.Errorf("未找到图标文件: %s", iconPath)
}

// parseLayeredIcon 解析分层图标配置
func parseLayeredIcon(hapFilePath string, layeredConfigStr string, resdump *ResdumpJson, zipReader *zip.ReadCloser) map[string]string {
	if !strings.HasPrefix(layeredConfigStr, "LAYERED_ICON_CONFIG:") {
		return nil
	}

	jsonContent := layeredConfigStr[len("LAYERED_ICON_CONFIG:"):]
	var layeredConfig map[string]interface{}
	if err := json.Unmarshal([]byte(jsonContent), &layeredConfig); err != nil {
		return nil
	}

	layeredImage, ok := layeredConfig["layered-image"].(map[string]interface{})
	if !ok {
		return nil
	}

	result := make(map[string]string)

	// 提取背景图
	if backgroundRef, ok := layeredImage["background"].(string); ok && backgroundRef != "" && resdump != nil {
		var backgroundPath string
		if strings.Contains(backgroundRef, ":") {
			// 资源 ID 格式（$media:16777217）
			parts := strings.Split(backgroundRef, ":")
			if len(parts) == 2 {
				if resourceId, err := strconv.Atoi(parts[1]); err == nil {
					backgroundPath = FindResourceValueById(resdump, resourceId, "", "")
				}
			}
		} else {
			backgroundPath = FindResourceValue(resdump, backgroundRef, "", "")
		}

		if backgroundPath != "" {
			if icon, err := extractIconFromHap(hapFilePath, backgroundPath, zipReader); err == nil && icon != "" && !strings.HasPrefix(icon, "LAYERED_ICON_CONFIG:") {
				result["background"] = icon
			}
		}
	}

	// 提取前景图
	if foregroundRef, ok := layeredImage["foreground"].(string); ok && foregroundRef != "" && resdump != nil {
		var foregroundPath string
		if strings.Contains(foregroundRef, ":") {
			// 资源 ID 格式（$media:16777218）
			parts := strings.Split(foregroundRef, ":")
			if len(parts) == 2 {
				if resourceId, err := strconv.Atoi(parts[1]); err == nil {
					foregroundPath = FindResourceValueById(resdump, resourceId, "", "")
				}
			}
		} else {
			foregroundPath = FindResourceValue(resdump, foregroundRef, "", "")
		}

		if foregroundPath != "" {
			if icon, err := extractIconFromHap(hapFilePath, foregroundPath, zipReader); err == nil && icon != "" && !strings.HasPrefix(icon, "LAYERED_ICON_CONFIG:") {
				result["foreground"] = icon
			}
		}
	}

	if len(result) > 0 {
		return result
	}

	return nil
}
