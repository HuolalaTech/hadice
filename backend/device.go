package backend

import (
	"fmt"
	"log"

	"Hadice/backend/adb"
	"Hadice/backend/device"
	"Hadice/backend/hdc"
)

var deviceManager *device.Manager

func init() {
	deviceManager = device.NewManager()
	deviceManager.RegisterProvider(hdc.NewProvider())
	deviceManager.RegisterProvider(adb.NewProvider())
	log.Println("[Backend] 设备管理器初始化完成")
}

// getProviderByPlatform 根据平台类型获取对应的 Provider
func getProviderByPlatform(platform string) (device.DeviceProvider, error) {
	var p device.Platform
	switch platform {
	case "android":
		p = device.PlatformAndroid
	case "harmonyos":
		p = device.PlatformHarmonyOS
	default:
		p = device.PlatformHarmonyOS
	}

	provider := deviceManager.GetProvider(p)
	if provider == nil {
		return nil, fmt.Errorf("provider not available for platform: %s", platform)
	}
	return provider, nil
}

// ============ 统一设备 API（带 platform 参数）============

// ListAllDevices 获取所有设备（鸿蒙 + 安卓）
func (a *App) ListAllDevices(verbose bool) ([]device.Device, error) {
	return deviceManager.ListAllDevices(verbose)
}

// GetDeviceDetailInfoByPlatform 获取设备详细信息（根据平台路由）
func (a *App) GetDeviceDetailInfoByPlatform(connectKey string, platform string) (*device.DeviceDetailInfo, error) {
	provider, err := getProviderByPlatform(platform)
	if err != nil {
		return nil, err
	}
	return provider.GetDeviceDetailInfo(connectKey)
}

// GetBatteryInfoByPlatform 获取电池信息（根据平台路由）
func (a *App) GetBatteryInfoByPlatform(connectKey string, platform string) (*device.BatteryInfo, error) {
	provider, err := getProviderByPlatform(platform)
	if err != nil {
		return nil, err
	}
	return provider.GetBatteryInfo(connectKey)
}

// GetMemoryInfoByPlatform 获取内存信息（根据平台路由）
func (a *App) GetMemoryInfoByPlatform(connectKey string, platform string) (*device.MemoryInfo, error) {
	provider, err := getProviderByPlatform(platform)
	if err != nil {
		return nil, err
	}
	return provider.GetMemoryInfo(connectKey)
}

// GetStorageInfoByPlatform 获取存储信息（根据平台路由）
func (a *App) GetStorageInfoByPlatform(connectKey string, platform string) (*device.StorageInfo, error) {
	provider, err := getProviderByPlatform(platform)
	if err != nil {
		return nil, err
	}
	return provider.GetStorageInfo(connectKey)
}

// GetCpuUsageInfoByPlatform 获取 CPU 使用信息（根据平台路由）
func (a *App) GetCpuUsageInfoByPlatform(connectKey string, platform string) (*device.CpuUsageInfo, error) {
	provider, err := getProviderByPlatform(platform)
	if err != nil {
		return nil, err
	}
	return provider.GetCpuUsageInfo(connectKey)
}

// GetNetworkInfoByPlatform 获取网络信息（根据平台路由）
func (a *App) GetNetworkInfoByPlatform(connectKey string, platform string) ([]device.NetworkInfo, error) {
	provider, err := getProviderByPlatform(platform)
	if err != nil {
		return nil, err
	}
	return provider.GetNetworkInfo(connectKey)
}

// GetSystemRuntimeByPlatform 获取系统运行信息（根据平台路由）
func (a *App) GetSystemRuntimeByPlatform(connectKey string, platform string) (*device.SystemRuntime, error) {
	provider, err := getProviderByPlatform(platform)
	if err != nil {
		return nil, err
	}
	return provider.GetSystemRuntime(connectKey)
}

// GetSystemPropertiesByPlatform 获取系统属性（根据平台路由）
func (a *App) GetSystemPropertiesByPlatform(connectKey string, platform string) (device.SystemProperties, error) {
	provider, err := getProviderByPlatform(platform)
	if err != nil {
		return nil, err
	}
	return provider.GetSystemProperties(connectKey)
}

// GetDeviceUdidByPlatform 获取设备唯一标识（根据平台路由）
func (a *App) GetDeviceUdidByPlatform(connectKey string, platform string) (string, error) {
	provider, err := getProviderByPlatform(platform)
	if err != nil {
		return "", err
	}
	return provider.GetDeviceUdid(connectKey)
}

// ============ 鸿蒙设备 API（保持向后兼容）============

// ListDevices 获取设备列表（基础信息）
func (a *App) ListDevices(verbose bool) ([]hdc.HdcDevice, error) {
	return hdc.ListDevices(verbose)
}

// ListDevicesWithInfo 获取设备列表（包含产品名称、型号等）
func (a *App) ListDevicesWithInfo() ([]hdc.HdcDevice, error) {
	return hdc.ListDevicesWithInfo()
}

// WaitForDevice 等待设备连接
func (a *App) WaitForDevice(connectKey string) (*hdc.HdcResult, error) {
	return hdc.WaitForDevice(connectKey)
}

// GetHdcVersion 获取 HDC 版本
func (a *App) GetHdcVersion() (string, error) {
	return hdc.GetHdcVersion()
}

// CheckServer 检查服务状态
func (a *App) CheckServer() (map[string]string, error) {
	return hdc.CheckServer()
}

// StartServer 启动服务
func (a *App) StartServer() (*hdc.HdcResult, error) {
	return hdc.StartServer()
}

// KillServer 终止服务
func (a *App) KillServer() (*hdc.HdcResult, error) {
	return hdc.KillServer()
}

// RestartServer 重启服务
func (a *App) RestartServer() (*hdc.HdcResult, error) {
	return hdc.RestartServer()
}

// ConnectDevice TCP 连接设备
func (a *App) ConnectDevice(ipPort string) (*hdc.HdcResult, error) {
	return hdc.ConnectDevice(ipPort)
}

// DisconnectDevice 断开 TCP 连接
func (a *App) DisconnectDevice(ipPort string) (*hdc.HdcResult, error) {
	return hdc.DisconnectDevice(ipPort)
}

// GetDeviceProperty 获取设备属性
func (a *App) GetDeviceProperty(connectKey string, property string) (string, error) {
	if deviceManager.GetDevicePlatform(connectKey) == device.PlatformAndroid {
		return adb.GetDeviceProperty(connectKey, property)
	}
	return hdc.GetDeviceProperty(connectKey, property)
}

// GetDeviceInfo 获取设备基本信息（产品名称和型号）
func (a *App) GetDeviceInfo(connectKey string) (*hdc.DeviceInfo, error) {
	if deviceManager.GetDevicePlatform(connectKey) == device.PlatformAndroid {
		return adb.GetDeviceInfo(connectKey)
	}
	return hdc.GetDeviceInfo(connectKey)
}

// GetDeviceDetailInfo 获取设备完整详细信息（兼容旧 API，默认鸿蒙）
func (a *App) GetDeviceDetailInfo(connectKey string) (*hdc.DeviceDetailInfo, error) {
	if deviceManager.GetDevicePlatform(connectKey) == device.PlatformAndroid {
		return adb.GetDeviceDetailInfo(connectKey)
	}
	return hdc.GetDeviceDetailInfo(connectKey)
}

// GetBatteryInfo 获取电池信息（兼容旧 API，默认鸿蒙）
func (a *App) GetBatteryInfo(connectKey string) (*hdc.BatteryInfo, error) {
	if deviceManager.GetDevicePlatform(connectKey) == device.PlatformAndroid {
		return adb.GetBatteryInfo(connectKey)
	}
	return hdc.GetBatteryInfo(connectKey)
}

// GetMemoryInfo 获取内存信息（兼容旧 API，默认鸿蒙）
func (a *App) GetMemoryInfo(connectKey string) (*hdc.MemoryInfo, error) {
	if deviceManager.GetDevicePlatform(connectKey) == device.PlatformAndroid {
		return adb.GetMemoryInfo(connectKey)
	}
	return hdc.GetMemoryInfo(connectKey)
}

// GetStorageInfo 获取存储信息（兼容旧 API，默认鸿蒙）
func (a *App) GetStorageInfo(connectKey string) (*hdc.StorageInfo, error) {
	if deviceManager.GetDevicePlatform(connectKey) == device.PlatformAndroid {
		return adb.GetStorageInfo(connectKey)
	}
	return hdc.GetStorageInfo(connectKey)
}

// GetCpuUsageInfo 获取 CPU 使用信息（兼容旧 API，默认鸿蒙）
func (a *App) GetCpuUsageInfo(connectKey string) (*hdc.CpuUsageInfo, error) {
	if deviceManager.GetDevicePlatform(connectKey) == device.PlatformAndroid {
		return adb.GetCpuUsageInfo(connectKey)
	}
	return hdc.GetCpuUsageInfo(connectKey)
}

// GetNetworkInfo 获取网络信息（兼容旧 API，默认鸿蒙）
func (a *App) GetNetworkInfo(connectKey string) ([]hdc.NetworkInfo, error) {
	if deviceManager.GetDevicePlatform(connectKey) == device.PlatformAndroid {
		return adb.GetNetworkInfo(connectKey)
	}
	return hdc.GetNetworkInfo(connectKey)
}

// GetSystemRuntime 获取系统运行信息（兼容旧 API，默认鸿蒙）
func (a *App) GetSystemRuntime(connectKey string) (*hdc.SystemRuntime, error) {
	if deviceManager.GetDevicePlatform(connectKey) == device.PlatformAndroid {
		return adb.GetSystemRuntime(connectKey)
	}
	return hdc.GetSystemRuntime(connectKey)
}

// GetSystemProperties 获取所有系统属性（兼容旧 API，默认鸿蒙）
func (a *App) GetSystemProperties(connectKey string) (hdc.SystemProperties, error) {
	if deviceManager.GetDevicePlatform(connectKey) == device.PlatformAndroid {
		return adb.GetSystemProperties(connectKey)
	}
	return hdc.GetSystemProperties(connectKey)
}

// ExecuteHdc 执行任意 HDC 命令
func (a *App) ExecuteHdc(args []string) (*hdc.HdcResult, error) {
	return hdc.ExecuteHdc(args)
}

// GetDeviceUdid 获取设备UDID（兼容旧 API，默认鸿蒙）
func (a *App) GetDeviceUdid(connectKey string) (string, error) {
	if deviceManager.GetDevicePlatform(connectKey) == device.PlatformAndroid {
		return adb.GetDeviceUdid(connectKey)
	}
	return hdc.GetDeviceUdid(connectKey)
}

// GetHdcDebugInfo 获取 HDC 调试信息（用于诊断）
func (a *App) GetHdcDebugInfo() map[string]string {
	return hdc.GetDebugInfo()
}

// ============ 安卓设备 API ============

// ListAdbDevices 获取安卓设备列表
func (a *App) ListAdbDevices(verbose bool) ([]device.Device, error) {
	provider := deviceManager.GetProvider(device.PlatformAndroid)
	if provider == nil {
		return nil, fmt.Errorf("ADB provider not available")
	}
	return provider.ListDevices(verbose)
}

// GetAdbVersion 获取 ADB 版本
func (a *App) GetAdbVersion() (string, error) {
	provider := deviceManager.GetProvider(device.PlatformAndroid)
	if provider == nil {
		return "Unknown", fmt.Errorf("ADB provider not available")
	}
	return provider.GetVersion()
}

// AdbStartServer 启动 ADB 服务
func (a *App) AdbStartServer() (*device.CommandResult, error) {
	provider := deviceManager.GetProvider(device.PlatformAndroid)
	if provider == nil {
		return nil, fmt.Errorf("ADB provider not available")
	}
	return provider.StartServer()
}

// AdbKillServer 终止 ADB 服务
func (a *App) AdbKillServer() (*device.CommandResult, error) {
	provider := deviceManager.GetProvider(device.PlatformAndroid)
	if provider == nil {
		return nil, fmt.Errorf("ADB provider not available")
	}
	return provider.KillServer()
}

// AdbConnectDevice TCP 连接安卓设备
func (a *App) AdbConnectDevice(ipPort string) (*device.CommandResult, error) {
	provider := deviceManager.GetProvider(device.PlatformAndroid)
	if provider == nil {
		return nil, fmt.Errorf("ADB provider not available")
	}
	return provider.ConnectDevice(ipPort)
}

// AdbDisconnectDevice 断开安卓设备连接
func (a *App) AdbDisconnectDevice(ipPort string) (*device.CommandResult, error) {
	provider := deviceManager.GetProvider(device.PlatformAndroid)
	if provider == nil {
		return nil, fmt.Errorf("ADB provider not available")
	}
	return provider.DisconnectDevice(ipPort)
}

// ExecuteAdb 执行任意 ADB 命令
func (a *App) ExecuteAdb(args []string) (*adb.AdbResult, error) {
	return adb.ExecuteAdb(args)
}

// GetAdbDebugInfo 获取 ADB 调试信息
func (a *App) GetAdbDebugInfo() map[string]string {
	return adb.GetDebugInfo()
}

// GetAndroidAppList 获取安卓设备应用列表
func (a *App) GetAndroidAppList(connectKey string) (*adb.AndroidAppListResult, error) {
	return adb.GetAndroidAppList(connectKey)
}
