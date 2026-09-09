package hdc

import (
	"regexp"
	"strconv"
	"strings"
)

// BatteryInfo 电池信息
type BatteryInfo struct {
	Capacity       int    `json:"capacity"`       // 电量百分比
	Temperature    int    `json:"temperature"`    // 温度 (℃)
	Voltage        int    `json:"voltage"`        // 电压 (mV)
	ChargingStatus string `json:"chargingStatus"` // 充电状态
	PluggedType    string `json:"pluggedType"`    // 充电类型
	Technology     string `json:"technology"`      // 电池技术
	Health         string `json:"health"`          // 健康状态
}

// MemoryInfo 内存信息
type MemoryInfo struct {
	Total      int `json:"total"`      // KB
	Free       int `json:"free"`       // KB
	Available  int `json:"available"`  // KB
	Cached     int `json:"cached"`     // KB
	UsedPercent int `json:"usedPercent"` // 使用百分比
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

// GetBatteryInfo 获取电池信息
func GetBatteryInfo(connectKey string) (*BatteryInfo, error) {
	result, err := ExecuteHdc([]string{"-t", connectKey, "shell", "hidumper", "-s", "3302", "-a", "-i"})
	if err != nil {
		return getDefaultBatteryInfo(), err
	}

	defaultInfo := getDefaultBatteryInfo()
	if !result.Success || result.Output == "" {
		return defaultInfo, nil
	}

	output := result.Output

	// 解析各字段
	capacityRe := regexp.MustCompile(`capacity:\s*(\d+)`)
	temperatureRe := regexp.MustCompile(`temperature:\s*(\d+)`)
	voltageRe := regexp.MustCompile(`voltage:\s*(\d+)`)
	chargingStatusRe := regexp.MustCompile(`chargingStatus:\s*(\d+)`)
	pluggedTypeRe := regexp.MustCompile(`pluggedType:\s*(\d+)`)
	technologyRe := regexp.MustCompile(`technology:\s*(\S+)`)
	healthRe := regexp.MustCompile(`healthState:\s*(\d+)`)

	capacityMatch := capacityRe.FindStringSubmatch(output)
	temperatureMatch := temperatureRe.FindStringSubmatch(output)
	voltageMatch := voltageRe.FindStringSubmatch(output)
	chargingStatusMatch := chargingStatusRe.FindStringSubmatch(output)
	pluggedTypeMatch := pluggedTypeRe.FindStringSubmatch(output)
	technologyMatch := technologyRe.FindStringSubmatch(output)
	healthMatch := healthRe.FindStringSubmatch(output)

	// 充电状态映射
	chargingStatusMap := map[string]string{
		"1": "discharging",
		"2": "charging",
		"3": "not_charging",
		"4": "full",
		"5": "full",
	}

	// 充电类型映射
	pluggedTypeMap := map[string]string{
		"0": "none",
		"1": "ac",
		"2": "usb",
		"3": "wireless",
	}

	// 健康状态映射
	healthMap := map[string]string{
		"1": "good",
		"2": "overheat",
		"3": "over_voltage",
		"4": "cold",
		"5": "dead",
	}

	info := defaultInfo

	if len(capacityMatch) > 1 {
		info.Capacity, _ = strconv.Atoi(capacityMatch[1])
	}
	if len(temperatureMatch) > 1 {
		temp, _ := strconv.Atoi(temperatureMatch[1])
		info.Temperature = temp / 10 // 转换为摄氏度
	}
	if len(voltageMatch) > 1 {
		voltage, _ := strconv.Atoi(voltageMatch[1])
		info.Voltage = voltage / 1000 // 转换为 mV
	}
	if len(chargingStatusMatch) > 1 {
		if status, ok := chargingStatusMap[chargingStatusMatch[1]]; ok {
			info.ChargingStatus = status
		}
	}
	if len(pluggedTypeMatch) > 1 {
		if plugged, ok := pluggedTypeMap[pluggedTypeMatch[1]]; ok {
			info.PluggedType = plugged
		}
	}
	if len(technologyMatch) > 1 {
		info.Technology = technologyMatch[1]
	}
	if len(healthMatch) > 1 {
		if health, ok := healthMap[healthMatch[1]]; ok {
			info.Health = health
		}
	}

	return info, nil
}

func getDefaultBatteryInfo() *BatteryInfo {
	return &BatteryInfo{
		Capacity:       0,
		Temperature:    0,
		Voltage:        0,
		ChargingStatus: "unknown",
		PluggedType:    "unknown",
		Technology:     "Unknown",
		Health:         "unknown",
	}
}

// GetMemoryInfo 获取内存信息
func GetMemoryInfo(connectKey string) (*MemoryInfo, error) {
	result, err := ExecuteHdc([]string{"-t", connectKey, "shell", "cat", "/proc/meminfo"})
	if err != nil {
		return getDefaultMemoryInfo(), err
	}

	defaultInfo := getDefaultMemoryInfo()
	if !result.Success || result.Output == "" {
		return defaultInfo, nil
	}

	output := result.Output

	totalRe := regexp.MustCompile(`MemTotal:\s*(\d+)\s*kB`)
	freeRe := regexp.MustCompile(`MemFree:\s*(\d+)\s*kB`)
	availableRe := regexp.MustCompile(`MemAvailable:\s*(\d+)\s*kB`)
	cachedRe := regexp.MustCompile(`Cached:\s*(\d+)\s*kB`)

	totalMatch := totalRe.FindStringSubmatch(output)
	freeMatch := freeRe.FindStringSubmatch(output)
	availableMatch := availableRe.FindStringSubmatch(output)
	cachedMatch := cachedRe.FindStringSubmatch(output)

	total := 0
	if len(totalMatch) > 1 {
		total, _ = strconv.Atoi(totalMatch[1])
	}

	available := 0
	if len(availableMatch) > 1 {
		available, _ = strconv.Atoi(availableMatch[1])
	}

	free := 0
	if len(freeMatch) > 1 {
		free, _ = strconv.Atoi(freeMatch[1])
	}

	cached := 0
	if len(cachedMatch) > 1 {
		cached, _ = strconv.Atoi(cachedMatch[1])
	}

	usedPercent := 0
	if total > 0 {
		usedPercent = ((total - available) * 100) / total
	}

	return &MemoryInfo{
		Total:       total,
		Free:        free,
		Available:   available,
		Cached:      cached,
		UsedPercent: usedPercent,
	}, nil
}

func getDefaultMemoryInfo() *MemoryInfo {
	return &MemoryInfo{
		Total:       0,
		Free:        0,
		Available:   0,
		Cached:      0,
		UsedPercent: 0,
	}
}

// GetStorageInfo 获取存储信息
func GetStorageInfo(connectKey string) (*StorageInfo, error) {
	result, err := ExecuteHdc([]string{"-t", connectKey, "shell", "df", "-h", "/data"})
	if err != nil {
		return getDefaultStorageInfo(), err
	}

	defaultInfo := getDefaultStorageInfo()
	if !result.Success || result.Output == "" {
		return defaultInfo, nil
	}

	lines := strings.Split(result.Output, "\n")
	if len(lines) < 2 {
		return defaultInfo, nil
	}

	// 解析 df 输出: Filesystem Size Used Avail Use% Mounted on
	parts := strings.Fields(lines[1])
	if len(parts) >= 6 {
		usedPercent := 0
		if percentStr := strings.TrimSuffix(parts[4], "%"); percentStr != "" {
			usedPercent, _ = strconv.Atoi(percentStr)
		}

		return &StorageInfo{
			Total:       parts[1],
			Used:        parts[2],
			Available:   parts[3],
			UsedPercent: usedPercent,
			MountPoint:  parts[5],
		}, nil
	}

	return defaultInfo, nil
}

func getDefaultStorageInfo() *StorageInfo {
	return &StorageInfo{
		Total:       "0",
		Used:        "0",
		Available:   "0",
		UsedPercent: 0,
		MountPoint:  "/data",
	}
}

// GetCpuUsageInfo 获取 CPU 使用信息
func GetCpuUsageInfo(connectKey string) (*CpuUsageInfo, error) {
	result, err := ExecuteHdc([]string{"-t", connectKey, "shell", "top", "-n", "1"})
	if err != nil {
		return getDefaultCpuUsageInfo(), err
	}

	defaultInfo := getDefaultCpuUsageInfo()
	if !result.Success || result.Output == "" {
		return defaultInfo, nil
	}

	output := result.Output

	// 解析 top 输出中的 CPU 行
	// 格式: 1200%cpu   43%user    0%nice  133%sys 1007%idle    0%iow   17%irq    0%sirq    0
	cpuRe := regexp.MustCompile(`(\d+)%cpu\s+(\d+)%user\s+\d+%nice\s+(\d+)%sys\s+(\d+)%idle`)

	cpuMatch := cpuRe.FindStringSubmatch(output)
	if len(cpuMatch) >= 5 {
		totalCpu, _ := strconv.Atoi(cpuMatch[1])
		user, _ := strconv.Atoi(cpuMatch[2])
		system, _ := strconv.Atoi(cpuMatch[3])
		idle, _ := strconv.Atoi(cpuMatch[4])

		usagePercent := 0
		if totalCpu > 0 {
			usagePercent = ((totalCpu - idle) * 100) / totalCpu
		}

		userPercent := 0
		if totalCpu > 0 {
			userPercent = (user * 100) / totalCpu
		}

		systemPercent := 0
		if totalCpu > 0 {
			systemPercent = (system * 100) / totalCpu
		}

		idlePercent := 0
		if totalCpu > 0 {
			idlePercent = (idle * 100) / totalCpu
		}

		return &CpuUsageInfo{
			UsagePercent: usagePercent,
			User:         userPercent,
			System:       systemPercent,
			Idle:         idlePercent,
		}, nil
	}

	return defaultInfo, nil
}

func getDefaultCpuUsageInfo() *CpuUsageInfo {
	return &CpuUsageInfo{
		UsagePercent: 0,
		User:         0,
		System:      0,
		Idle:         0,
	}
}

// GetNetworkInfo 获取网络信息
func GetNetworkInfo(connectKey string) ([]NetworkInfo, error) {
	result, err := ExecuteHdc([]string{"-t", connectKey, "shell", "ifconfig"})
	if err != nil {
		return []NetworkInfo{}, err
	}

	if !result.Success || result.Output == "" {
		return []NetworkInfo{}, nil
	}

	networks := []NetworkInfo{}
	output := result.Output

	// 解析 wlan0 和 eth0 接口
	interfaceRe := regexp.MustCompile(`(wlan\d+|eth\d+)\s+Link encap:\w+\s+HWaddr\s+([\da-f:]+)\s+inet addr:([\d.]+)\s+.*?Mask:([\d.]+)`)

	matches := interfaceRe.FindAllStringSubmatch(output, -1)
	for _, match := range matches {
		if len(match) >= 5 {
			networks = append(networks, NetworkInfo{
				Interface:  match[1],
				MacAddress: match[2],
				IPAddress:  match[3],
				Netmask:    match[4],
			})
		}
	}

	// 如果正则匹配失败，使用逐行解析
	if len(networks) == 0 {
		lines := strings.Split(output, "\n")
		var currentInterface, currentMac, currentIp, currentMask string

		for _, line := range lines {
			ifMatch := regexp.MustCompile(`^(wlan\d+|eth\d+)\s+`).FindStringSubmatch(line)
			if len(ifMatch) > 0 {
				if currentInterface != "" && currentIp != "" {
					networks = append(networks, NetworkInfo{
						Interface:  currentInterface,
						MacAddress: currentMac,
						IPAddress:  currentIp,
						Netmask:    currentMask,
					})
				}
				currentInterface = ifMatch[1]
				macMatch := regexp.MustCompile(`HWaddr\s+([\da-f:]+)`).FindStringSubmatch(line)
				if len(macMatch) > 1 {
					currentMac = macMatch[1]
				}
				currentIp = ""
				currentMask = ""
			}

			inetMatch := regexp.MustCompile(`inet addr:([\d.]+).*?Mask:([\d.]+)`).FindStringSubmatch(line)
			if len(inetMatch) >= 3 {
				currentIp = inetMatch[1]
				currentMask = inetMatch[2]
			}
		}

		if currentInterface != "" && currentIp != "" {
			networks = append(networks, NetworkInfo{
				Interface:  currentInterface,
				MacAddress: currentMac,
				IPAddress:  currentIp,
				Netmask:    currentMask,
			})
		}
	}

	return networks, nil
}

// GetSystemRuntime 获取系统运行信息
func GetSystemRuntime(connectKey string) (*SystemRuntime, error) {
	result, err := ExecuteHdc([]string{"-t", connectKey, "shell", "uptime"})
	if err != nil {
		return getDefaultSystemRuntime(), err
	}

	defaultInfo := getDefaultSystemRuntime()
	if !result.Success || result.Output == "" {
		return defaultInfo, nil
	}

	output := strings.TrimSpace(result.Output)
	// 格式: 20:05:15 up 38 days, 10:29,  0 users,  load average: 13.22, 13.12, 13.14

	timeRe := regexp.MustCompile(`^(\d+:\d+:\d+)`)
	uptimeRe := regexp.MustCompile(`up\s+(.+?),\s*\d+\s*users?`)
	loadRe := regexp.MustCompile(`load average:\s*([\d.,\s]+)`)

	timeMatch := timeRe.FindStringSubmatch(output)
	uptimeMatch := uptimeRe.FindStringSubmatch(output)
	loadMatch := loadRe.FindStringSubmatch(output)

	currentTime := "Unknown"
	if len(timeMatch) > 1 {
		currentTime = timeMatch[1]
	}

	uptime := "Unknown"
	if len(uptimeMatch) > 1 {
		uptime = strings.TrimSpace(uptimeMatch[1])
	}

	loadAverage := "Unknown"
	if len(loadMatch) > 1 {
		loadAverage = strings.TrimSpace(loadMatch[1])
	}

	return &SystemRuntime{
		CurrentTime: currentTime,
		Uptime:      uptime,
		LoadAverage: loadAverage,
	}, nil
}

func getDefaultSystemRuntime() *SystemRuntime {
	return &SystemRuntime{
		Uptime:      "Unknown",
		LoadAverage: "Unknown",
		CurrentTime: "Unknown",
	}
}

// GetSystemProperties 获取所有系统属性
func GetSystemProperties(connectKey string) (SystemProperties, error) {
	result, err := ExecuteHdc([]string{"-t", connectKey, "shell", "param", "get"})
	if err != nil {
		return SystemProperties{}, err
	}

	properties := SystemProperties{}

	if !result.Success || result.Output == "" {
		return properties, nil
	}

	lines := strings.Split(result.Output, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		// 用第一个 = 分割属性名和值
		eqIndex := strings.Index(line, "=")
		if eqIndex > 0 {
			key := strings.TrimSpace(line[:eqIndex])
			value := strings.TrimSpace(line[eqIndex+1:])
			if key != "" {
				properties[key] = value
			}
		}
	}

	return properties, nil
}

