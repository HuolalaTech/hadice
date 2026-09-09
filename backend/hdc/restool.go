package hdc

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// ResdumpResource resdump 资源项
type ResdumpResource struct {
	ID          int                 `json:"id"`
	Name        string              `json:"name"`
	Type        string              `json:"type"`
	EntryCount  int                 `json:"entryCount"`
	EntryValues []ResdumpEntryValue `json:"entryValues"`
}

// ResdumpEntryValue resdump 资源项值
type ResdumpEntryValue struct {
	Value    string `json:"value"`
	Language string `json:"language,omitempty"`
	Region   string `json:"region,omitempty"`
}

// ResdumpJson resdump JSON 结构
type ResdumpJson struct {
	BundleName string            `json:"bundleName,omitempty"`
	ModuleName string            `json:"moduleName,omitempty"`
	Resource   []ResdumpResource `json:"resource"`
}

// GetRestoolPath 获取 restool 可执行文件路径
func GetRestoolPath() string {
	// 根据平台设置可执行文件名
	restoolExeName := "restool"
	if runtime.GOOS == "windows" {
		restoolExeName = "restool.exe"
	}

	resourcesDir := GetResourcesDir()
	if resourcesDir != "" {
		restoolPath := filepath.Join(resourcesDir, restoolExeName)
		if _, err := os.Stat(restoolPath); err == nil {
			// 确保有执行权限（macOS/Linux）
			if runtime.GOOS != "windows" {
				os.Chmod(restoolPath, 0755)
			}
			return restoolPath
		}
	}

	// 回退到开发环境的路径
	cwd, _ := os.Getwd()
	var platformDir string
	if runtime.GOOS == "darwin" {
		platformDir = fmt.Sprintf("darwin/%s", runtime.GOARCH)
	} else if runtime.GOOS == "windows" {
		platformDir = fmt.Sprintf("windows/%s", runtime.GOARCH)
	} else {
		platformDir = runtime.GOARCH
	}
	restoolPath := filepath.Join(cwd, "assets", platformDir, "bin", restoolExeName)
	if _, err := os.Stat(restoolPath); err == nil {
		// 确保有执行权限（macOS/Linux）
		if runtime.GOOS != "windows" {
			os.Chmod(restoolPath, 0755)
		}
		return restoolPath
	}

	return ""
}

// RunRestoolDump 执行 restool dump 命令
func RunRestoolDump(hapFilePath string) (*ResdumpJson, error) {
	restoolPath := GetRestoolPath()
	if restoolPath == "" {
		return nil, fmt.Errorf("未找到 restool 可执行文件")
	}

	// 设置超时
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// 执行 restool dump 命令
	cmd := exec.CommandContext(ctx, restoolPath, "dump", hapFilePath)

	// Windows 下隐藏子进程窗口，防止终端闪烁
	if runtime.GOOS == "windows" {
		HideWindowsConsoleWindow(cmd)
	}

	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("执行 restool dump 失败: %v", err)
	}

	// 解析 JSON 输出
	var resdump ResdumpJson
	if err := json.Unmarshal(output, &resdump); err != nil {
		return nil, fmt.Errorf("解析 restool dump 输出失败: %v", err)
	}

	return &resdump, nil
}

// FindResourceValue 从 resdump 中查找资源值（支持资源引用格式）
func FindResourceValue(resdump *ResdumpJson, resourceRef string, preferredLanguage, preferredRegion string) string {
	if resdump == nil || len(resdump.Resource) == 0 || resourceRef == "" {
		return ""
	}

	// 解析资源引用格式（如 "$string:app_name"）
	var resourceType, resourceName string
	if len(resourceRef) > 0 && resourceRef[0] == '$' {
		parts := strings.SplitN(resourceRef[1:], ":", 2)
		if len(parts) == 2 {
			resourceType = parts[0]
			resourceName = parts[1]
		} else {
			resourceName = resourceRef
		}
	} else {
		resourceName = resourceRef
	}

	// 查找匹配的资源项
	var targetResource *ResdumpResource
	for i := range resdump.Resource {
		r := &resdump.Resource[i]
		if resourceType != "" {
			// 如果指定了类型，需要类型和名称都匹配
			if r.Type == resourceType && r.Name == resourceName {
				targetResource = r
				break
			}
		} else {
			// 只按名称匹配
			if r.Name == resourceName {
				targetResource = r
				break
			}
		}
	}

	if targetResource == nil || len(targetResource.EntryValues) == 0 {
		return ""
	}

	// 优先查找匹配语言和地区的值
	if preferredLanguage != "" && preferredRegion != "" {
		for _, entry := range targetResource.EntryValues {
			if entry.Language == preferredLanguage && entry.Region == preferredRegion {
				return entry.Value
			}
		}
	}

	// 查找匹配语言的值
	if preferredLanguage != "" {
		for _, entry := range targetResource.EntryValues {
			if entry.Language == preferredLanguage {
				return entry.Value
			}
		}
	}

	// 返回第一个值（通常是默认值）
	return targetResource.EntryValues[0].Value
}

// FindResourceValueById 从 resdump 中根据资源 ID 查找资源值
func FindResourceValueById(resdump *ResdumpJson, resourceId int, preferredLanguage, preferredRegion string) string {
	if resdump == nil || len(resdump.Resource) == 0 {
		return ""
	}

	// 查找匹配的资源项
	var targetResource *ResdumpResource
	for i := range resdump.Resource {
		r := &resdump.Resource[i]
		if r.ID == resourceId {
			targetResource = r
			break
		}
	}

	if targetResource == nil || len(targetResource.EntryValues) == 0 {
		return ""
	}

	// 优先查找匹配语言和地区的值
	if preferredLanguage != "" && preferredRegion != "" {
		for _, entry := range targetResource.EntryValues {
			if entry.Language == preferredLanguage && entry.Region == preferredRegion {
				return entry.Value
			}
		}
	}

	// 查找匹配语言的值
	if preferredLanguage != "" {
		for _, entry := range targetResource.EntryValues {
			if entry.Language == preferredLanguage {
				return entry.Value
			}
		}
	}

	// 返回第一个值（通常是默认值）
	return targetResource.EntryValues[0].Value
}
