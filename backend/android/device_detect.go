package android

import (
	"fmt"
	"strings"
	"sync"

	"Hadice/backend/adb"
)

type DevicePlatform string

const (
	PlatformHarmonyOS DevicePlatform = "harmonyos"
	PlatformAndroid   DevicePlatform = "android"
	PlatformUnknown   DevicePlatform = "unknown"
)

type AndroidDevice struct {
	DeviceID     string `json:"deviceId"`
	Model        string `json:"model"`
	Brand        string `json:"brand"`
	AndroidVer   string `json:"androidVersion"`
	APILevel     int    `json:"apiLevel"`
	IsDebuggable bool   `json:"isDebuggable"`
}

var deviceCacheMu sync.RWMutex
var devicePlatformCache = make(map[string]DevicePlatform)

func DetectPlatform(deviceID string) DevicePlatform {
	deviceCacheMu.RLock()
	if platform, ok := devicePlatformCache[deviceID]; ok {
		deviceCacheMu.RUnlock()
		return platform
	}
	deviceCacheMu.RUnlock()

	args := []string{"-s", deviceID, "shell", "getprop", "ro.build.version.sdk"}
	result, err := adb.ExecuteAdb(args)
	if err == nil && result.Success {
		sdkLevel := strings.TrimSpace(result.Output)
		if sdkLevel != "" {
			deviceCacheMu.Lock()
			devicePlatformCache[deviceID] = PlatformAndroid
			deviceCacheMu.Unlock()
			return PlatformAndroid
		}
	}

	deviceCacheMu.Lock()
	devicePlatformCache[deviceID] = PlatformUnknown
	deviceCacheMu.Unlock()
	return PlatformUnknown
}

func IsAndroidDevice(deviceID string) bool {
	return DetectPlatform(deviceID) == PlatformAndroid
}

func GetAndroidDeviceList() ([]AndroidDevice, error) {
	args := []string{"devices", "-l"}
	result, err := adb.ExecuteAdb(args)
	if err != nil {
		return nil, fmt.Errorf("failed to execute adb devices: %w", err)
	}
	if !result.Success {
		return nil, fmt.Errorf("adb devices failed: %s", result.Error)
	}

	lines := strings.Split(result.Output, "\n")
	var devices []AndroidDevice

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "List of devices") {
			continue
		}

		parts := strings.Fields(line)
		if len(parts) < 2 {
			continue
		}

		deviceID := parts[0]
		status := parts[1]

		if status != "device" {
			continue
		}

		if DetectPlatform(deviceID) != PlatformAndroid {
			continue
		}

		device := AndroidDevice{
			DeviceID: deviceID,
		}

		device.Model = getDeviceProp(deviceID, "ro.product.model")
		device.Brand = getDeviceProp(deviceID, "ro.product.brand")
		device.AndroidVer = getDeviceProp(deviceID, "ro.build.version.release")

		apiLevelStr := getDeviceProp(deviceID, "ro.build.version.sdk")
		if apiLevelStr != "" {
			apiLevel := 0
			for _, c := range apiLevelStr {
				if c >= '0' && c <= '9' {
					apiLevel = apiLevel*10 + int(c-'0')
				}
			}
			device.APILevel = apiLevel
		}

		roDebuggable := getDeviceProp(deviceID, "ro.debuggable")
		device.IsDebuggable = roDebuggable == "1"

		devices = append(devices, device)
	}

	return devices, nil
}

func getDeviceProp(deviceID, prop string) string {
	args := []string{"-s", deviceID, "shell", "getprop", prop}
	result, err := adb.ExecuteAdb(args)
	if err != nil || !result.Success {
		return ""
	}
	return strings.TrimSpace(result.Output)
}

func GetDevicePropInt(deviceID, prop string) int {
	val := getDeviceProp(deviceID, prop)
	result := 0
	for _, c := range val {
		if c >= '0' && c <= '9' {
			result = result*10 + int(c-'0')
		}
	}
	return result
}

func IsDeviceRooted(deviceID string) bool {
	args := []string{"-s", deviceID, "shell", "which", "su"}
	result, err := adb.ExecuteAdb(args)
	if err == nil && result.Success && strings.TrimSpace(result.Output) != "" {
		return true
	}

	args = []string{"-s", deviceID, "shell", "test", "-e", "/system/bin/su", "&&", "echo", "1", "||", "echo", "0"}
	result, err = adb.ExecuteAdb(args)
	if err == nil && result.Success && strings.TrimSpace(result.Output) == "1" {
		return true
	}

	return false
}

func ClearDeviceCache(deviceID string) {
	deviceCacheMu.Lock()
	delete(devicePlatformCache, deviceID)
	deviceCacheMu.Unlock()
}
