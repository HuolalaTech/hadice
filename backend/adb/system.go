package adb

import (
	"regexp"
	"strconv"
	"strings"

	"Hadice/backend/hdc"
)

func getDefaultBatteryInfo() *hdc.BatteryInfo {
	return &hdc.BatteryInfo{
		Capacity:       0,
		Temperature:    0,
		Voltage:        0,
		ChargingStatus: "unknown",
		PluggedType:    "unknown",
		Technology:     "Unknown",
		Health:         "unknown",
	}
}

func GetBatteryInfo(connectKey string) (*hdc.BatteryInfo, error) {
	result, err := ExecuteAdb([]string{"-s", connectKey, "shell", "dumpsys", "battery"})
	if err != nil {
		return getDefaultBatteryInfo(), err
	}

	defaultInfo := getDefaultBatteryInfo()
	if !result.Success || result.Output == "" {
		return defaultInfo, nil
	}

	output := result.Output

	levelRe := regexp.MustCompile(`(?m)^\s*level:\s*(\d+)`)
	tempRe := regexp.MustCompile(`(?m)^\s*temperature:\s*(\d+)`)
	voltageRe := regexp.MustCompile(`(?m)^\s*voltage:\s*(\d+)`)
	statusRe := regexp.MustCompile(`(?m)^\s*status:\s*(\d+)`)
	acPoweredRe := regexp.MustCompile(`(?m)^\s*AC powered:\s*(\w+)`)
	usbPoweredRe := regexp.MustCompile(`(?m)^\s*USB powered:\s*(\w+)`)
	wirelessPoweredRe := regexp.MustCompile(`(?m)^\s*Wireless powered:\s*(\w+)`)
	techRe := regexp.MustCompile(`(?m)^\s*technology:\s*(\S+)`)
	healthRe := regexp.MustCompile(`(?m)^\s*health:\s*(\d+)`)

	info := defaultInfo

	if match := levelRe.FindStringSubmatch(output); len(match) > 1 {
		info.Capacity, _ = strconv.Atoi(match[1])
	}

	if match := tempRe.FindStringSubmatch(output); len(match) > 1 {
		temp, _ := strconv.Atoi(match[1])
		info.Temperature = temp / 10
	}

	if match := voltageRe.FindStringSubmatch(output); len(match) > 1 {
		voltage, _ := strconv.Atoi(match[1])
		info.Voltage = voltage
	}

	if match := statusRe.FindStringSubmatch(output); len(match) > 1 {
		statusMap := map[string]string{
			"1": "unknown", "2": "charging", "3": "discharging",
			"4": "not_charging", "5": "full",
		}
		if status, ok := statusMap[match[1]]; ok {
			info.ChargingStatus = status
		}
	}

	if match := acPoweredRe.FindStringSubmatch(output); len(match) > 1 && match[1] == "true" {
		info.PluggedType = "ac"
	} else if match := usbPoweredRe.FindStringSubmatch(output); len(match) > 1 && match[1] == "true" {
		info.PluggedType = "usb"
	} else if match := wirelessPoweredRe.FindStringSubmatch(output); len(match) > 1 && match[1] == "true" {
		info.PluggedType = "wireless"
	}

	if match := techRe.FindStringSubmatch(output); len(match) > 1 {
		info.Technology = match[1]
	}

	if match := healthRe.FindStringSubmatch(output); len(match) > 1 {
		healthMap := map[string]string{
			"1": "unknown", "2": "good", "3": "overheat",
			"4": "dead", "5": "over_voltage", "6": "unspecified_failure",
			"7": "cold",
		}
		if health, ok := healthMap[match[1]]; ok {
			info.Health = health
		}
	}

	return info, nil
}

func getDefaultMemoryInfo() *hdc.MemoryInfo {
	return &hdc.MemoryInfo{
		Total:       0,
		Free:        0,
		Available:   0,
		Cached:      0,
		UsedPercent: 0,
	}
}

func GetMemoryInfo(connectKey string) (*hdc.MemoryInfo, error) {
	result, err := ExecuteAdb([]string{"-s", connectKey, "shell", "cat", "/proc/meminfo"})
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

	total := 0
	if match := totalRe.FindStringSubmatch(output); len(match) > 1 {
		total, _ = strconv.Atoi(match[1])
	}

	available := 0
	if match := availableRe.FindStringSubmatch(output); len(match) > 1 {
		available, _ = strconv.Atoi(match[1])
	}

	free := 0
	if match := freeRe.FindStringSubmatch(output); len(match) > 1 {
		free, _ = strconv.Atoi(match[1])
	}

	cached := 0
	if match := cachedRe.FindStringSubmatch(output); len(match) > 1 {
		cached, _ = strconv.Atoi(match[1])
	}

	usedPercent := 0
	if total > 0 {
		usedPercent = ((total - available) * 100) / total
	}

	return &hdc.MemoryInfo{
		Total:       total,
		Free:        free,
		Available:   available,
		Cached:      cached,
		UsedPercent: usedPercent,
	}, nil
}

func getDefaultStorageInfo() *hdc.StorageInfo {
	return &hdc.StorageInfo{
		Total:       "0",
		Used:        "0",
		Available:   "0",
		UsedPercent: 0,
		MountPoint:  "/data",
	}
}

func GetStorageInfo(connectKey string) (*hdc.StorageInfo, error) {
	result, err := ExecuteAdb([]string{"-s", connectKey, "shell", "df", "-h", "/data"})
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

	parts := strings.Fields(lines[1])
	if len(parts) >= 6 {
		usedPercent := 0
		if percentStr := strings.TrimSuffix(parts[4], "%"); percentStr != "" {
			usedPercent, _ = strconv.Atoi(percentStr)
		}

		return &hdc.StorageInfo{
			Total:       parts[1],
			Used:        parts[2],
			Available:   parts[3],
			UsedPercent: usedPercent,
			MountPoint:  parts[5],
		}, nil
	}

	return defaultInfo, nil
}

func getDefaultCpuUsageInfo() *hdc.CpuUsageInfo {
	return &hdc.CpuUsageInfo{
		UsagePercent: 0,
		User:         0,
		System:       0,
		Idle:         0,
	}
}

func GetCpuUsageInfo(connectKey string) (*hdc.CpuUsageInfo, error) {
	result, err := ExecuteAdb([]string{"-s", connectKey, "shell", "top", "-n", "1"})
	if err != nil {
		return getDefaultCpuUsageInfo(), err
	}

	defaultInfo := getDefaultCpuUsageInfo()
	if !result.Success || result.Output == "" {
		return defaultInfo, nil
	}

	output := result.Output

	cpuRe := regexp.MustCompile(`(\d+)%cpu\s+(\d+)%user\s+\d+%nice\s+(\d+)%sys\s+(\d+)%idle`)

	if match := cpuRe.FindStringSubmatch(output); len(match) >= 5 {
		totalCpu, _ := strconv.Atoi(match[1])
		user, _ := strconv.Atoi(match[2])
		system, _ := strconv.Atoi(match[3])

		var userPercent, systemPercent int
		if totalCpu > 0 {
			userPercent = (user * 100) / totalCpu
			systemPercent = (system * 100) / totalCpu
		}

		return &hdc.CpuUsageInfo{
			UsagePercent: userPercent + systemPercent,
			User:         userPercent,
			System:       systemPercent,
			Idle:         100 - userPercent - systemPercent,
		}, nil
	}

	return defaultInfo, nil
}

func GetNetworkInfo(connectKey string) ([]hdc.NetworkInfo, error) {
	result, err := ExecuteAdb([]string{"-s", connectKey, "shell", "ip", "addr", "show"})
	if err != nil {
		return []hdc.NetworkInfo{}, err
	}

	if !result.Success || result.Output == "" {
		return []hdc.NetworkInfo{}, nil
	}

	networks := []hdc.NetworkInfo{}
	output := result.Output

	interfaceRe := regexp.MustCompile(`^\d+:\s*(\w+):`)
	inetRe := regexp.MustCompile(`inet\s+([\d.]+/\d+)\s+.*?\s+([\da-f:]+)`)

	var currentInterface string
	lines := strings.Split(output, "\n")

	for _, line := range lines {
		if match := interfaceRe.FindStringSubmatch(line); len(match) > 1 {
			currentInterface = match[1]
		}

		if currentInterface != "" && (strings.HasPrefix(currentInterface, "wlan") ||
			strings.HasPrefix(currentInterface, "eth") ||
			strings.HasPrefix(currentInterface, "rmnet")) {

			if match := inetRe.FindStringSubmatch(line); len(match) > 2 {
				ipWithMask := match[1]
				mac := match[2]

				parts := strings.Split(ipWithMask, "/")
				ip := parts[0]
				netmask := "24"
				if len(parts) > 1 {
					netmask = parts[1]
				}

				if mac != "00:00:00:00:00:00" && ip != "" && !strings.HasPrefix(ip, "127.") {
					networks = append(networks, hdc.NetworkInfo{
						Interface:  currentInterface,
						IPAddress:  ip,
						MacAddress: mac,
						Netmask:    netmask,
					})
				}
			}
		}
	}

	return networks, nil
}
