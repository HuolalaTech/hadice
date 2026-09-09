package backend

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

var invalidOutputNameChars = regexp.MustCompile(`[^\p{L}\p{N}._-]+`)

func getHadiceOutputDirectory(subdirs ...string) (string, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("获取用户主目录失败: %w", err)
	}

	parts := append([]string{homeDir, "Documents", "Hadice"}, subdirs...)
	outputDir := filepath.Join(parts...)
	if err := os.MkdirAll(outputDir, 0o755); err != nil {
		return "", fmt.Errorf("创建输出目录失败: %w", err)
	}
	return outputDir, nil
}

func sanitizeOutputName(value string, fallback string) string {
	value = strings.TrimSpace(value)
	value = invalidOutputNameChars.ReplaceAllString(value, "-")
	value = strings.Trim(value, ".-_")
	if value == "" {
		return fallback
	}
	return value
}

func outputPlatformName(connectKey string) string {
	if isAndroidDevice(connectKey) {
		return "android"
	}
	return "harmony"
}

func outputDeviceName(connectKey string) string {
	if target := deviceManager.GetDeviceByConnectKey(connectKey); target != nil {
		for _, candidate := range []string{
			target.ProductName,
			target.Model,
			target.DeviceName,
		} {
			if strings.TrimSpace(candidate) != "" {
				return sanitizeOutputName(candidate, "device")
			}
		}
	}
	return sanitizeOutputName(connectKey, "device")
}

func buildDeviceOutputFilename(kind string, connectKey string, timestamp time.Time, extension string) string {
	return fmt.Sprintf(
		"%s_%s_%s_%s%s",
		sanitizeOutputName(kind, "output"),
		outputPlatformName(connectKey),
		outputDeviceName(connectKey),
		timestamp.Format("20060102150405"),
		extension,
	)
}

func renameDeviceOutputFile(oldPath string, kind string, connectKey string, timestamp time.Time) (string, string, error) {
	extension := filepath.Ext(oldPath)
	fileName := buildDeviceOutputFilename(kind, connectKey, timestamp, extension)
	newPath := filepath.Join(filepath.Dir(oldPath), fileName)
	if oldPath == newPath {
		return newPath, fileName, nil
	}
	if err := os.Rename(oldPath, newPath); err != nil {
		return "", "", fmt.Errorf("重命名输出文件失败: %w", err)
	}
	return newPath, fileName, nil
}

func resolveOutputRelativePath(relativePath string) (string, error) {
	cleanPath := filepath.Clean(strings.TrimSpace(relativePath))
	if cleanPath == "." || filepath.IsAbs(cleanPath) || cleanPath == ".." ||
		strings.HasPrefix(cleanPath, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("无效的输出文件路径")
	}

	baseDir, err := getHadiceOutputDirectory()
	if err != nil {
		return "", err
	}
	fullPath := filepath.Join(baseDir, cleanPath)
	if err := os.MkdirAll(filepath.Dir(fullPath), 0o755); err != nil {
		return "", fmt.Errorf("创建输出目录失败: %w", err)
	}
	return fullPath, nil
}
