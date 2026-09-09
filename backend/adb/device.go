package adb

import (
	"fmt"
	"log"
	"regexp"
	"strings"

	"Hadice/backend/device"
)

// Provider ADB 设备提供者
type Provider struct{}

// NewProvider 创建 ADB 设备提供者
func NewProvider() *Provider {
	return &Provider{}
}

// GetPlatform 返回平台类型
func (p *Provider) GetPlatform() device.Platform {
	return device.PlatformAndroid
}

// ListDevices 查询已连接的安卓设备列表
func (p *Provider) ListDevices(verbose bool) ([]device.Device, error) {
	args := []string{"devices"}
	if verbose {
		args = append(args, "-l")
	}

	result, err := ExecuteAdb(args)
	if err != nil {
		return nil, err
	}

	if !result.Success || result.Output == "" {
		return []device.Device{}, nil
	}

	devices := []device.Device{}
	lines := strings.Split(result.Output, "\n")

	// 跳过第一行 "List of devices attached"
	for i, line := range lines {
		if i == 0 && strings.Contains(line, "List of devices") {
			continue
		}

		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		// 解析 adb devices -l 输出格式：
		// "192.168.1.100:5555  device product:xxx model:xxx device:xxx transport_id:1"
		// 或简单格式：
		// "emulator-5554  device"
		parts := strings.Fields(line)
		if len(parts) < 2 {
			continue
		}

		connectKey := parts[0]
		statusStr := parts[1]

		// 解析状态
		status := "Unknown"
		switch statusStr {
		case "device":
			status = "Connected"
		case "offline":
			status = "Offline"
		case "unauthorized":
			status = "Unauthorized"
		}

		// 判断连接类型
		connectionType := "USB"
		if strings.Contains(connectKey, ":") {
			connectionType = "TCP"
		}

		// 解析详细信息（如果 -l 选项）
		productName := ""
		model := ""
		if verbose {
			for _, part := range parts[2:] {
				if strings.HasPrefix(part, "product:") {
					productName = strings.TrimPrefix(part, "product:")
				} else if strings.HasPrefix(part, "model:") {
					model = strings.TrimPrefix(part, "model:")
				}
			}
		}

		// 构建显示名称
		displayName := connectKey
		if productName != "" && model != "" {
			displayName = fmt.Sprintf("%s - %s (%s)", productName, model, connectKey)
		} else if productName != "" {
			displayName = fmt.Sprintf("%s (%s)", productName, connectKey)
		} else if model != "" {
			displayName = fmt.Sprintf("%s (%s)", model, connectKey)
		}

		devices = append(devices, device.Device{
			ConnectKey:     connectKey,
			ConnectionType: connectionType,
			Status:         status,
			DeviceName:     connectKey,
			ProductName:    productName,
			Model:          model,
			DisplayName:    displayName,
			Platform:       device.PlatformAndroid,
		})
	}

	return devices, nil
}

// GetVersion 获取 ADB 版本信息
func (p *Provider) GetVersion() (string, error) {
	result, err := ExecuteAdb([]string{"version"})
	if err != nil {
		log.Printf("[ADB Device] ❌ 执行 adb version 命令失败")
		log.Printf("[ADB Device] 错误: %v", err)
		return "Unknown", err
	}

	if result.Success {
		// 解析版本号，格式如 "Android Debug Bridge version 1.0.41"
		re := regexp.MustCompile(`version\s+(\S+)`)
		matches := re.FindStringSubmatch(result.Output)
		if len(matches) > 1 {
			version := matches[1]
			return version, nil
		}
		return result.Output, nil
	}

	return "Unknown", nil
}

// StartServer 启动 ADB 服务
func (p *Provider) StartServer() (*device.CommandResult, error) {
	result, err := ExecuteAdb([]string{"start-server"})
	if err != nil {
		return nil, err
	}
	return &device.CommandResult{
		Success: result.Success,
		Output:  result.Output,
		Error:   result.Error,
	}, nil
}

// KillServer 终止 ADB 服务
func (p *Provider) KillServer() (*device.CommandResult, error) {
	result, err := ExecuteAdb([]string{"kill-server"})
	if err != nil {
		return nil, err
	}
	return &device.CommandResult{
		Success: result.Success,
		Output:  result.Output,
		Error:   result.Error,
	}, nil
}

// ConnectDevice TCP 连接安卓设备
// ipPort: IP地址和端口，格式如 "192.168.1.100:5555"
func (p *Provider) ConnectDevice(ipPort string) (*device.CommandResult, error) {
	result, err := ExecuteAdb([]string{"connect", ipPort})
	if err != nil {
		return nil, err
	}
	return &device.CommandResult{
		Success: result.Success,
		Output:  result.Output,
		Error:   result.Error,
	}, nil
}

// DisconnectDevice 断开 TCP 设备连接
// ipPort: IP地址和端口
func (p *Provider) DisconnectDevice(ipPort string) (*device.CommandResult, error) {
	result, err := ExecuteAdb([]string{"disconnect", ipPort})
	if err != nil {
		return nil, err
	}
	return &device.CommandResult{
		Success: result.Success,
		Output:  result.Output,
		Error:   result.Error,
	}, nil
}

// GetDeviceDetailInfo 获取设备详细信息
func (p *Provider) GetDeviceDetailInfo(connectKey string) (*device.DeviceDetailInfo, error) {
	info, err := GetDeviceDetailInfo(connectKey)
	if err != nil {
		return nil, err
	}
	return &device.DeviceDetailInfo{
		ProductName:     info.ProductName,
		Model:           info.Model,
		Brand:           info.Brand,
		Manufacturer:    info.Manufacturer,
		DeviceType:      info.DeviceType,
		SerialNumber:    info.SerialNumber,
		OSName:          info.OSName,
		OSVersion:       info.OSVersion,
		APIVersion:      info.APIVersion,
		SoftwareVersion: info.SoftwareVersion,
		SecurityPatch:   info.SecurityPatch,
		KernelVersion:   info.KernelVersion,
		CpuAbi:          info.CpuAbi,
		HardwareVersion: info.HardwareVersion,
	}, nil
}

// GetBatteryInfo 获取电池信息
func (p *Provider) GetBatteryInfo(connectKey string) (*device.BatteryInfo, error) {
	info, err := GetBatteryInfo(connectKey)
	if err != nil {
		return nil, err
	}
	return &device.BatteryInfo{
		Capacity:       info.Capacity,
		Temperature:    info.Temperature,
		Voltage:        info.Voltage,
		ChargingStatus: info.ChargingStatus,
		PluggedType:    info.PluggedType,
		Technology:     info.Technology,
		Health:         info.Health,
	}, nil
}

// GetMemoryInfo 获取内存信息
func (p *Provider) GetMemoryInfo(connectKey string) (*device.MemoryInfo, error) {
	info, err := GetMemoryInfo(connectKey)
	if err != nil {
		return nil, err
	}
	return &device.MemoryInfo{
		Total:       info.Total,
		Free:        info.Free,
		Available:   info.Available,
		Cached:      info.Cached,
		UsedPercent: info.UsedPercent,
	}, nil
}

// GetStorageInfo 获取存储信息
func (p *Provider) GetStorageInfo(connectKey string) (*device.StorageInfo, error) {
	info, err := GetStorageInfo(connectKey)
	if err != nil {
		return nil, err
	}
	return &device.StorageInfo{
		Total:       info.Total,
		Used:        info.Used,
		Available:   info.Available,
		UsedPercent: info.UsedPercent,
		MountPoint:  info.MountPoint,
	}, nil
}

// GetCpuUsageInfo 获取 CPU 使用信息
func (p *Provider) GetCpuUsageInfo(connectKey string) (*device.CpuUsageInfo, error) {
	info, err := GetCpuUsageInfo(connectKey)
	if err != nil {
		return nil, err
	}
	return &device.CpuUsageInfo{
		UsagePercent: info.UsagePercent,
		User:         info.User,
		System:       info.System,
		Idle:         info.Idle,
	}, nil
}

// GetNetworkInfo 获取网络信息
func (p *Provider) GetNetworkInfo(connectKey string) ([]device.NetworkInfo, error) {
	networks, err := GetNetworkInfo(connectKey)
	if err != nil {
		return nil, err
	}
	result := make([]device.NetworkInfo, len(networks))
	for i, n := range networks {
		result[i] = device.NetworkInfo{
			Interface:  n.Interface,
			IPAddress:  n.IPAddress,
			MacAddress: n.MacAddress,
			Netmask:    n.Netmask,
		}
	}
	return result, nil
}

// GetSystemRuntime 获取系统运行信息
func (p *Provider) GetSystemRuntime(connectKey string) (*device.SystemRuntime, error) {
	info, err := GetSystemRuntime(connectKey)
	if err != nil {
		return nil, err
	}
	return &device.SystemRuntime{
		Uptime:      info.Uptime,
		LoadAverage: info.LoadAverage,
		CurrentTime: info.CurrentTime,
	}, nil
}

// GetSystemProperties 获取系统属性
func (p *Provider) GetSystemProperties(connectKey string) (device.SystemProperties, error) {
	props, err := GetSystemProperties(connectKey)
	if err != nil {
		return nil, err
	}
	result := make(device.SystemProperties, len(props))
	for k, v := range props {
		result[k] = v
	}
	return result, nil
}

// GetDeviceUdid 获取设备唯一标识
func (p *Provider) GetDeviceUdid(connectKey string) (string, error) {
	return GetDeviceUdid(connectKey)
}
