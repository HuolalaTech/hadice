package hdc

import (
	"fmt"
	"path/filepath"
	"strings"
	"time"
)

// GetAppPackageFiles 解析包安装目录下的 .hap / .hsp 文件路径。
func GetAppPackageFiles(connectKey string, packageName string) ([]string, error) {
	codePath, err := resolveCodePath(connectKey, packageName)
	if err != nil {
		return nil, err
	}

	files := listPackageFiles(connectKey, codePath)
	if len(files) == 0 {
		// 再扫一层子目录（部分机型 hap 在 module 子目录）
		lsResult, _ := ExecuteHdcWithTimeout(
			[]string{"-t", connectKey, "shell", "ls", "-1", codePath},
			10*time.Second,
		)
		if lsResult != nil && lsResult.Success {
			for _, name := range strings.Split(lsResult.Output, "\n") {
				name = strings.TrimSpace(name)
				if name == "" || strings.Contains(name, ".") {
					continue
				}
				sub := listPackageFiles(connectKey, filepath.ToSlash(filepath.Join(codePath, name)))
				files = append(files, sub...)
			}
		}
	}
	if len(files) == 0 {
		return nil, fmt.Errorf("未找到 hap/hsp: %s", codePath)
	}
	return files, nil
}

func listPackageFiles(connectKey string, dir string) []string {
	result, err := ExecuteHdcWithTimeout(
		[]string{"-t", connectKey, "shell", "ls", "-1", dir},
		10*time.Second,
	)
	if err != nil || result == nil || !result.Success {
		return nil
	}
	files := make([]string, 0)
	for _, name := range strings.Split(result.Output, "\n") {
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		lower := strings.ToLower(name)
		if strings.HasSuffix(lower, ".hap") || strings.HasSuffix(lower, ".hsp") {
			files = append(files, filepath.ToSlash(filepath.Join(dir, name)))
		}
	}
	return files
}

func resolveCodePath(connectKey string, packageName string) (string, error) {
	detail, err := GetAppFullDetail(connectKey, packageName)
	if err == nil && detail != nil && strings.TrimSpace(detail.CodePath) != "" {
		return strings.TrimSpace(detail.CodePath), nil
	}
	// fallback：公开安装目录
	return "/data/app/el1/bundle/public/" + packageName, nil
}

// ExportApp 将鸿蒙应用 hap/hsp 拉取到本地。
// 单文件：保存到 localPath；多模块：保存到与 localPath 同名的目录内。
func ExportApp(connectKey string, packageName string, localPath string) (string, error) {
	remoteFiles, err := GetAppPackageFiles(connectKey, packageName)
	if err != nil {
		return "", err
	}

	if len(remoteFiles) == 1 {
		result, pullErr := PullFileFromDevice(connectKey, remoteFiles[0], localPath)
		if pullErr != nil {
			return "", pullErr
		}
		if result == nil || !result.Success {
			errMsg := "pull failed"
			if result != nil && result.Error != "" {
				errMsg = result.Error
			}
			return "", fmt.Errorf("%s", errMsg)
		}
		return localPath, nil
	}

	dir := strings.TrimSuffix(localPath, filepath.Ext(localPath))
	if dir == "" || dir == localPath {
		dir = localPath + "_modules"
	}
	for _, remote := range remoteFiles {
		dest := filepath.Join(dir, filepath.Base(remote))
		result, pullErr := PullFileFromDevice(connectKey, remote, dest)
		if pullErr != nil {
			return "", pullErr
		}
		if result == nil || !result.Success {
			errMsg := "pull failed: " + remote
			if result != nil && result.Error != "" {
				errMsg = result.Error
			}
			return "", fmt.Errorf("%s", errMsg)
		}
	}
	return dir, nil
}
