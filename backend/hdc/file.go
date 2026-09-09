package hdc

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

// FileItem 文件/目录项信息
type FileItem struct {
	Name         string `json:"name"`                  // 名称
	Path         string `json:"path"`                  // 完整路径
	IsDirectory  bool   `json:"isDirectory"`           // 是否为目录
	Size         int64  `json:"size"`                  // 文件大小（字节），目录为 0
	ModifiedTime int64  `json:"modifiedTime"`          // 修改时间（毫秒时间戳）
	Permissions  string `json:"permissions,omitempty"` // 权限字符串（如 "drwxr-xr-x"）
}

// DirectoryListResult 目录列表结果
type DirectoryListResult struct {
	Success bool       `json:"success"`
	Items   []FileItem `json:"items,omitempty"`
	Error   string     `json:"error,omitempty"`
}

// ListDeviceDirectory 列出设备目录内容
func ListDeviceDirectory(connectKey string, path string) (*DirectoryListResult, error) {
	// 使用 ls -la 命令列出目录内容
	result, err := ExecuteHdcWithTimeout([]string{"-t", connectKey, "shell", "ls", "-la", path}, 30*time.Second)
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
		// 跳过总计行和空行
		if strings.HasPrefix(line, "total") || line == "" {
			continue
		}

		// 解析 ls -la 输出格式
		// 格式1: -rw-r--r-- 1 root root 1234 2024-01-01 12:00 filename
		// 格式2: drwxr-xr-x 2 root root 4096 Jan 01 12:00 dirname
		// 格式3: -rw-r--r-- 1 root root 1234 Jan 01 2024 filename
		// 格式4: -rw-r--r-- 1 root root 1234 Jan 01 12:00 file name with spaces
		// 权限字段总是在第一位，文件名在最后（可能包含空格）

		// 检查权限字段格式（第一位应该是类似 -rw-r--r-- 或 drwxr-xr-x）
		// 权限字段格式：d/rwx/rwx/rwx (10个字符：类型+所有者+组+其他)
		if len(line) < 10 {
			continue
		}

		permissions := line[:10]
		isDirectory := strings.HasPrefix(permissions, "d")

		// 移除权限字段后的剩余部分
		rest := strings.TrimSpace(line[10:])
		if rest == "" {
			continue
		}

		// 使用正则表达式匹配固定格式的字段
		// 格式：链接数 用户 组 大小 日期 时间 文件名
		// 使用 Fields 分割，但文件名可能包含空格
		parts := strings.Fields(rest)
		if len(parts) < 6 {
			continue
		}

		// 解析文件大小
		var size int64
		if sizeVal, err := strconv.ParseInt(parts[3], 10, 64); err == nil {
			size = sizeVal
		}

		// 解析修改时间和文件名
		// 日期时间格式可能是：
		// 1. "2024-01-01 12:00 filename" (日期 时间 文件名)
		// 2. "Jan 01 12:00 filename" (月 日 时间 文件名)
		// 3. "Jan 01 2024 filename" (月 日 年份 文件名，当年文件不显示年份)
		// 从后往前找文件名开始位置
		// 策略：找到最后一个包含冒号的时间字段，文件名从它之后开始
		// 或者找到日期格式（YYYY-MM-DD），文件名从日期+时间之后开始

		dateTimeParts := parts[4:]
		nameStartIndex := len(dateTimeParts)

		// 方法1: 查找包含冒号的时间字段（如 "12:00" 或 "14:19"）
		for i := len(dateTimeParts) - 1; i >= 0; i-- {
			if strings.Contains(dateTimeParts[i], ":") {
				// 找到时间字段，文件名从下一个字段开始
				nameStartIndex = i + 1
				break
			}
		}

		// 方法2: 如果没有找到时间字段，查找日期格式（YYYY-MM-DD）
		if nameStartIndex == len(dateTimeParts) {
			for i := 0; i < len(dateTimeParts); i++ {
				// 匹配 YYYY-MM-DD 格式
				if matched, _ := regexp.MatchString(`^\d{4}-\d{2}-\d{2}$`, dateTimeParts[i]); matched {
					// 日期后面可能跟着时间，文件名从日期+时间之后开始
					// 通常格式是：日期 时间 文件名，所以文件名从第3个字段开始
					if i+2 < len(dateTimeParts) {
						nameStartIndex = i + 2
					} else {
						nameStartIndex = i + 1
					}
					break
				}
			}
		}

		// 如果还是没找到，尝试其他格式
		if nameStartIndex == len(dateTimeParts) {
			// 可能是 "Jan 01 2024 filename" 格式
			if len(dateTimeParts) >= 4 {
				if matched, _ := regexp.MatchString(`^\d{4}$`, dateTimeParts[2]); matched {
					nameStartIndex = 3
				} else if len(dateTimeParts) >= 2 {
					// 默认从倒数第2个开始（假设最后一个是文件名）
					nameStartIndex = len(dateTimeParts) - 1
				}
			} else if len(dateTimeParts) >= 2 {
				nameStartIndex = len(dateTimeParts) - 1
			}
		}

		// 提取文件名
		var fileName string
		if nameStartIndex < len(dateTimeParts) {
			fileName = strings.Join(dateTimeParts[nameStartIndex:], " ")
		} else {
			// 如果解析失败，使用最后一个字段
			fileName = dateTimeParts[len(dateTimeParts)-1]
		}

		// 跳过 . 和 ..
		if fileName == "." || fileName == ".." {
			continue
		}

		// 解析修改时间
		var modifiedTime int64 = time.Now().UnixMilli()
		if nameStartIndex > 0 {
			dateParts := dateTimeParts[:nameStartIndex]
			dateStr := strings.Join(dateParts, " ")
			// 尝试解析日期
			if t, err := time.Parse("2006-01-02 15:04", dateStr); err == nil {
				modifiedTime = t.UnixMilli()
			} else if t, err := time.Parse("Jan 02 15:04", dateStr); err == nil {
				// 使用当前年份
				now := time.Now()
				t = time.Date(now.Year(), t.Month(), t.Day(), t.Hour(), t.Minute(), 0, 0, time.Local)
				modifiedTime = t.UnixMilli()
			} else if t, err := time.Parse("Jan 02 2006", dateStr); err == nil {
				modifiedTime = t.UnixMilli()
			}
		}

		// 构建完整路径
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

	// 排序：目录在前，然后按名称排序
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

// ListLocalDirectory 列出本地目录内容
func ListLocalDirectory(path string) (*DirectoryListResult, error) {
	// 检查目录是否存在
	info, err := os.Stat(path)
	if err != nil {
		return &DirectoryListResult{
			Success: false,
			Error:   "目录不存在",
		}, err
	}

	if !info.IsDir() {
		return &DirectoryListResult{
			Success: false,
			Error:   "路径不是目录",
		}, fmt.Errorf("路径不是目录")
	}

	// 读取目录
	entries, err := os.ReadDir(path)
	if err != nil {
		return &DirectoryListResult{
			Success: false,
			Error:   err.Error(),
		}, err
	}

	items := []FileItem{}
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			continue
		}

		fullPath := filepath.Join(path, entry.Name())
		items = append(items, FileItem{
			Name:         entry.Name(),
			Path:         fullPath,
			IsDirectory:  entry.IsDir(),
			Size:         info.Size(),
			ModifiedTime: info.ModTime().UnixMilli(),
		})
	}

	// 排序：目录在前，然后按名称排序
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

// PushFileToDevice 推送文件到设备
func PushFileToDevice(connectKey string, localPath string, remotePath string) (*HdcResult, error) {
	// 检查本地文件是否存在
	if _, err := os.Stat(localPath); os.IsNotExist(err) {
		return &HdcResult{
			Success: false,
			Error:   fmt.Sprintf("本地文件不存在: %s", localPath),
		}, err
	}

	// 检查是否为目录
	info, err := os.Stat(localPath)
	if err != nil {
		return &HdcResult{
			Success: false,
			Error:   err.Error(),
		}, err
	}

	if info.IsDir() {
		return &HdcResult{
			Success: false,
			Error:   "暂不支持目录传输，请选择文件",
		}, fmt.Errorf("暂不支持目录传输")
	}

	// 使用 hdc file send 命令推送文件
	result, err := ExecuteHdcWithTimeout([]string{"-t", connectKey, "file", "send", localPath, remotePath}, 120*time.Second)
	if err != nil {
		return result, err
	}

	// 检查输出中是否包含成功信息
	if strings.Contains(result.Output, "FileTransfer finish") {
		return &HdcResult{
			Success: true,
			Output:  result.Output,
		}, nil
	}

	return result, nil
}

// PullFileFromDevice 从设备拉取文件
func PullFileFromDevice(connectKey string, remotePath string, localPath string) (*HdcResult, error) {
	// 确保目标目录存在
	targetDir := filepath.Dir(localPath)
	if err := os.MkdirAll(targetDir, 0755); err != nil {
		return &HdcResult{
			Success: false,
			Error:   fmt.Sprintf("创建目标目录失败: %v", err),
		}, err
	}

	// 使用 hdc file recv 命令拉取文件
	result, err := ExecuteHdcWithTimeout([]string{"-t", connectKey, "file", "recv", remotePath, localPath}, 120*time.Second)
	if err != nil {
		return result, err
	}

	// 检查文件是否成功下载
	if _, err := os.Stat(localPath); err == nil {
		// 检查输出中是否包含成功信息
		if strings.Contains(result.Output, "FileTransfer finish") || result.Success {
			return &HdcResult{
				Success: true,
				Output:  result.Output,
			}, nil
		}
	}

	if !result.Success {
		return result, nil
	}

	// 如果命令执行成功但文件不存在，认为失败
	return &HdcResult{
		Success: false,
		Error:   "文件传输完成但目标文件不存在",
	}, nil
}

// GetUserHomeDirectory 获取用户主目录
func GetUserHomeDirectory() (string, error) {
	return os.UserHomeDir()
}

// GetUserDownloadsDirectory 获取用户下载目录
func GetUserDownloadsDirectory() (string, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(homeDir, "Downloads"), nil
}

// GetUserDocumentsDirectory 获取用户文档目录
func GetUserDocumentsDirectory() (string, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(homeDir, "Documents"), nil
}

// DeleteDeviceFile 删除设备上的文件
func DeleteDeviceFile(connectKey string, filePath string) *HdcResult {
	// 构建删除命令
	args := []string{"-t", connectKey, "shell", "rm", "-f", filePath}

	// 使用 hdc shell rm -f 命令删除设备上的文件
	result, err := ExecuteHdcWithTimeout(args, 30*time.Second)
	if err != nil {
		fmt.Printf("[HDC] 删除文件失败 (执行错误): %v\n", err)
		return &HdcResult{
			Success: false,
			Error:   fmt.Sprintf("执行删除命令失败: %v", err),
		}
	}

	if result.Success {
		return &HdcResult{
			Success: true,
			Output:  "文件已删除",
		}
	}

	// 即使命令返回失败，如果没有错误信息也认为成功（rm -f 不会报错）
	if result.Error == "" {
		return &HdcResult{
			Success: true,
			Output:  "文件已删除",
		}
	}

	fmt.Printf("[HDC] 文件删除失败: %s\n", result.Error)
	return result
}
