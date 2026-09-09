package adb

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

type FileItem struct {
	Name         string `json:"name"`
	Path         string `json:"path"`
	IsDirectory  bool   `json:"isDirectory"`
	Size         int64  `json:"size"`
	ModifiedTime int64  `json:"modifiedTime"`
	Permissions  string `json:"permissions,omitempty"`
}

type DirectoryListResult struct {
	Success bool       `json:"success"`
	Items   []FileItem `json:"items,omitempty"`
	Error   string     `json:"error,omitempty"`
}

func ListDeviceDirectory(connectKey string, path string) (*DirectoryListResult, error) {
	args := []string{"-s", connectKey, "shell", "ls", "-la", path}
	result, err := ExecuteAdbWithTimeout(args, 30*time.Second)
	if err != nil {
		return &DirectoryListResult{
			Success: false,
			Error:   err.Error(),
		}, err
	}

	if !result.Success {
		return &DirectoryListResult{
			Success: false,
			Error:   result.Error,
		}, nil
	}

	items := []FileItem{}
	lines := strings.Split(result.Output, "\n")

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "total") || line == "" {
			continue
		}

		if len(line) < 10 {
			continue
		}

		permissions := line[:10]
		isDirectory := strings.HasPrefix(permissions, "d")

		rest := strings.TrimSpace(line[10:])
		if rest == "" {
			continue
		}

		parts := strings.Fields(rest)
		if len(parts) < 6 {
			continue
		}

		var size int64
		if sizeVal, err := strconv.ParseInt(parts[3], 10, 64); err == nil {
			size = sizeVal
		}

		dateTimeParts := parts[4:]
		nameStartIndex := len(dateTimeParts)

		for i := len(dateTimeParts) - 1; i >= 0; i-- {
			if strings.Contains(dateTimeParts[i], ":") {
				nameStartIndex = i + 1
				break
			}
		}

		if nameStartIndex == len(dateTimeParts) {
			for i := 0; i < len(dateTimeParts); i++ {
				if matched, _ := regexp.MatchString(`^\d{4}-\d{2}-\d{2}$`, dateTimeParts[i]); matched {
					if i+2 < len(dateTimeParts) {
						nameStartIndex = i + 2
					} else {
						nameStartIndex = i + 1
					}
					break
				}
			}
		}

		if nameStartIndex == len(dateTimeParts) {
			if len(dateTimeParts) >= 4 {
				if matched, _ := regexp.MatchString(`^\d{4}$`, dateTimeParts[2]); matched {
					nameStartIndex = 3
				} else if len(dateTimeParts) >= 2 {
					nameStartIndex = len(dateTimeParts) - 1
				}
			} else if len(dateTimeParts) >= 2 {
				nameStartIndex = len(dateTimeParts) - 1
			}
		}

		var fileName string
		if nameStartIndex < len(dateTimeParts) {
			fileName = strings.Join(dateTimeParts[nameStartIndex:], " ")
		} else {
			fileName = dateTimeParts[len(dateTimeParts)-1]
		}

		if fileName == "." || fileName == ".." {
			continue
		}

		var modifiedTime int64 = time.Now().UnixMilli()
		if nameStartIndex > 0 {
			dateParts := dateTimeParts[:nameStartIndex]
			dateStr := strings.Join(dateParts, " ")
			if t, err := time.Parse("2006-01-02 15:04", dateStr); err == nil {
				modifiedTime = t.UnixMilli()
			} else if t, err := time.Parse("Jan 02 15:04", dateStr); err == nil {
				now := time.Now()
				t = time.Date(now.Year(), t.Month(), t.Day(), t.Hour(), t.Minute(), 0, 0, time.Local)
				modifiedTime = t.UnixMilli()
			} else if t, err := time.Parse("Jan 02 2006", dateStr); err == nil {
				modifiedTime = t.UnixMilli()
			}
		}

		fullPath := path
		if !strings.HasSuffix(fullPath, "/") {
			fullPath += "/"
		}
		fullPath += fileName

		items = append(items, FileItem{
			Name:         fileName,
			Path:         fullPath,
			IsDirectory:  isDirectory,
			Size:         size,
			ModifiedTime: modifiedTime,
			Permissions:  permissions,
		})
	}

	sort.Slice(items, func(i, j int) bool {
		if items[i].IsDirectory != items[j].IsDirectory {
			return items[i].IsDirectory
		}
		return items[i].Name < items[j].Name
	})

	return &DirectoryListResult{
		Success: true,
		Items:   items,
	}, nil
}

func PushFileToDevice(connectKey string, localPath string, remotePath string) (*AdbResult, error) {
	if _, err := os.Stat(localPath); os.IsNotExist(err) {
		return &AdbResult{
			Success: false,
			Error:   fmt.Sprintf("本地文件不存在: %s", localPath),
		}, err
	}

	info, err := os.Stat(localPath)
	if err != nil {
		return &AdbResult{
			Success: false,
			Error:   err.Error(),
		}, err
	}

	if info.IsDir() {
		return &AdbResult{
			Success: false,
			Error:   "暂不支持目录传输，请选择文件",
		}, fmt.Errorf("暂不支持目录传输")
	}

	args := []string{"-s", connectKey, "push", localPath, remotePath}
	result, err := ExecuteAdbWithTimeout(args, 120*time.Second)
	if err != nil {
		return result, err
	}

	if strings.Contains(result.Output, "file pushed") || strings.Contains(result.Output, "files pushed") {
		return &AdbResult{
			Success: true,
			Output:  result.Output,
		}, nil
	}

	return result, nil
}

func PullFileFromDevice(connectKey string, remotePath string, localPath string) (*AdbResult, error) {
	targetDir := filepath.Dir(localPath)
	if err := os.MkdirAll(targetDir, 0755); err != nil {
		return &AdbResult{
			Success: false,
			Error:   fmt.Sprintf("创建目标目录失败: %v", err),
		}, err
	}

	args := []string{"-s", connectKey, "pull", remotePath, localPath}
	result, err := ExecuteAdbWithTimeout(args, 120*time.Second)
	if err != nil {
		return result, err
	}

	if _, err := os.Stat(localPath); err == nil {
		if strings.Contains(result.Output, "file pulled") || strings.Contains(result.Output, "files pulled") || result.Success {
			return &AdbResult{
				Success: true,
				Output:  result.Output,
			}, nil
		}
	}

	if !result.Success {
		return result, nil
	}

	return &AdbResult{
		Success: false,
		Error:   "文件传输完成但目标文件不存在",
	}, nil
}

func DeleteDeviceFile(connectKey string, filePath string) *AdbResult {
	args := []string{"-s", connectKey, "shell", "rm", "-f", filePath}

	result, err := ExecuteAdbWithTimeout(args, 30*time.Second)
	if err != nil {
		return &AdbResult{
			Success: false,
			Error:   fmt.Sprintf("执行删除命令失败: %v", err),
		}
	}

	if result.Success {
		return &AdbResult{
			Success: true,
			Output:  "文件已删除",
		}
	}

	if result.Error == "" {
		return &AdbResult{
			Success: true,
			Output:  "文件已删除",
		}
	}

	return result
}
