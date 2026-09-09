package adb

import (
	"fmt"
	"regexp"
	"strings"

	"Hadice/backend/hdc"
)

// GetDeviceProperty 获取 Android 设备属性
// 使用 getprop 命令
func GetDeviceProperty(connectKey string, property string) (string, error) {
	result, err := ExecuteAdb([]string{"-s", connectKey, "shell", "getprop", property})
	if err != nil {
		return "", err
	}

	if result.Success && result.Output != "" {
		value := strings.TrimSpace(result.Output)
		if value != "" {
			return value, nil
		}
	}

	return "", nil
}

// GetDeviceInfo 获取 Android 设备的产品名称和型号
func GetDeviceInfo(connectKey string) (*hdc.DeviceInfo, error) {
	productName, _ := GetDeviceProperty(connectKey, "ro.product.model")
	model, _ := GetDeviceProperty(connectKey, "ro.product.device")

	return &hdc.DeviceInfo{
		ProductName: productName,
		Model:       model,
	}, nil
}

// GetDeviceDetailInfo 获取 Android 设备完整详细信息
func GetDeviceDetailInfo(connectKey string) (*hdc.DeviceDetailInfo, error) {
	properties := []struct {
		name string
		prop string
	}{
		{"productName", "ro.product.model"},
		{"model", "ro.product.device"},
		{"brand", "ro.product.brand"},
		{"manufacturer", "ro.product.manufacturer"},
		{"deviceType", "ro.build.characteristics"},
		{"osName", "ro.build.version.release"},
		{"osVersion", "ro.build.version.release"},
		{"apiVersion", "ro.build.version.sdk"},
		{"softwareVersion", "ro.build.display.id"},
		{"securityPatch", "ro.build.version.security_patch"},
		{"cpuAbi", "ro.product.cpu.abi"},
		{"hardwareVersion", "ro.hardware"},
	}

	results := make([]string, len(properties))
	for i, prop := range properties {
		value, _ := GetDeviceProperty(connectKey, prop.prop)
		results[i] = value
	}

	kernelVersion := ""
	if result, err := ExecuteAdb([]string{"-s", connectKey, "shell", "uname", "-r"}); err == nil && result.Success {
		kernelVersion = strings.TrimSpace(result.Output)
	}

	info := &hdc.DeviceDetailInfo{
		ProductName:     getOrDefault(results[0], "Unknown"),
		Model:           getOrDefault(results[1], "Unknown"),
		Brand:           getOrDefault(results[2], "Unknown"),
		Manufacturer:    getOrDefault(results[3], "Unknown"),
		DeviceType:      getOrDefault(results[4], "Unknown"),
		SerialNumber:    connectKey,
		OSName:          "Android",
		OSVersion:       getOrDefault(results[6], "Unknown"),
		APIVersion:      getOrDefault(results[7], "Unknown"),
		SoftwareVersion: getOrDefault(results[8], "Unknown"),
		OhosFullName:    "",
		SecurityPatch:   getOrDefault(results[9], "Unknown"),
		KernelVersion:   getOrDefault(kernelVersion, "Unknown"),
		CpuAbi:          getOrDefault(results[10], "Unknown"),
		HardwareVersion: getOrDefault(results[11], "Unknown"),
	}

	return info, nil
}

// GetSystemRuntime 获取 Android 设备的系统运行信息
func GetSystemRuntime(connectKey string) (*hdc.SystemRuntime, error) {
	result, err := ExecuteAdb([]string{"-s", connectKey, "shell", "cat", "/proc/uptime"})
	if err != nil {
		return &hdc.SystemRuntime{
			Uptime:      "Unknown",
			LoadAverage: "Unknown",
			CurrentTime: "Unknown",
		}, nil
	}

	uptime := "Unknown"
	if result.Success && result.Output != "" {
		fields := strings.Fields(result.Output)
		if len(fields) > 0 {
			uptime = fields[0] + " seconds"
		}
	}

	timeResult, _ := ExecuteAdb([]string{"-s", connectKey, "shell", "date"})
	currentTime := "Unknown"
	if timeResult != nil && timeResult.Success {
		currentTime = strings.TrimSpace(timeResult.Output)
	}

	return &hdc.SystemRuntime{
		Uptime:      uptime,
		LoadAverage: "N/A",
		CurrentTime: currentTime,
	}, nil
}

// GetSystemProperties 获取 Android 设备的所有系统属性
func GetSystemProperties(connectKey string) (hdc.SystemProperties, error) {
	result, err := ExecuteAdb([]string{"-s", connectKey, "shell", "getprop"})
	if err != nil {
		return hdc.SystemProperties{}, err
	}

	props := make(hdc.SystemProperties)
	if !result.Success || result.Output == "" {
		return props, nil
	}

	lines := strings.Split(result.Output, "\n")
	re := regexp.MustCompile(`\[([^\]]*)\]: \[([^\]]*)\]`)

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		matches := re.FindStringSubmatch(line)
		if len(matches) == 3 {
			props[matches[1]] = matches[2]
		}
	}

	return props, nil
}

// GetDeviceUdid 获取 Android 设备的 UDID (Android ID)
func GetDeviceUdid(connectKey string) (string, error) {
	result, err := ExecuteAdb([]string{"-s", connectKey, "shell", "settings", "get", "secure", "android_id"})
	if err != nil {
		return "", fmt.Errorf("failed to get device UDID: %v", err)
	}

	if !result.Success {
		return "", fmt.Errorf("failed to get device UDID: %s", result.Error)
	}

	udid := strings.TrimSpace(result.Output)
	if udid == "" || udid == "null" {
		return "", fmt.Errorf("unable to get android_id")
	}

	return udid, nil
}

// getOrDefault 如果值为空则返回默认值
func getOrDefault(value string, defaultValue string) string {
	if value == "" {
		return defaultValue
	}
	return value
}
