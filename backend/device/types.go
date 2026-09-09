package device

// Platform 设备平台类型
type Platform string

const (
	PlatformHarmonyOS Platform = "harmonyos"
	PlatformAndroid   Platform = "android"
)

// CommandResult 命令执行结果
type CommandResult struct {
	Success bool   `json:"success"`
	Output  string `json:"output"`
	Error   string `json:"error,omitempty"`
}

// Device 统一设备信息
type Device struct {
	ConnectKey     string   `json:"connectKey"`            // 设备标识符
	ConnectionType string   `json:"connectionType"`        // 连接类型：USB 或 TCP
	Status         string   `json:"status"`                // 连接状态
	DeviceName     string   `json:"deviceName,omitempty"`  // 设备名称
	ProductName    string   `json:"productName,omitempty"` // 产品名称
	Model          string   `json:"model,omitempty"`       // 产品型号
	DisplayName    string   `json:"displayName,omitempty"` // 显示名称
	Platform       Platform `json:"platform"`              // 平台：harmonyos 或 android
}

// DeviceDetailInfo 设备详细信息
type DeviceDetailInfo struct {
	// 基本信息
	ProductName  string `json:"productName"`
	Model        string `json:"model"`
	Brand        string `json:"brand"`
	Manufacturer string `json:"manufacturer"`
	DeviceType   string `json:"deviceType"` // 设备形态（手机/平板等）
	SerialNumber string `json:"serialNumber"`
	// 系统信息
	OSName          string `json:"osName"`
	OSVersion       string `json:"osVersion"`
	APIVersion      string `json:"apiVersion"`
	SoftwareVersion string `json:"softwareVersion"`
	SecurityPatch   string `json:"securityPatch"`
	KernelVersion   string `json:"kernelVersion"`
	// 硬件信息
	CpuAbi          string `json:"cpuAbi"`
	HardwareVersion string `json:"hardwareVersion"`
}

// BatteryInfo 电池信息
type BatteryInfo struct {
	Capacity       int    `json:"capacity"`
	Temperature    int    `json:"temperature"`
	Voltage        int    `json:"voltage"`
	ChargingStatus string `json:"chargingStatus"`
	PluggedType    string `json:"pluggedType"`
	Technology     string `json:"technology"`
	Health         string `json:"health"`
}

// MemoryInfo 内存信息
type MemoryInfo struct {
	Total       int `json:"total"`
	Free        int `json:"free"`
	Available   int `json:"available"`
	Cached      int `json:"cached"`
	UsedPercent int `json:"usedPercent"`
}

// StorageInfo 存储信息
type StorageInfo struct {
	Total       string `json:"total"`
	Used        string `json:"used"`
	Available   string `json:"available"`
	UsedPercent int    `json:"usedPercent"`
	MountPoint  string `json:"mountPoint"`
}

// CpuUsageInfo CPU 使用信息
type CpuUsageInfo struct {
	UsagePercent int `json:"usagePercent"`
	User         int `json:"user"`
	System       int `json:"system"`
	Idle         int `json:"idle"`
}

// NetworkInfo 网络信息
type NetworkInfo struct {
	Interface  string `json:"interface"`
	IPAddress  string `json:"ipAddress"`
	MacAddress string `json:"macAddress"`
	Netmask    string `json:"netmask"`
}

// SystemRuntime 系统运行状态
type SystemRuntime struct {
	Uptime      string `json:"uptime"`
	LoadAverage string `json:"loadAverage"`
	CurrentTime string `json:"currentTime"`
}

// SystemProperties 系统属性
type SystemProperties map[string]string

// DeviceProvider 设备提供者接口
type DeviceProvider interface {
	// GetPlatform 返回平台类型
	GetPlatform() Platform

	// ListDevices 列出设备
	ListDevices(verbose bool) ([]Device, error)

	// GetVersion 获取工具版本
	GetVersion() (string, error)

	// StartServer 启动服务
	StartServer() (*CommandResult, error)

	// KillServer 终止服务
	KillServer() (*CommandResult, error)

	// ConnectDevice TCP 连接设备
	ConnectDevice(ipPort string) (*CommandResult, error)

	// DisconnectDevice 断开连接
	DisconnectDevice(ipPort string) (*CommandResult, error)

	// GetDeviceDetailInfo 获取设备详细信息
	GetDeviceDetailInfo(connectKey string) (*DeviceDetailInfo, error)

	// GetBatteryInfo 获取电池信息
	GetBatteryInfo(connectKey string) (*BatteryInfo, error)

	// GetMemoryInfo 获取内存信息
	GetMemoryInfo(connectKey string) (*MemoryInfo, error)

	// GetStorageInfo 获取存储信息
	GetStorageInfo(connectKey string) (*StorageInfo, error)

	// GetCpuUsageInfo 获取 CPU 使用信息
	GetCpuUsageInfo(connectKey string) (*CpuUsageInfo, error)

	// GetNetworkInfo 获取网络信息
	GetNetworkInfo(connectKey string) ([]NetworkInfo, error)

	// GetSystemRuntime 获取系统运行信息
	GetSystemRuntime(connectKey string) (*SystemRuntime, error)

	// GetSystemProperties 获取系统属性
	GetSystemProperties(connectKey string) (SystemProperties, error)

	// GetDeviceUdid 获取设备唯一标识
	GetDeviceUdid(connectKey string) (string, error)
}
