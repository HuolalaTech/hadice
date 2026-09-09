package hdc

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// AppFullDetail 应用完整详情（包括权限和能力信息）
type AppFullDetail struct {
	PackageName      string           `json:"packageName"`
	VersionName      string           `json:"versionName"`
	VersionCode      int              `json:"versionCode"`
	InstallTime      int64            `json:"installTime"`
	UpdateTime       int64            `json:"updateTime"`
	FirstInstallTime int64            `json:"firstInstallTime"`
	IsSystemApp      bool             `json:"isSystemApp"`
	IsEnabled        bool             `json:"isEnabled"`
	IsPreInstallApp  bool             `json:"isPreInstallApp"`
	IsNativeApp      bool             `json:"isNativeApp"`
	Vendor           string           `json:"vendor"`
	TargetVersion    int              `json:"targetVersion"`
	MinSdkVersion    int              `json:"minSdkVersion"`
	Uid              int              `json:"uid"`
	Gid              int              `json:"gid"`
	CodePath         string           `json:"codePath"`
	Permissions      []PermissionInfo `json:"permissions"`
	Abilities        []AbilityInfo    `json:"abilities"`
}

// PermissionInfo 权限信息
type PermissionInfo struct {
	Name      string               `json:"name"`
	Reason    string               `json:"reason,omitempty"`
	UsedScene *PermissionUsedScene `json:"usedScene,omitempty"`
}

// PermissionUsedScene 权限使用场景
type PermissionUsedScene struct {
	Abilities []string `json:"abilities,omitempty"`
	When      string   `json:"when,omitempty"`
}

// AbilityInfo 能力信息
type AbilityInfo struct {
	Name              string      `json:"name"`
	Label             string      `json:"label,omitempty"`
	Description       string      `json:"description,omitempty"`
	LaunchType        string      `json:"launchType,omitempty"`
	SupportWindowMode []string    `json:"supportWindowMode,omitempty"`
	Skills            []SkillInfo `json:"skills,omitempty"`
}

// SkillInfo 技能信息
type SkillInfo struct {
	Actions  []string  `json:"actions,omitempty"`
	Entities []string  `json:"entities,omitempty"`
	URIs     []URIInfo `json:"uris,omitempty"`
}

// URIInfo URI 信息
type URIInfo struct {
	Scheme string `json:"scheme,omitempty"`
	Host   string `json:"host,omitempty"`
	Path   string `json:"path,omitempty"`
}

// GetAppFullDetail 获取应用完整详情（包括权限和能力信息）
func GetAppFullDetail(connectKey string, packageName string) (*AppFullDetail, error) {
	result, err := ExecuteHdcWithTimeout([]string{"-t", connectKey, "shell", "bm", "dump", "-n", packageName}, 15*time.Second)
	if err != nil {
		return nil, err
	}

	if !result.Success || result.Output == "" {
		return nil, fmt.Errorf("获取应用详情失败")
	}

	// 解析 JSON 输出
	jsonStart := strings.Index(result.Output, "{")
	if jsonStart == -1 {
		return nil, fmt.Errorf("未找到JSON数据")
	}

	jsonStr := result.Output[jsonStart:]
	var data map[string]interface{}
	if err := json.Unmarshal([]byte(jsonStr), &data); err != nil {
		return nil, fmt.Errorf("解析JSON失败: %v", err)
	}

	detail := &AppFullDetail{
		PackageName: packageName,
		Permissions: []PermissionInfo{},
		Abilities:   []AbilityInfo{},
	}

	// 提取基本信息
	if appInfo, ok := data["applicationInfo"].(map[string]interface{}); ok {
		if versionName, ok := appInfo["versionName"].(string); ok {
			detail.VersionName = versionName
		}
		if versionCode, ok := appInfo["versionCode"].(float64); ok {
			detail.VersionCode = int(versionCode)
		}
		if isSystemApp, ok := appInfo["isSystemApp"].(bool); ok {
			detail.IsSystemApp = isSystemApp
		}
		if enabled, ok := appInfo["enabled"].(bool); ok {
			detail.IsEnabled = enabled
		}
		if vendor, ok := appInfo["vendor"].(string); ok {
			detail.Vendor = vendor
		}
		if uid, ok := appInfo["uid"].(float64); ok {
			detail.Uid = int(uid)
		}
		if codePath, ok := appInfo["codePath"].(string); ok {
			detail.CodePath = codePath
		}
	}

	// 从根级别提取信息
	if installTime, ok := data["installTime"].(float64); ok {
		detail.InstallTime = int64(installTime)
	}
	if updateTime, ok := data["updateTime"].(float64); ok {
		detail.UpdateTime = int64(updateTime)
	}
	if firstInstallTime, ok := data["firstInstallTime"].(float64); ok {
		detail.FirstInstallTime = int64(firstInstallTime)
	}
	if isPreInstallApp, ok := data["isPreInstallApp"].(bool); ok {
		detail.IsPreInstallApp = isPreInstallApp
	}
	if isNativeApp, ok := data["isNativeApp"].(bool); ok {
		detail.IsNativeApp = isNativeApp
	}
	if targetVersion, ok := data["targetVersion"].(float64); ok {
		detail.TargetVersion = int(targetVersion)
	}
	if minSdkVersion, ok := data["minSdkVersion"].(float64); ok {
		detail.MinSdkVersion = int(minSdkVersion)
	}
	if gid, ok := data["gid"].(float64); ok {
		detail.Gid = int(gid)
	}

	// 提取权限信息（从根级别的 reqPermissionDetails）
	if reqPermDetails, ok := data["reqPermissionDetails"].([]interface{}); ok {
		for _, perm := range reqPermDetails {
			if permMap, ok := perm.(map[string]interface{}); ok {
				permission := PermissionInfo{}
				if name, ok := permMap["name"].(string); ok {
					permission.Name = name
				}
				if reason, ok := permMap["reason"].(string); ok {
					permission.Reason = reason
				}
				if usedScene, ok := permMap["usedScene"].(map[string]interface{}); ok {
					permission.UsedScene = &PermissionUsedScene{}
					if when, ok := usedScene["when"].(string); ok {
						permission.UsedScene.When = when
					}
					if abilities, ok := usedScene["abilities"].([]interface{}); ok {
						permission.UsedScene.Abilities = make([]string, 0, len(abilities))
						for _, ab := range abilities {
							if abStr, ok := ab.(string); ok {
								permission.UsedScene.Abilities = append(permission.UsedScene.Abilities, abStr)
							}
						}
					}
				}
				if permission.Name != "" {
					detail.Permissions = append(detail.Permissions, permission)
				}
			}
		}
	}

	// 提取能力信息
	if hapModules, ok := data["hapModuleInfos"].([]interface{}); ok {
		for _, module := range hapModules {
			if moduleMap, ok := module.(map[string]interface{}); ok {
				if abilities, ok := moduleMap["abilityInfos"].([]interface{}); ok {
					for _, ability := range abilities {
						if abMap, ok := ability.(map[string]interface{}); ok {
							abilityInfo := AbilityInfo{
								SupportWindowMode: []string{},
								Skills:            []SkillInfo{},
							}
							if name, ok := abMap["name"].(string); ok {
								abilityInfo.Name = name
							}
							if label, ok := abMap["label"].(string); ok {
								abilityInfo.Label = label
							}
							if description, ok := abMap["description"].(string); ok {
								abilityInfo.Description = description
							}
							if launchType, ok := abMap["launchType"].(string); ok {
								abilityInfo.LaunchType = launchType
							}
							if windowModes, ok := abMap["supportWindowMode"].([]interface{}); ok {
								for _, mode := range windowModes {
									if modeStr, ok := mode.(string); ok {
										abilityInfo.SupportWindowMode = append(abilityInfo.SupportWindowMode, modeStr)
									}
								}
							}
							if skills, ok := abMap["skills"].([]interface{}); ok {
								for _, skill := range skills {
									if skillMap, ok := skill.(map[string]interface{}); ok {
										skillInfo := SkillInfo{
											Actions:  []string{},
											Entities: []string{},
											URIs:     []URIInfo{},
										}
										if actions, ok := skillMap["actions"].([]interface{}); ok {
											for _, action := range actions {
												if actionStr, ok := action.(string); ok {
													skillInfo.Actions = append(skillInfo.Actions, actionStr)
												}
											}
										}
										if entities, ok := skillMap["entities"].([]interface{}); ok {
											for _, entity := range entities {
												if entityStr, ok := entity.(string); ok {
													skillInfo.Entities = append(skillInfo.Entities, entityStr)
												}
											}
										}
										if uris, ok := skillMap["uris"].([]interface{}); ok {
											for _, uri := range uris {
												if uriMap, ok := uri.(map[string]interface{}); ok {
													uriInfo := URIInfo{}
													if scheme, ok := uriMap["scheme"].(string); ok {
														uriInfo.Scheme = scheme
													}
													if host, ok := uriMap["host"].(string); ok {
														uriInfo.Host = host
													}
													if path, ok := uriMap["path"].(string); ok {
														uriInfo.Path = path
													}
													skillInfo.URIs = append(skillInfo.URIs, uriInfo)
												}
											}
										}
										abilityInfo.Skills = append(abilityInfo.Skills, skillInfo)
									}
								}
							}
							if abilityInfo.Name != "" {
								detail.Abilities = append(detail.Abilities, abilityInfo)
							}
						}
					}
				}
			}
		}
	}

	return detail, nil
}
