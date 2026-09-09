package hiprofiler

import (
	"fmt"
	"log"
	"strconv"
	"strings"
	"time"

	"Hadice/backend/hdc"
)

// HarmonyAppInfo 表示一个鸿蒙可调试应用的信息
type HarmonyAppInfo struct {
	BundleName  string `json:"bundleName"`
	AppName     string `json:"appName"`
	ProcessName string `json:"processName"`
	PID         int    `json:"pid"`
}

// GetDebuggableApps 获取设备上可调试的 HarmonyOS 应用列表
// 通过 bm dump -g 获取 debug 签名的应用，再通过 ps -ef 获取运行中进程的 PID
func GetDebuggableApps(deviceID string) ([]HarmonyAppInfo, error) {
	// 1. 获取 debug 签名的 bundle 列表
	bundles, err := getDebuggableBundles(deviceID)
	if err != nil {
		return nil, fmt.Errorf("获取可调试应用列表失败: %w", err)
	}

	log.Printf("[HiProfiler] bm dump -g 返回 %d 个 bundle", len(bundles))

	if len(bundles) == 0 {
		return []HarmonyAppInfo{}, nil
	}

	// 2. 获取运行中的进程列表
	processes, err := getRunningProcesses(deviceID)
	if err != nil {
		log.Printf("[HiProfiler] 获取进程列表失败: %v，仅返回 bundle 信息", err)
		var apps []HarmonyAppInfo
		for _, b := range bundles {
			apps = append(apps, HarmonyAppInfo{
				BundleName:  b,
				AppName:     b,
				ProcessName: b,
				PID:         0,
			})
		}
		return apps, nil
	}

	// 3. 匹配 bundle 与运行中进程
	var apps []HarmonyAppInfo
	for _, bundle := range bundles {
		for _, proc := range processes {
			if proc.BundleName == bundle || strings.HasPrefix(proc.ProcessName, bundle) {
				apps = append(apps, HarmonyAppInfo{
					BundleName:  bundle,
					AppName:     bundle,
					ProcessName: proc.ProcessName,
					PID:         proc.PID,
				})
			}
		}
	}

	return apps, nil
}

// getDebuggableBundles 执行 bm dump -g 获取 debug 签名的 bundle 列表
// 输出格式：
//
//	ID: 100:
//	        com.example.debugapp
//	        com.example.another.debug
//	ID: 200:
//	        com.test.myapplication
func getDebuggableBundles(deviceID string) ([]string, error) {
	args := []string{"-t", deviceID, "shell", "bm", "dump", "-g"}
	result, err := hdc.ExecuteHdcWithTimeout(args, 15*time.Second)
	if err != nil {
		return nil, fmt.Errorf("执行 bm dump -g 失败: %w", err)
	}
	if !result.Success {
		return nil, fmt.Errorf("bm dump -g 失败: %s", result.Error)
	}

	log.Printf("[HiProfiler] bm dump -g 原始输出:\n%s", result.Output)

	var bundles []string
	for _, line := range strings.Split(result.Output, "\n") {
		trimmed := strings.TrimSpace(line)
		// 跳过空行和 "ID:" 分组行
		if trimmed == "" || strings.HasPrefix(trimmed, "ID:") {
			continue
		}
		// bundle name 通常是类似 com.xxx.yyy 的格式
		if strings.Contains(trimmed, ".") && !strings.HasPrefix(trimmed, "-") {
			bundles = append(bundles, trimmed)
		}
	}

	return bundles, nil
}

// processInfo 运行中的进程信息
type processInfo struct {
	ProcessName string
	BundleName  string
	PID         int
}

// getRunningProcesses 获取设备上运行中的进程
func getRunningProcesses(deviceID string) ([]processInfo, error) {
	args := []string{"-t", deviceID, "shell", "ps", "-ef"}
	result, err := hdc.ExecuteHdcWithTimeout(args, 10*time.Second)
	if err != nil {
		return nil, err
	}
	if !result.Success {
		return nil, fmt.Errorf("ps -ef 失败: %s", result.Error)
	}

	var processes []processInfo
	for _, line := range strings.Split(result.Output, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 8 {
			continue
		}

		pid, err := strconv.Atoi(fields[1])
		if err != nil {
			continue
		}

		cmd := strings.Join(fields[7:], " ")
		if pid > 0 && cmd != "" {
			bundleName := cmd
			if idx := strings.Index(cmd, ":"); idx > 0 {
				bundleName = cmd[:idx]
			}
			processes = append(processes, processInfo{
				ProcessName: cmd,
				BundleName:  bundleName,
				PID:         pid,
			})
		}
	}

	return processes, nil
}

// QueryPidByProcessName 按完整进程名查询当前 PID。
// found=false 表示查询成功但进程不存在；err!=nil 表示 HDC/设备查询失败，
// 调用方不能把两者都当作进程退出。
func QueryPidByProcessName(deviceID string, processName string) (pid int, found bool, err error) {
	if strings.TrimSpace(processName) == "" {
		return 0, false, fmt.Errorf("进程名不能为空")
	}

	processes, err := getRunningProcesses(deviceID)
	if err != nil {
		return 0, false, err
	}
	for _, proc := range processes {
		if proc.ProcessName == processName {
			return proc.PID, true, nil
		}
	}
	return 0, false, nil
}

// IsProcessAlive 检查指定 PID + 进程名的进程是否仍在运行。
// 保留此方法供兼容调用；需要区分查询失败与进程退出时应使用 QueryPidByProcessName。
func IsProcessAlive(deviceID string, pid int, processName string) bool {
	currentPID, found, err := QueryPidByProcessName(deviceID, processName)
	return err == nil && found && currentPID == pid
}
