package applayout

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"Hadice/backend/adb"
	"Hadice/backend/device"
	"Hadice/backend/hdc"
)

const (
	remoteHarmonyDump = "/data/local/tmp/hadice_layout.json"
	remoteAndroidDump = "/data/local/tmp/hadice_layout.xml"
)

func dumpTree(connectKey string, platform string) (*Node, string, error) {
	switch platform {
	case string(device.PlatformAndroid):
		root, err := dumpAndroid(connectKey)
		return root, "android-xml", err
	default:
		root, err := dumpHarmony(connectKey)
		return root, "harmony-json", err
	}
}

func dumpHarmony(connectKey string) (*Node, error) {
	_, _ = hdc.ExecuteHdc([]string{"-t", connectKey, "shell", "rm", "-f", remoteHarmonyDump})
	result, err := hdc.ExecuteHdcWithTimeout(
		[]string{"-t", connectKey, "shell", "uitest", "dumpLayout", "-p", remoteHarmonyDump},
		45*time.Second,
	)
	if err != nil {
		return nil, fmt.Errorf("uitest dumpLayout 失败: %w", err)
	}
	if result != nil && !result.Success && result.Error != "" {
		return nil, fmt.Errorf("uitest dumpLayout 失败: %s", result.Error)
	}

	localPath, err := pullToTemp(connectKey, string(device.PlatformHarmonyOS), remoteHarmonyDump, ".json")
	if err != nil {
		// fallback: shell cat
		cat, catErr := hdc.ExecuteHdcWithTimeout(
			[]string{"-t", connectKey, "shell", "cat", remoteHarmonyDump},
			30*time.Second,
		)
		if catErr != nil || cat == nil || cat.Output == "" {
			out := ""
			if result != nil {
				out = result.Output
			}
			return nil, fmt.Errorf("拉取布局文件失败: %v; dump 输出: %s", err, out)
		}
		return parseHarmonyJSON([]byte(cat.Output))
	}
	defer os.Remove(localPath)

	data, err := os.ReadFile(localPath)
	if err != nil {
		return nil, err
	}
	if len(strings.TrimSpace(string(data))) == 0 {
		return nil, fmt.Errorf("布局文件为空，请确认目标页已在前台")
	}
	return parseHarmonyJSON(data)
}

func dumpAndroid(connectKey string) (*Node, error) {
	_, _ = adb.ExecuteAdb([]string{"-s", connectKey, "shell", "rm", "-f", remoteAndroidDump})
	result, err := adb.ExecuteAdbWithTimeout(
		[]string{"-s", connectKey, "shell", "uiautomator", "dump", remoteAndroidDump},
		45*time.Second,
	)
	if err != nil || (result != nil && !result.Success) {
		// 部分机型需要 --compressed
		result2, err2 := adb.ExecuteAdbWithTimeout(
			[]string{"-s", connectKey, "shell", "uiautomator", "dump", "--compressed", remoteAndroidDump},
			45*time.Second,
		)
		if err2 != nil || (result2 != nil && !result2.Success) {
			msg := "uiautomator dump 失败"
			if result != nil && result.Error != "" {
				msg = result.Error
			} else if err != nil {
				msg = err.Error()
			}
			return nil, fmt.Errorf("%s", msg)
		}
	}

	localPath, err := pullToTemp(connectKey, string(device.PlatformAndroid), remoteAndroidDump, ".xml")
	if err != nil {
		cat, catErr := adb.ExecuteAdbWithTimeout(
			[]string{"-s", connectKey, "shell", "cat", remoteAndroidDump},
			30*time.Second,
		)
		if catErr != nil || cat == nil || cat.Output == "" {
			return nil, fmt.Errorf("拉取布局文件失败: %v", err)
		}
		return parseAndroidXML([]byte(cat.Output))
	}
	defer os.Remove(localPath)

	data, err := os.ReadFile(localPath)
	if err != nil {
		return nil, err
	}
	if len(strings.TrimSpace(string(data))) == 0 {
		return nil, fmt.Errorf("布局文件为空，请确认目标页已在前台")
	}
	return parseAndroidXML(data)
}

func pullToTemp(connectKey, platform, remotePath, ext string) (string, error) {
	tmpDir, err := os.MkdirTemp("", "hadice-applayout-*")
	if err != nil {
		return "", err
	}
	localPath := filepath.Join(tmpDir, "layout"+ext)

	switch platform {
	case string(device.PlatformAndroid):
		res, err := adb.PullFileFromDevice(connectKey, remotePath, localPath)
		if err != nil || res == nil || !res.Success {
			os.RemoveAll(tmpDir)
			if err != nil {
				return "", err
			}
			return "", fmt.Errorf("adb pull 失败")
		}
	default:
		res, err := hdc.PullFileFromDevice(connectKey, remotePath, localPath)
		if err != nil || res == nil || !res.Success {
			os.RemoveAll(tmpDir)
			if err != nil {
				return "", err
			}
			return "", fmt.Errorf("hdc file recv 失败")
		}
	}

	if _, err := os.Stat(localPath); err != nil {
		os.RemoveAll(tmpDir)
		return "", err
	}
	return localPath, nil
}
