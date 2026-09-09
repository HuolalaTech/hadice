package hdc

import (
	"fmt"
	"log"
	"regexp"
	"strings"
	"time"

	"Hadice/backend/device"
)

// HdcDevice 设备信息
type HdcDevice struct {
	ConnectKey     string `json:"connectKey"`            // 设备标识符（序列号或 IP:port）
	ConnectionType string `json:"connectionType"`        // 连接类型：USB 或 TCP
	Status         string `json:"status"`                // 连接状态：Connected, Offline, Unauthorized, Unknown
	DeviceName     string `json:"deviceName,omitempty"`  // 设备名称（原始输出）
	ProductName    string `json:"productName,omitempty"` // 产品名称，如 "HUAWEI Mate 60 Pro"
	Model          string `json:"model,omitempty"`       // 产品型号，如 "ALN-AL00"
	DisplayName    string `json:"displayName,omitempty"` // 显示名称
}

// DeviceInfo 设备基本信息（产品名称和型号）
type DeviceInfo struct {
	ProductName string `json:"productName"`
	Model       string `json:"model"`
}

// DeviceDetailInfo 设备完整详细信息
type DeviceDetailInfo struct {
	// 基本信息
	ProductName  string `json:"productName"`
	Model        string `json:"model"`
	Brand        string `json:"brand"`
	Manufacturer string `json:"manufacturer"`
	DeviceType   string `json:"deviceType"`
	SerialNumber string `json:"serialNumber"`
	// 系统信息
	OSName          string `json:"osName"`
	OSVersion       string `json:"osVersion"`
	APIVersion      string `json:"apiVersion"`
	SoftwareVersion string `json:"softwareVersion"`
	OhosFullName    string `json:"ohosFullName"`
	SecurityPatch   string `json:"securityPatch"`
	KernelVersion   string `json:"kernelVersion"`
	// 硬件信息
	CpuAbi          string `json:"cpuAbi"`
	HardwareVersion string `json:"hardwareVersion"`
}

// ListDevices 查询已连接的设备列表
// verbose: 是否使用详细模式
func ListDevices(verbose bool) ([]HdcDevice, error) {
	var args []string
	if verbose {
		args = []string{"list", "targets", "-v"}
	} else {
		args = []string{"list", "targets"}
	}

	result, err := ExecuteHdc(args)
	if err != nil {
		return nil, err
	}

	if !result.Success || result.Output == "" || result.Output == "[Empty]" {
		return []HdcDevice{}, nil
	}

	devices := []HdcDevice{}
	lines := strings.Split(result.Output, "\n")

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		parts := strings.Fields(line)
		if len(parts) == 0 {
			continue
		}

		connectKey := parts[0]

		// 过滤 Windows 虚拟 COM 端口设备（COM1, COM5, COM6 等）
		// 这些设备在没有连接手机时也会存在，会导致错误
		if strings.HasPrefix(strings.ToUpper(connectKey), "COM") {
			log.Printf("[HDC Device] ⚠️ 过滤虚拟 COM 端口设备: %s", connectKey)
			continue
		}

		// 判断连接类型
		connectionType := "USB"
		if strings.Contains(connectKey, ":") {
			connectionType = "TCP"
		}

		// 解析状态
		status := "Connected"
		deviceName := "Unknown Device"

		if verbose && len(parts) >= 3 {
			// verbose 模式: connect-key TCP/USB Connected/Offline/Unauthorized deviceName hdc
			statusStr := parts[2]
			switch statusStr {
			case "Offline":
				status = "Offline"
			case "Unauthorized":
				status = "Unauthorized"
			case "Connected", "Ready":
				status = "Connected"
			default:
				status = "Unknown"
			}

			if len(parts) >= 4 {
				deviceName = parts[3]
			}
		} else if strings.Contains(line, "Unauthorized") {
			status = "Unauthorized"
		}

		devices = append(devices, HdcDevice{
			ConnectKey:     connectKey,
			ConnectionType: connectionType,
			Status:         status,
			DeviceName:     deviceName,
		})
	}

	return devices, nil
}

// WaitForDevice 等待设备连接
// connectKey: 可选的设备标识符，如果为空则等待任意设备
func WaitForDevice(connectKey string) (*HdcResult, error) {
	var args []string
	if connectKey != "" {
		args = []string{"-t", connectKey, "wait"}
	} else {
		args = []string{"wait"}
	}
	return ExecuteHdc(args)
}

// GetHdcVersion 获取 HDC 版本信息
func GetHdcVersion() (string, error) {

	result, err := ExecuteHdc([]string{"-v"})
	if err != nil {
		log.Printf("[HDC Device] ❌ 执行 hdc -v 命令失败")
		log.Printf("[HDC Device] 错误: %v", err)
		log.Printf("[HDC Device] 返回版本: Unknown")
		return "Unknown", err
	}

	if result.Error != "" {
		log.Printf("[HDC Device] 错误信息: %s", result.Error)
	}

	if result.Success {
		// 解析版本号，格式如 "Ver: 3.1.0e"
		re := regexp.MustCompile(`Ver:\s*(\S+)`)
		matches := re.FindStringSubmatch(result.Output)
		if len(matches) > 1 {
			version := matches[1]
			return version, nil
		}
		log.Printf("[HDC Device] ⚠️ 无法解析版本号，返回原始输出: %s", result.Output)
		return result.Output, nil
	}

	log.Printf("[HDC Device] ⚠️ 命令执行失败，返回版本: Unknown")
	return "Unknown", nil
}

// CheckServer 检查 HDC 服务状态
func CheckServer() (map[string]string, error) {

	result, err := ExecuteHdc([]string{"checkserver"})
	if err != nil {
		log.Printf("[HDC Device] hdc checkserver 错误: %v", err)
		return map[string]string{
			"client": "Unknown",
			"server": "Unknown",
		}, err
	}

	if result.Error != "" {
		log.Printf("[HDC Device] 错误信息: %s", result.Error)
	}

	info := map[string]string{
		"client": "Unknown",
		"server": "Unknown",
	}

	if result.Success {
		// 解析输出，格式如 "Client version: Ver: 3.1.0e, Server version: Ver: 3.1.0e"
		clientRe := regexp.MustCompile(`Client version:\s*Ver:\s*(\S+)`)
		serverRe := regexp.MustCompile(`Server version:\s*Ver:\s*(\S+)`)

		clientMatches := clientRe.FindStringSubmatch(result.Output)
		serverMatches := serverRe.FindStringSubmatch(result.Output)

		if len(clientMatches) > 1 {
			info["client"] = clientMatches[1]
		} else {
			log.Printf("[HDC Device]   Client 版本: 未匹配到")
		}

		if len(serverMatches) > 1 {
			info["server"] = serverMatches[1]
		} else {
			log.Printf("[HDC Device]   Server 版本: 未匹配到")
		}
	} else {
		log.Printf("[HDC Device] ⚠️ 命令执行失败，无法解析服务状态")
	}

	log.Printf("[HDC Device] 最终返回结果: client=%s, server=%s", info["client"], info["server"])
	return info, nil
}

// StartServer 启动 HDC 服务
func StartServer() (*HdcResult, error) {
	return ExecuteHdc([]string{"start"})
}

// KillServer 终止 HDC 服务
func KillServer() (*HdcResult, error) {
	return ExecuteHdc([]string{"kill"})
}

// RestartServer 重启 HDC 服务
func RestartServer() (*HdcResult, error) {
	return ExecuteHdc([]string{"kill", "-r"})
}

// ConnectDevice TCP 连接设备
// ipPort: IP地址和端口，格式如 "192.168.1.100:8710"
func ConnectDevice(ipPort string) (*HdcResult, error) {
	return ExecuteHdc([]string{"tconn", ipPort})
}

// DisconnectDevice 断开 TCP 设备连接
// ipPort: IP地址和端口
func DisconnectDevice(ipPort string) (*HdcResult, error) {
	return ExecuteHdc([]string{"tconn", ipPort, "-remove"})
}

// GetDeviceProperty 获取设备属性
// connectKey: 设备标识符
// property: 属性名，如 const.product.name
func GetDeviceProperty(connectKey string, property string) (string, error) {
	// 使用较短的超时时间（5秒），避免单个属性查询阻塞太久
	result, err := ExecuteHdcWithTimeout([]string{"-t", connectKey, "shell", "param", "get", property}, 5*time.Second)
	if err != nil {
		return "", err
	}

	if result.Success && result.Output != "" {
		value := strings.TrimSpace(result.Output)
		// 过滤掉一些无效的输出
		if value != "" && value != "[Empty]" && value != "null" {
			return value, nil
		}
	}

	return "", nil
}

// GetDeviceInfo 获取设备的产品名称和型号
func GetDeviceInfo(connectKey string) (*DeviceInfo, error) {
	// 并行获取产品名称和型号
	productNameChan := make(chan string, 1)
	modelChan := make(chan string, 1)
	errChan := make(chan error, 2)

	go func() {
		productName, err := GetDeviceProperty(connectKey, "const.product.name")
		if err != nil {
			errChan <- err
			return
		}
		productNameChan <- productName
	}()

	go func() {
		model, err := GetDeviceProperty(connectKey, "const.product.model")
		if err != nil {
			errChan <- err
			return
		}
		modelChan <- model
	}()

	productName := <-productNameChan
	model := <-modelChan

	// 检查是否有错误
	select {
	case err := <-errChan:
		return &DeviceInfo{
			ProductName: productName,
			Model:       model,
		}, err
	default:
	}

	return &DeviceInfo{
		ProductName: productName,
		Model:       model,
	}, nil
}

// ListDevicesWithInfo 查询已连接的设备列表（包含详细信息）
// 获取每个设备的产品名称和型号
func ListDevicesWithInfo() ([]HdcDevice, error) {
	// 首先获取基本设备列表
	devices, err := ListDevices(true)
	if err != nil {
		return nil, err
	}

	// 为每个已连接的设备获取详细信息
	devicesWithInfo := make([]HdcDevice, 0, len(devices))
	for _, device := range devices {
		if device.Status == "Connected" {
			info, err := GetDeviceInfo(device.ConnectKey)
			if err == nil && info != nil {
				device.ProductName = info.ProductName
				device.Model = info.Model

				// 构建显示名称
				displayName := device.ConnectKey
				if info.ProductName != "" && info.Model != "" {
					displayName = info.ProductName + " - " + info.Model + " (" + device.ConnectKey + ")"
				} else if info.ProductName != "" {
					displayName = info.ProductName + " (" + device.ConnectKey + ")"
				} else if info.Model != "" {
					displayName = info.Model + " (" + device.ConnectKey + ")"
				}
				device.DisplayName = displayName
			} else {
				device.DisplayName = device.ConnectKey
			}
		} else {
			device.DisplayName = device.ConnectKey
		}
		devicesWithInfo = append(devicesWithInfo, device)
	}

	return devicesWithInfo, nil
}

// GetDeviceDetailInfo 获取设备完整详细信息
func GetDeviceDetailInfo(connectKey string) (*DeviceDetailInfo, error) {
	properties := []struct {
		name string
		prop string
	}{
		{"productName", "const.product.name"},
		{"model", "const.product.model"},
		{"brand", "const.product.brand"},
		{"manufacturer", "const.product.manufacturer"},
		{"deviceType", "const.product.devicetype"},
		{"osName", "const.product.os.dist.name"},
		{"osVersion", "const.product.os.dist.version"},
		{"apiVersion", "const.ohos.apiversion"},
		{"softwareVersion", "const.product.software.version"},
		{"ohosFullName", "const.ohos.fullname"},
		{"securityPatch", "const.ohos.version.security_patch"},
		{"cpuAbi", "const.product.cpu.abilist"},
		{"hardwareVersion", "const.product.hardwareversion"},
	}

	// 并行获取所有属性，使用 sync.WaitGroup 确保所有 goroutine 完成
	results := make([]string, len(properties))
	type result struct {
		idx   int
		value string
		err   error
	}
	resultChan := make(chan result, len(properties))

	for i, prop := range properties {
		go func(idx int, p struct {
			name string
			prop string
		}) {
			value, err := GetDeviceProperty(connectKey, p.prop)
			resultChan <- result{idx: idx, value: value, err: err}
		}(i, prop)
	}

	// 等待所有属性获取完成
	for i := 0; i < len(properties); i++ {
		res := <-resultChan
		if res.err == nil {
			results[res.idx] = res.value
		}
		// 即使出错也继续，使用空字符串（会被 getOrDefault 转换为 Unknown）
	}

	// 获取内核版本
	unameResult, _ := ExecuteHdc([]string{"-t", connectKey, "shell", "uname", "-r"})
	kernelVersion := ""
	if unameResult != nil && unameResult.Success {
		kernelVersion = strings.TrimSpace(unameResult.Output)
	}

	info := &DeviceDetailInfo{
		ProductName:     getOrDefault(results[0], "Unknown"),
		Model:           getOrDefault(results[1], "Unknown"),
		Brand:           getOrDefault(results[2], "Unknown"),
		Manufacturer:    getOrDefault(results[3], "Unknown"),
		DeviceType:      getOrDefault(results[4], "Unknown"),
		SerialNumber:    connectKey,
		OSName:          getOrDefault(results[5], "HarmonyOS"),
		OSVersion:       getOrDefault(results[6], "Unknown"),
		APIVersion:      getOrDefault(results[7], "Unknown"),
		SoftwareVersion: getOrDefault(results[8], "Unknown"),
		OhosFullName:    getOrDefault(results[9], "Unknown"),
		SecurityPatch:   getOrDefault(results[10], "Unknown"),
		KernelVersion:   getOrDefault(kernelVersion, "Unknown"),
		CpuAbi:          getOrDefault(results[11], "Unknown"),
		HardwareVersion: getOrDefault(results[12], "Unknown"),
	}

	return info, nil
}

// GetDeviceUdid 获取设备UDID
func GetDeviceUdid(connectKey string) (string, error) {
	// 使用 hdc shell bm get --udid 命令获取UDID
	result, err := ExecuteHdc([]string{"-t", connectKey, "shell", "bm", "get", "--udid"})
	if err != nil {
		return "", fmt.Errorf("failed to get device UDID: %v", err)
	}

	if !result.Success {
		return "", fmt.Errorf("failed to get device UDID: %s", result.Error)
	}

	// 解析输出，提取UDID
	// 输出格式如: "udid of current device is :\nC952974AD12FD54D963D3DF3DB9A3B3EEBD4E37742573E8F565B56B4FECA8DF0"
	lines := strings.Split(strings.TrimSpace(result.Output), "\n")
	if len(lines) >= 2 {
		// 取最后一行作为UDID
		udid := strings.TrimSpace(lines[len(lines)-1])
		if len(udid) > 0 {
			return udid, nil
		}
	}

	return "", fmt.Errorf("unable to parse UDID from output: %s", result.Output)
}

// getOrDefault 如果值为空则返回默认值
func getOrDefault(value string, defaultValue string) string {
	if value == "" {
		return defaultValue
	}
	return value
}

// ============ DeviceProvider 接口实现 ============

// HdcProvider HDC 设备提供者
type HdcProvider struct{}

// NewProvider 创建 HDC 设备提供者
func NewProvider() *HdcProvider {
	return &HdcProvider{}
}

// GetPlatform 返回平台类型
func (p *HdcProvider) GetPlatform() device.Platform {
	return device.PlatformHarmonyOS
}

// ListDevices 列出鸿蒙设备（实现 DeviceProvider 接口）
func (p *HdcProvider) ListDevices(verbose bool) ([]device.Device, error) {
	hdcDevices, err := ListDevicesWithInfo()
	if err != nil {
		return nil, err
	}

	devices := make([]device.Device, len(hdcDevices))
	for i, d := range hdcDevices {
		devices[i] = device.Device{
			ConnectKey:     d.ConnectKey,
			ConnectionType: d.ConnectionType,
			Status:         d.Status,
			DeviceName:     d.DeviceName,
			ProductName:    d.ProductName,
			Model:          d.Model,
			DisplayName:    d.DisplayName,
			Platform:       device.PlatformHarmonyOS,
		}
	}

	return devices, nil
}

// GetVersion 获取 HDC 版本
func (p *HdcProvider) GetVersion() (string, error) {
	return GetHdcVersion()
}

// StartServer 启动 HDC 服务
func (p *HdcProvider) StartServer() (*device.CommandResult, error) {
	result, err := StartServer()
	if err != nil {
		return nil, err
	}
	return &device.CommandResult{
		Success: result.Success,
		Output:  result.Output,
		Error:   result.Error,
	}, nil
}

// KillServer 终止 HDC 服务
func (p *HdcProvider) KillServer() (*device.CommandResult, error) {
	result, err := KillServer()
	if err != nil {
		return nil, err
	}
	return &device.CommandResult{
		Success: result.Success,
		Output:  result.Output,
		Error:   result.Error,
	}, nil
}

// ConnectDevice TCP 连接设备
func (p *HdcProvider) ConnectDevice(ipPort string) (*device.CommandResult, error) {
	result, err := ConnectDevice(ipPort)
	if err != nil {
		return nil, err
	}
	return &device.CommandResult{
		Success: result.Success,
		Output:  result.Output,
		Error:   result.Error,
	}, nil
}

// DisconnectDevice 断开连接
func (p *HdcProvider) DisconnectDevice(ipPort string) (*device.CommandResult, error) {
	result, err := DisconnectDevice(ipPort)
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
func (p *HdcProvider) GetDeviceDetailInfo(connectKey string) (*device.DeviceDetailInfo, error) {
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
func (p *HdcProvider) GetBatteryInfo(connectKey string) (*device.BatteryInfo, error) {
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
func (p *HdcProvider) GetMemoryInfo(connectKey string) (*device.MemoryInfo, error) {
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
func (p *HdcProvider) GetStorageInfo(connectKey string) (*device.StorageInfo, error) {
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
func (p *HdcProvider) GetCpuUsageInfo(connectKey string) (*device.CpuUsageInfo, error) {
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
func (p *HdcProvider) GetNetworkInfo(connectKey string) ([]device.NetworkInfo, error) {
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
func (p *HdcProvider) GetSystemRuntime(connectKey string) (*device.SystemRuntime, error) {
	runtime, err := GetSystemRuntime(connectKey)
	if err != nil {
		return nil, err
	}
	return &device.SystemRuntime{
		Uptime:      runtime.Uptime,
		LoadAverage: runtime.LoadAverage,
		CurrentTime: runtime.CurrentTime,
	}, nil
}

// GetSystemProperties 获取系统属性
func (p *HdcProvider) GetSystemProperties(connectKey string) (device.SystemProperties, error) {
	props, err := GetSystemProperties(connectKey)
	if err != nil {
		return nil, err
	}
	result := make(device.SystemProperties)
	for k, v := range props {
		result[k] = v
	}
	return result, nil
}

// GetDeviceUdid 获取设备 UDID
func (p *HdcProvider) GetDeviceUdid(connectKey string) (string, error) {
	return GetDeviceUdid(connectKey)
}
