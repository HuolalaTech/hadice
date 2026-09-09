package backend

import (
	"fmt"
	"strings"

	"Hadice/backend/adb"
	"Hadice/backend/device"
	"Hadice/backend/hdc"
)

type WirelessDebugRequest struct {
	Platform    string `json:"platform"`
	Mode        string `json:"mode"`
	Host        string `json:"host"`
	PairPort    string `json:"pairPort,omitempty"`
	PairCode    string `json:"pairCode,omitempty"`
	ConnectPort string `json:"connectPort,omitempty"`
	Address     string `json:"address,omitempty"`
}

type WirelessDebugResult struct {
	Success    bool            `json:"success"`
	Output     string          `json:"output"`
	Error      string          `json:"error,omitempty"`
	ConnectKey string          `json:"connectKey,omitempty"`
	Platform   device.Platform `json:"platform"`
}

type wirelessCommandPlan struct {
	Platform    device.Platform
	PairArgs    []string
	ConnectArgs []string
	ConnectKey  string
}

func buildWirelessDebugPlan(req WirelessDebugRequest) (*wirelessCommandPlan, error) {
	platform := strings.TrimSpace(req.Platform)
	mode := strings.TrimSpace(req.Mode)

	switch platform {
	case string(device.PlatformAndroid):
		address := strings.TrimSpace(req.Address)
		if address == "" {
			address = joinHostPort(strings.TrimSpace(req.Host), strings.TrimSpace(req.ConnectPort))
		}
		if strings.Contains(address, "：") {
			return nil, fmt.Errorf("IP地址和端口中不能使用中文冒号，请使用英文冒号 :")
		}
		if address == "" {
			return nil, fmt.Errorf("请输入安卓设备 IP:端口")
		}
		if mode == "" {
			mode = "connectOnly"
		}
		if mode != "connectOnly" {
			return nil, fmt.Errorf("未知安卓无线调试模式: %s", mode)
		}
		return &wirelessCommandPlan{
			Platform:    device.PlatformAndroid,
			ConnectArgs: []string{"connect", address},
			ConnectKey:  address,
		}, nil

	case string(device.PlatformHarmonyOS):
		address := strings.TrimSpace(req.Address)
		if address == "" {
			address = joinHostPort(strings.TrimSpace(req.Host), strings.TrimSpace(req.ConnectPort))
		}
		if strings.Contains(address, "：") {
			return nil, fmt.Errorf("IP地址和端口中不能使用中文冒号，请使用英文冒号 :")
		}
		if strings.TrimSpace(address) == "" {
			return nil, fmt.Errorf("请输入鸿蒙设备 IP:端口")
		}
		return &wirelessCommandPlan{
			Platform:    device.PlatformHarmonyOS,
			ConnectArgs: []string{"tconn", address},
			ConnectKey:  address,
		}, nil
	default:
		return nil, fmt.Errorf("不支持的平台: %s", platform)
	}
}

func joinHostPort(host string, port string) string {
	host = strings.TrimSpace(host)
	port = strings.TrimSpace(port)
	if host == "" || port == "" {
		return strings.TrimSpace(host + port)
	}
	return fmt.Sprintf("%s:%s", host, port)
}

func adbCommandSucceeded(output string) bool {
	lower := strings.ToLower(output)
	if strings.Contains(lower, "failed") ||
		strings.Contains(lower, "cannot") ||
		strings.Contains(lower, "unable") ||
		strings.Contains(lower, "error") {
		return false
	}
	return true
}

// ConnectWirelessDebugDevice 连接无线调试设备。
func (a *App) ConnectWirelessDebugDevice(req WirelessDebugRequest) (*WirelessDebugResult, error) {
	plan, err := buildWirelessDebugPlan(req)
	if err != nil {
		return nil, err
	}

	switch plan.Platform {
	case device.PlatformAndroid:
		outputs := make([]string, 0, 2)
		if len(plan.PairArgs) > 0 {
			pairResult, pairErr := adb.ExecuteAdb(plan.PairArgs)
			if pairResult != nil && pairResult.Output != "" {
				outputs = append(outputs, pairResult.Output)
			}
			if pairErr != nil {
				return &WirelessDebugResult{
					Success:    false,
					Output:     strings.Join(outputs, "\n"),
					Error:      pairResultError(pairResult, pairErr),
					ConnectKey: plan.ConnectKey,
					Platform:   plan.Platform,
				}, nil
			}
			if pairResult != nil && !adbCommandSucceeded(pairResult.Output) {
				return &WirelessDebugResult{
					Success:    false,
					Output:     strings.Join(outputs, "\n"),
					Error:      pairResult.Output,
					ConnectKey: plan.ConnectKey,
					Platform:   plan.Platform,
				}, nil
			}
		}

		connectResult, connectErr := adb.ExecuteAdb(plan.ConnectArgs)
		if connectResult != nil && connectResult.Output != "" {
			outputs = append(outputs, connectResult.Output)
		}
		if connectErr != nil {
			return &WirelessDebugResult{
				Success:    false,
				Output:     strings.Join(outputs, "\n"),
				Error:      pairResultError(connectResult, connectErr),
				ConnectKey: plan.ConnectKey,
				Platform:   plan.Platform,
			}, nil
		}
		success := connectResult != nil && connectResult.Success && adbCommandSucceeded(connectResult.Output)
		errText := ""
		if !success && connectResult != nil {
			errText = connectResult.Output
			if connectResult.Error != "" {
				errText = connectResult.Error
			}
		}
		return &WirelessDebugResult{
			Success:    success,
			Output:     strings.Join(outputs, "\n"),
			Error:      errText,
			ConnectKey: plan.ConnectKey,
			Platform:   plan.Platform,
		}, nil

	case device.PlatformHarmonyOS:
		result, err := hdc.ConnectDevice(plan.ConnectKey)
		if err != nil {
			return &WirelessDebugResult{
				Success:    false,
				Error:      err.Error(),
				ConnectKey: plan.ConnectKey,
				Platform:   plan.Platform,
			}, nil
		}
		return &WirelessDebugResult{
			Success:    result.Success,
			Output:     result.Output,
			Error:      result.Error,
			ConnectKey: plan.ConnectKey,
			Platform:   plan.Platform,
		}, nil
	}

	return nil, fmt.Errorf("不支持的平台: %s", plan.Platform)
}

func pairResultError(result *adb.AdbResult, err error) string {
	if result != nil {
		if result.Error != "" {
			return result.Error
		}
		if result.Output != "" {
			return result.Output
		}
	}
	return err.Error()
}
