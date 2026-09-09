package hdc

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"
)

type OnlineAppInfo struct {
	Name string `json:"name"`
	Icon string `json:"icon"`
}

type OnlineAppInfoWithCache struct {
	Name      string `json:"name"`
	Icon      string `json:"icon"`
	FromCache bool   `json:"fromCache"`
}

var (
	onlineInfoCache     = make(map[string]*OnlineAppInfo)
	onlineInfoCacheLock sync.RWMutex
)

func GetOnlineAppInfo(packageName string) (*OnlineAppInfo, error) {
	onlineInfoCacheLock.RLock()
	if cached, ok := onlineInfoCache[packageName]; ok {
		onlineInfoCacheLock.RUnlock()
		return cached, nil
	}
	onlineInfoCacheLock.RUnlock()

	url := "https://web-drcn.hispace.dbankcloud.com/edge/webedge/appinfo"
	postData := map[string]interface{}{
		"pkgName":     packageName,
		"appId":       packageName,
		"locale":      "zh_CN",
		"countryCode": "CN",
		"orderApp":    1,
	}

	jsonData, err := json.Marshal(postData)
	if err != nil {
		return nil, fmt.Errorf("序列化请求数据失败: %v", err)
	}

	req, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, fmt.Errorf("创建请求失败: %v", err)
	}

	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{
		Timeout: 5 * time.Second,
	}

	resp, err := client.Do(req)
	if err != nil {
		return &OnlineAppInfo{}, nil
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return &OnlineAppInfo{}, nil
	}

	if len(body) == 0 {
		return &OnlineAppInfo{}, nil
	}

	var result map[string]interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		return &OnlineAppInfo{}, nil
	}

	info := &OnlineAppInfo{}
	if name, ok := result["name"].(string); ok && name != "" {
		info.Name = name
	} else if appName, ok := result["appName"].(string); ok && appName != "" {
		info.Name = appName
	}

	if icon, ok := result["icon"].(string); ok && icon != "" {
		info.Icon = icon
	} else if appIcon, ok := result["appIcon"].(string); ok && appIcon != "" {
		info.Icon = appIcon
	}

	if info.Name != "" || info.Icon != "" {
		onlineInfoCacheLock.Lock()
		onlineInfoCache[packageName] = info
		onlineInfoCacheLock.Unlock()
	}

	return info, nil
}

func GetOnlineAppInfoWithDiskCache(packageName string, isSystemApp bool) (*OnlineAppInfoWithCache, error) {
	cached := GetCachedAppInfo(packageName)
	if cached != nil && cached.IconPath != "" {
		base64Icon, err := ReadIconAsBase64(packageName)
		if err == nil && base64Icon != "" {
			return &OnlineAppInfoWithCache{
				Name:      cached.AppName,
				Icon:      base64Icon,
				FromCache: true,
			}, nil
		}
	}

	onlineInfo, err := GetOnlineAppInfo(packageName)
	if err != nil {
		if cached != nil {
			base64Icon, _ := ReadIconAsBase64(packageName)
			return &OnlineAppInfoWithCache{
				Name:      cached.AppName,
				Icon:      base64Icon,
				FromCache: true,
			}, nil
		}
		return nil, err
	}

	if onlineInfo.Icon != "" {
		iconPath, saveErr := SaveIcon(packageName, onlineInfo.Icon)
		if saveErr == nil {
			cachedInfo := &CachedAppInfo{
				PackageName: packageName,
				AppName:     onlineInfo.Name,
				IconPath:    iconPath,
				IconUrl:     onlineInfo.Icon,
				CachedAt:    time.Now().UnixMilli(),
				IsSystemApp: isSystemApp,
			}
			_ = UpdateCachedAppInfo(cachedInfo)

			base64Icon, _ := ReadIconAsBase64(packageName)
			if base64Icon != "" {
				return &OnlineAppInfoWithCache{
					Name:      onlineInfo.Name,
					Icon:      base64Icon,
					FromCache: false,
				}, nil
			}
		}
	}

	return &OnlineAppInfoWithCache{
		Name:      onlineInfo.Name,
		Icon:      onlineInfo.Icon,
		FromCache: false,
	}, nil
}

func SaveAppInfoToCache(packageName, appName, iconUrl string, isSystemApp, isRunning bool) error {
	cachedInfo := &CachedAppInfo{
		PackageName: packageName,
		AppName:     appName,
		IconUrl:     iconUrl,
		CachedAt:    time.Now().UnixMilli(),
		IsSystemApp: isSystemApp,
		IsRunning:   isRunning,
	}

	if iconUrl != "" {
		iconPath, err := SaveIcon(packageName, iconUrl)
		if err == nil {
			cachedInfo.IconPath = iconPath
		}
	}

	return UpdateCachedAppInfo(cachedInfo)
}

func BatchUpdateAppCache(apps []AppInfo) error {
	cache := getDiskCache()
	if cache == nil {
		return fmt.Errorf("缓存未初始化")
	}

	for _, app := range apps {
		cachedInfo := &CachedAppInfo{
			PackageName: app.PackageName,
			AppName:     app.AppName,
			CachedAt:    time.Now().UnixMilli(),
			IsSystemApp: app.IsSystemApp,
			IsRunning:   app.IsRunning,
		}

		if existing, ok := cache.Apps[app.PackageName]; ok {
			cachedInfo.IconPath = existing.IconPath
			cachedInfo.IconUrl = existing.IconUrl
		}

		cache.Apps[app.PackageName] = cachedInfo
	}

	return SaveDiskCache(cache)
}
