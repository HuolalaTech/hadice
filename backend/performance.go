package backend

import (
	"Hadice/backend/adb"
	"Hadice/backend/device"
	"Hadice/backend/hdc"
)

// getDevicePlatform 获取设备平台类型
func getDevicePlatform(connectKey string) device.Platform {
	if deviceManager == nil {
		return device.PlatformHarmonyOS
	}
	return deviceManager.GetDevicePlatform(connectKey)
}

// GetCpuDetailInfo 获取详细 CPU 使用信息
func (a *App) GetCpuDetailInfo(connectKey string) (*hdc.CpuDetailInfo, error) {
	if getDevicePlatform(connectKey) == device.PlatformAndroid {
		return adb.GetCpuDetailInfo(connectKey)
	}
	return hdc.GetCpuDetailInfo(connectKey)
}

// GetProcessCpuUsage 获取进程级 CPU 使用率
func (a *App) GetProcessCpuUsage(connectKey string, pid int) ([]hdc.ProcessCpuEntry, error) {
	if getDevicePlatform(connectKey) == device.PlatformAndroid {
		return adb.GetProcessCpuUsage(connectKey, pid)
	}
	return hdc.GetProcessCpuUsage(connectKey, pid)
}

// GetMemoryDetailInfo 获取详细内存信息
func (a *App) GetMemoryDetailInfo(connectKey string) (*hdc.MemoryDetailInfo, error) {
	if getDevicePlatform(connectKey) == device.PlatformAndroid {
		return adb.GetMemoryDetailInfo(connectKey)
	}
	return hdc.GetMemoryDetailInfo(connectKey)
}

// GetNetworkTrafficInfo 获取网络流量信息
func (a *App) GetNetworkTrafficInfo(connectKey string) ([]hdc.NetworkTrafficInfo, error) {
	if getDevicePlatform(connectKey) == device.PlatformAndroid {
		return adb.GetNetworkTrafficInfo(connectKey)
	}
	return hdc.GetNetworkTrafficInfo(connectKey)
}

// GetGraphicsInfo 获取图形性能信息
func (a *App) GetGraphicsInfo(connectKey string) (*hdc.GraphicsInfo, error) {
	if getDevicePlatform(connectKey) == device.PlatformAndroid {
		return adb.GetGraphicsInfo(connectKey)
	}
	return hdc.GetGraphicsInfo(connectKey)
}

// GetGraphicsInfoWithPid 获取图形性能信息（带 PID，用于安卓 FPS）
func (a *App) GetGraphicsInfoWithPid(connectKey string, pid int) (*hdc.GraphicsInfo, error) {
	if getDevicePlatform(connectKey) == device.PlatformAndroid {
		return adb.GetGraphicsInfoWithPid(connectKey, pid)
	}
	return hdc.GetGraphicsInfo(connectKey)
}

// GetUptimeInfo 获取系统运行时间信息
func (a *App) GetUptimeInfo(connectKey string) (map[string]interface{}, error) {
	if getDevicePlatform(connectKey) == device.PlatformAndroid {
		return adb.GetUptimeInfo(connectKey)
	}
	return hdc.GetUptimeInfo(connectKey)
}

// GetCpuFreqInfo 获取 CPU 频率信息
func (a *App) GetCpuFreqInfo(connectKey string) (*hdc.CpuFreqInfo, error) {
	if getDevicePlatform(connectKey) == device.PlatformAndroid {
		return adb.GetCpuFreqInfo(connectKey)
	}
	return hdc.GetCpuFreqInfo(connectKey)
}

// GetProcessMemoryDetail 获取进程内存详情
func (a *App) GetProcessMemoryDetail(connectKey string, pid int) (*hdc.ProcessMemoryDetail, error) {
	if getDevicePlatform(connectKey) == device.PlatformAndroid {
		return adb.GetProcessMemoryDetail(connectKey, pid)
	}
	return hdc.GetProcessMemoryDetail(connectKey, pid)
}

// GetFaultLogList 获取故障日志列表
func (a *App) GetFaultLogList(connectKey string, processName string, n int) ([]hdc.FaultLogEntry, error) {
	if getDevicePlatform(connectKey) == device.PlatformAndroid {
		return adb.GetFaultLogList(connectKey, processName, n)
	}
	return hdc.GetFaultLogList(connectKey, processName, n)
}

// GetFaultLogDetail 获取故障日志详情
func (a *App) GetFaultLogDetail(connectKey string, recordId string) (string, error) {
	if getDevicePlatform(connectKey) == device.PlatformAndroid {
		return adb.GetFaultLogDetail(connectKey, recordId)
	}
	return hdc.GetFaultLogDetail(connectKey, recordId)
}

// GetProcessIOInfo 获取进程 IO 信息
func (a *App) GetProcessIOInfo(connectKey string, pid int) (*hdc.ProcessIOInfo, error) {
	if getDevicePlatform(connectKey) == device.PlatformAndroid {
		return adb.GetProcessIOInfo(connectKey, pid)
	}
	return hdc.GetProcessIOInfo(connectKey, pid)
}

// StartIpcStat 开始 IPC 统计
func (a *App) StartIpcStat(connectKey string, pid int) error {
	if getDevicePlatform(connectKey) == device.PlatformAndroid {
		return nil
	}
	return hdc.StartIpcStat(connectKey, pid)
}

// GetIpcStat 获取 IPC 统计数据
func (a *App) GetIpcStat(connectKey string, pid int) (*hdc.IpcStatInfo, error) {
	if getDevicePlatform(connectKey) == device.PlatformAndroid {
		return &hdc.IpcStatInfo{}, nil
	}
	return hdc.GetIpcStat(connectKey, pid)
}

// StopIpcStat 停止 IPC 统计
func (a *App) StopIpcStat(connectKey string, pid int) error {
	if getDevicePlatform(connectKey) == device.PlatformAndroid {
		return nil
	}
	return hdc.StopIpcStat(connectKey, pid)
}
