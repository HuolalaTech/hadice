package adb

import (
	"archive/zip"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"time"

	"Hadice/backend/hdc"
)

// ParseApkAppInfo 使用 aapt 解析 APK 应用信息
func ParseApkAppInfo(apkFilePath string) (*hdc.InstallPackageInfo, error) {
	fileInfo, err := os.Stat(apkFilePath)
	if err != nil {
		return nil, fmt.Errorf("无法读取文件: %v", err)
	}
	fileSize := fileInfo.Size()

	badgingOutput, err := executeAaptDump("badging", apkFilePath)
	if err != nil {
		return nil, fmt.Errorf("解析 APK 失败: %v", err)
	}

	permissionsOutput, err := executeAaptDump("permissions", apkFilePath)
	if err != nil {
		return nil, fmt.Errorf("获取权限列表失败: %v", err)
	}

	info := parseBadgingOutput(badgingOutput)
	info.FilePath = apkFilePath
	info.FileSize = fileSize

	info.Permissions = parsePermissionsOutput(permissionsOutput)

	if info.Icon == "" {
		iconPath := extractIconPathFromBadging(badgingOutput)
		if iconPath != "" {
			iconData, err := extractIconFromApk(apkFilePath, iconPath)
			if err == nil && iconData != "" {
				info.Icon = iconData
			}
		}
	}

	return info, nil
}

// executeAaptDump 执行 aapt dump 命令
func executeAaptDump(dumpType string, apkPath string) (string, error) {
	if err := EnsureAaptExecutable(); err != nil {
		return "", fmt.Errorf("AAPT 不可用: %v", err)
	}

	ctx, cancel := NewExecContext(30 * time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, aaptPath, "dump", dumpType, apkPath)
	output, err := cmd.Output()
	if err != nil {
		if ctx.Err() != nil {
			return "", fmt.Errorf("命令执行超时")
		}
		return "", fmt.Errorf("aapt dump %s 失败: %v", dumpType, err)
	}

	return string(output), nil
}

// NewExecContext 创建带超时的执行上下文
func NewExecContext(timeout time.Duration) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), timeout)
}

// parseBadgingOutput 解析 aapt dump badging 输出
func parseBadgingOutput(output string) *hdc.InstallPackageInfo {
	info := &hdc.InstallPackageInfo{}

	lines := strings.Split(output, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		if strings.HasPrefix(line, "package:") {
			parsePackageLine(line, info)
		} else if strings.HasPrefix(line, "application-label:") {
			info.AppName = extractQuotedValue(line, "application-label:")
		} else if strings.HasPrefix(line, "application-label-zh:") {
			info.AppName = extractQuotedValue(line, "application-label-zh:")
		} else if strings.HasPrefix(line, "sdkVersion:") {
			if val := extractQuotedValue(line, "sdkVersion:"); val != "" {
				fmt.Sscanf(val, "%d", &info.MinAPIVersion)
			}
		} else if strings.HasPrefix(line, "targetSdkVersion:") {
			if val := extractQuotedValue(line, "targetSdkVersion:"); val != "" {
				fmt.Sscanf(val, "%d", &info.TargetAPIVersion)
			}
		} else if strings.HasPrefix(line, "native-code:") {
			info.NativeCode = parseNativeCode(line)
		}
	}

	if info.AppName == "" {
		info.AppName = info.BundleName
	}

	return info
}

// parsePackageLine 解析 package 行
func parsePackageLine(line string, info *hdc.InstallPackageInfo) {
	re := regexp.MustCompile(`name='([^']+)'`)
	if match := re.FindStringSubmatch(line); len(match) > 1 {
		info.BundleName = match[1]
	}

	re = regexp.MustCompile(`versionCode='([^']+)'`)
	if match := re.FindStringSubmatch(line); len(match) > 1 {
		fmt.Sscanf(match[1], "%d", &info.VersionCode)
	}

	re = regexp.MustCompile(`versionName='([^']+)'`)
	if match := re.FindStringSubmatch(line); len(match) > 1 {
		info.VersionName = match[1]
	}
}

// extractQuotedValue 提取引号中的值
func extractQuotedValue(line string, prefix string) string {
	str := strings.TrimPrefix(line, prefix)
	str = strings.TrimSpace(str)

	if strings.HasPrefix(str, "'") && strings.HasSuffix(str, "'") {
		return str[1 : len(str)-1]
	}
	return str
}

// parseNativeCode 解析 native-code 行
func parseNativeCode(line string) []string {
	str := strings.TrimPrefix(line, "native-code:")
	str = strings.TrimSpace(str)

	re := regexp.MustCompile(`'([^']+)'`)
	matches := re.FindAllStringSubmatch(str, -1)

	var codes []string
	for _, match := range matches {
		if len(match) > 1 {
			codes = append(codes, match[1])
		}
	}
	return codes
}

// parsePermissionsOutput 解析 aapt dump permissions 输出
func parsePermissionsOutput(output string) []map[string]interface{} {
	var permissions []map[string]interface{}

	lines := strings.Split(output, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "uses-permission:") {
			re := regexp.MustCompile(`name='([^']+)'`)
			if match := re.FindStringSubmatch(line); len(match) > 1 {
				permissions = append(permissions, map[string]interface{}{
					"name": match[1],
				})
			}
		}
	}

	return permissions
}

// extractIconPathFromBadging 从 badging 输出中提取图标路径
func extractIconPathFromBadging(output string) string {
	lines := strings.Split(output, "\n")
	var lastIconPath string

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "application-icon-") {
			re := regexp.MustCompile(`'([^']+\.png)'`)
			if match := re.FindStringSubmatch(line); len(match) > 1 {
				lastIconPath = match[1]
			}
		}
	}

	return lastIconPath
}

// extractIconFromApk 从 APK 文件中提取图标
func extractIconFromApk(apkPath string, iconPath string) (string, error) {
	zipReader, err := zip.OpenReader(apkPath)
	if err != nil {
		return "", fmt.Errorf("无法打开 APK 文件: %v", err)
	}
	defer zipReader.Close()

	for _, file := range zipReader.File {
		if file.Name == iconPath {
			rc, err := file.Open()
			if err != nil {
				return "", err
			}
			defer rc.Close()

			data, err := io.ReadAll(rc)
			if err != nil {
				return "", err
			}

			mimeType := "image/png"
			fileName := strings.ToLower(file.Name)
			if strings.HasSuffix(fileName, ".jpg") || strings.HasSuffix(fileName, ".jpeg") {
				mimeType = "image/jpeg"
			} else if strings.HasSuffix(fileName, ".webp") {
				mimeType = "image/webp"
			}

			base64Data := base64.StdEncoding.EncodeToString(data)
			return fmt.Sprintf("data:%s;base64,%s", mimeType, base64Data), nil
		}
	}

	return "", fmt.Errorf("未找到图标文件: %s", iconPath)
}
