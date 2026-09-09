package hdc

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	CacheVersion  = 1
	CacheFileName = "app_cache.json"
	IconsDirName  = "app_icons"
)

type AppDiskCache struct {
	Version    int                       `json:"version"`
	LastUpdate int64                     `json:"lastUpdate"`
	Apps       map[string]*CachedAppInfo `json:"apps"`
}

type CachedAppInfo struct {
	PackageName string `json:"packageName"`
	AppName     string `json:"appName"`
	IconPath    string `json:"iconPath"`
	IconUrl     string `json:"iconUrl"`
	CachedAt    int64  `json:"cachedAt"`
	IsSystemApp bool   `json:"isSystemApp"`
	IsRunning   bool   `json:"isRunning"`
}

var (
	diskCache      *AppDiskCache
	diskCacheLock  sync.RWMutex
	diskCacheOnce  sync.Once
	cacheBasePath  string
	isLoadingCache bool
	loadingLock    sync.Mutex
)

func InitCacheBasePath(basePath string) {
	cacheBasePath = basePath
}

func getCacheBasePath() string {
	if cacheBasePath != "" {
		return cacheBasePath
	}
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	switch {
	case strings.Contains(filepath.VolumeName(homeDir), ":"):
		cacheBasePath = filepath.Join(os.Getenv("APPDATA"), "Hadice")
	default:
		cacheBasePath = filepath.Join(homeDir, "Library", "Application Support", "Hadice")
	}
	return cacheBasePath
}

func getCacheDir() string {
	return filepath.Join(getCacheBasePath(), "cache")
}

func getIconsDir() string {
	return filepath.Join(getCacheDir(), IconsDirName)
}

func getCacheFilePath() string {
	return filepath.Join(getCacheDir(), CacheFileName)
}

func ensureCacheDirs() error {
	cacheDir := getCacheDir()
	if err := os.MkdirAll(cacheDir, 0755); err != nil {
		return fmt.Errorf("创建缓存目录失败: %v", err)
	}
	iconsDir := getIconsDir()
	if err := os.MkdirAll(iconsDir, 0755); err != nil {
		return fmt.Errorf("创建图标目录失败: %v", err)
	}
	return nil
}

func LoadDiskCache() (*AppDiskCache, error) {
	var initErr error
	diskCacheOnce.Do(func() {
		cachePath := getCacheFilePath()
		data, err := os.ReadFile(cachePath)
		if err != nil {
			if os.IsNotExist(err) {
				diskCache = &AppDiskCache{
					Version:    CacheVersion,
					LastUpdate: 0,
					Apps:       make(map[string]*CachedAppInfo),
				}
				return
			}
			initErr = fmt.Errorf("读取缓存文件失败: %v", err)
			diskCache = &AppDiskCache{
				Version:    CacheVersion,
				LastUpdate: 0,
				Apps:       make(map[string]*CachedAppInfo),
			}
			return
		}

		var cache AppDiskCache
		if err := json.Unmarshal(data, &cache); err != nil {
			diskCache = &AppDiskCache{
				Version:    CacheVersion,
				LastUpdate: 0,
				Apps:       make(map[string]*CachedAppInfo),
			}
			return
		}

		if cache.Version != CacheVersion {
			diskCache = &AppDiskCache{
				Version:    CacheVersion,
				LastUpdate: 0,
				Apps:       make(map[string]*CachedAppInfo),
			}
			return
		}

		if cache.Apps == nil {
			cache.Apps = make(map[string]*CachedAppInfo)
		}
		diskCache = &cache
	})

	return diskCache, initErr
}

func getDiskCache() *AppDiskCache {
	if diskCache != nil {
		return diskCache
	}
	LoadDiskCache()
	return diskCache
}

func SaveDiskCache(cache *AppDiskCache) error {
	if err := ensureCacheDirs(); err != nil {
		return err
	}

	cache.LastUpdate = time.Now().UnixMilli()

	data, err := json.MarshalIndent(cache, "", "  ")
	if err != nil {
		return fmt.Errorf("序列化缓存失败: %v", err)
	}

	cachePath := getCacheFilePath()
	if err := os.WriteFile(cachePath, data, 0644); err != nil {
		return fmt.Errorf("写入缓存文件失败: %v", err)
	}

	return nil
}

func GetCachedAppInfo(packageName string) *CachedAppInfo {
	diskCacheLock.RLock()
	defer diskCacheLock.RUnlock()

	cache := getDiskCache()
	if cache == nil {
		return nil
	}

	return cache.Apps[packageName]
}

func UpdateCachedAppInfo(info *CachedAppInfo) error {
	diskCacheLock.Lock()
	defer diskCacheLock.Unlock()

	cache := getDiskCache()
	if cache == nil {
		return fmt.Errorf("缓存未初始化")
	}

	cache.Apps[info.PackageName] = info
	diskCache = cache

	return SaveDiskCache(cache)
}

func SaveIcon(packageName string, iconUrl string) (string, error) {
	if err := ensureCacheDirs(); err != nil {
		return "", err
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(iconUrl)
	if err != nil {
		return "", fmt.Errorf("下载图标失败: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("下载图标失败: HTTP %d", resp.StatusCode)
	}

	ext := ".png"
	contentType := resp.Header.Get("Content-Type")
	switch contentType {
	case "image/jpeg", "image/jpg":
		ext = ".jpg"
	case "image/webp":
		ext = ".webp"
	case "image/gif":
		ext = ".gif"
	}

	iconFileName := packageName + ext
	iconPath := filepath.Join(getIconsDir(), iconFileName)

	file, err := os.Create(iconPath)
	if err != nil {
		return "", fmt.Errorf("创建图标文件失败: %v", err)
	}
	defer file.Close()

	_, err = io.Copy(file, resp.Body)
	if err != nil {
		return "", fmt.Errorf("写入图标文件失败: %v", err)
	}

	return iconPath, nil
}

func GetLocalIconPath(packageName string) string {
	iconsDir := getIconsDir()

	extensions := []string{".png", ".jpg", ".webp", ".gif"}
	for _, ext := range extensions {
		iconPath := filepath.Join(iconsDir, packageName+ext)
		if _, err := os.Stat(iconPath); err == nil {
			return iconPath
		}
	}
	return ""
}

func ReadIconAsBase64(packageName string) (string, error) {
	iconPath := GetLocalIconPath(packageName)
	if iconPath == "" {
		return "", nil
	}

	data, err := os.ReadFile(iconPath)
	if err != nil {
		return "", err
	}

	ext := strings.ToLower(filepath.Ext(iconPath))
	mimeType := "image/png"
	switch ext {
	case ".jpg", ".jpeg":
		mimeType = "image/jpeg"
	case ".webp":
		mimeType = "image/webp"
	case ".gif":
		mimeType = "image/gif"
	}

	base64Data := encodeBase64(data)
	return fmt.Sprintf("data:%s;base64,%s", mimeType, base64Data), nil
}

func encodeBase64(data []byte) string {
	const base64Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

	result := make([]byte, 0, (len(data)+2)/3*4)

	for i := 0; i < len(data); i += 3 {
		var n uint32
		remaining := len(data) - i

		if remaining >= 3 {
			n = uint32(data[i])<<16 | uint32(data[i+1])<<8 | uint32(data[i+2])
			result = append(result, base64Chars[n>>18&0x3F])
			result = append(result, base64Chars[n>>12&0x3F])
			result = append(result, base64Chars[n>>6&0x3F])
			result = append(result, base64Chars[n&0x3F])
		} else if remaining == 2 {
			n = uint32(data[i])<<16 | uint32(data[i+1])<<8
			result = append(result, base64Chars[n>>18&0x3F])
			result = append(result, base64Chars[n>>12&0x3F])
			result = append(result, base64Chars[n>>6&0x3F])
			result = append(result, '=')
		} else {
			n = uint32(data[i]) << 16
			result = append(result, base64Chars[n>>18&0x3F])
			result = append(result, base64Chars[n>>12&0x3F])
			result = append(result, '=')
			result = append(result, '=')
		}
	}

	return string(result)
}

func GetAllCachedApps() []*CachedAppInfo {
	diskCacheLock.RLock()
	defer diskCacheLock.RUnlock()

	cache := getDiskCache()
	if cache == nil {
		return nil
	}

	apps := make([]*CachedAppInfo, 0, len(cache.Apps))
	for _, app := range cache.Apps {
		apps = append(apps, app)
	}
	return apps
}

func ClearDiskCache() error {
	diskCacheLock.Lock()
	defer diskCacheLock.Unlock()

	cachePath := getCacheFilePath()
	if err := os.Remove(cachePath); err != nil && !os.IsNotExist(err) {
		return err
	}

	iconsDir := getIconsDir()
	if err := os.RemoveAll(iconsDir); err != nil {
		return err
	}

	diskCache = &AppDiskCache{
		Version:    CacheVersion,
		LastUpdate: 0,
		Apps:       make(map[string]*CachedAppInfo),
	}
	diskCacheOnce = sync.Once{}

	return nil
}

func IsLoadingCache() bool {
	loadingLock.Lock()
	defer loadingLock.Unlock()
	return isLoadingCache
}

func SetLoadingCache(loading bool) {
	loadingLock.Lock()
	defer loadingLock.Unlock()
	isLoadingCache = loading
}
