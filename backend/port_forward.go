package backend

import (
	"encoding/json"
	"fmt"
	"log"
	"net"
	"regexp"
	"strconv"
	"strings"
	"time"

	"Hadice/backend/hdc"

	"github.com/samber/lo"
)

// PortForwardStatus 端口转发状态
type PortForwardStatus struct {
	Configured bool   `json:"configured"`
	LocalPort  int    `json:"localPort"`
	DevicePort int    `json:"devicePort"`
	Status     string `json:"status"` // normal, error, not_configured
	Error      string `json:"error,omitempty"`
}

// PortForwardItem 端口转发项
type PortForwardItem struct {
	LocalPort  int    `json:"localPort"`
	DevicePort int    `json:"devicePort"`
	Type       string `json:"type"` // Forward, Reverse
}

// ConfigurePortForward 配置端口转发
// type参数: "Forward" 使用 fport 命令, "Reverse" 使用 rport 命令
func (a *App) ConfigurePortForward(deviceId string, localPort int, devicePort int, portType string) (*PortForwardStatus, error) {
	// 先删除可能存在的旧转发（正向和反向都尝试删除）
	_, _ = hdc.ExecuteHdc([]string{"fport", "rm", fmt.Sprintf("tcp:%d", localPort), fmt.Sprintf("tcp:%d", devicePort)})
	_, _ = hdc.ExecuteHdc([]string{"rport", "rm", fmt.Sprintf("tcp:%d", localPort), fmt.Sprintf("tcp:%d", devicePort)})

	// 根据类型选择命令
	var cmd []string
	if portType == "Reverse" {
		// 反向端口转发：rport [设备端口] [主机端口]
		cmd = []string{"rport", fmt.Sprintf("tcp:%d", devicePort), fmt.Sprintf("tcp:%d", localPort)}
	} else {
		// 正向端口转发：fport [主机端口] [设备端口]
		cmd = []string{"fport", fmt.Sprintf("tcp:%d", localPort), fmt.Sprintf("tcp:%d", devicePort)}
	}

	// 配置新转发
	result, err := hdc.ExecuteHdc(cmd)
	if err != nil {
		return &PortForwardStatus{
			Configured: false,
			LocalPort:  localPort,
			DevicePort: devicePort,
			Status:     "error",
			Error:      err.Error(),
		}, err
	}

	// 检查输出中是否包含成功标识
	// 正向转发成功标识: Forwardport result:OK 或 OK
	// 反向转发成功标识: 可能是 OK 或其他成功信息
	isSuccess := result.Success && (strings.Contains(result.Output, "Forwardport result:OK") ||
		strings.Contains(result.Output, "OK") ||
		result.Output == "")

	if isSuccess {
		log.Printf("[NetworkCapture] Port forward configured (%s): %d -> %d", portType, localPort, devicePort)
		return &PortForwardStatus{
			Configured: true,
			LocalPort:  localPort,
			DevicePort: devicePort,
			Status:     "normal",
		}, nil
	}

	// 检查是否是端口占用错误
	if strings.Contains(result.Output, "TCP Port listen failed") {
		re := regexp.MustCompile(`TCP Port listen failed at (\d+)`)
		if match := re.FindStringSubmatch(result.Output); len(match) > 1 {
			errorPort := match[1]
			return &PortForwardStatus{
				Configured: false,
				LocalPort:  localPort,
				DevicePort: devicePort,
				Status:     "error",
				Error:      fmt.Sprintf("端口 %s 被占用或无法监听，请检查端口是否被其他程序占用", errorPort),
			}, nil
		}
	}

	// 提取错误信息
	errorMsg := "配置失败"
	if strings.Contains(result.Output, "[Fail]") {
		re := regexp.MustCompile(`\[Fail\](.+)`)
		if match := re.FindStringSubmatch(result.Output); len(match) > 1 {
			errorMsg = strings.TrimSpace(match[1])
		} else {
			errorMsg = result.Output
		}
	} else if result.Error != "" {
		errorMsg = result.Error
	}

	return &PortForwardStatus{
		Configured: false,
		LocalPort:  localPort,
		DevicePort: devicePort,
		Status:     "error",
		Error:      errorMsg,
	}, nil
}

// RemovePortForward 删除端口转发
func (a *App) RemovePortForward(localPort int, devicePort int) (*hdc.HdcResult, error) {
	// 先尝试删除正向转发
	result, err := hdc.ExecuteHdc([]string{"fport", "rm", fmt.Sprintf("tcp:%d", localPort), fmt.Sprintf("tcp:%d", devicePort)})
	if err != nil {
		return &hdc.HdcResult{
			Success: false,
			Output:  "",
			Error:   err.Error(),
		}, err
	}

	// 检查是否成功
	isSuccess := result.Success && (strings.Contains(result.Output, "Remove forward ruler success") ||
		strings.Contains(result.Output, "success"))

	// 如果正向删除失败，尝试删除反向转发（rport 格式不同）
	if !isSuccess {
		// rport 删除格式: rport rm tcp:设备端口 tcp:主机端口
		result2, err2 := hdc.ExecuteHdc([]string{"rport", "rm", fmt.Sprintf("tcp:%d", devicePort), fmt.Sprintf("tcp:%d", localPort)})
		if err2 == nil {
			isSuccess2 := result2.Success && (strings.Contains(result2.Output, "Remove") ||
				strings.Contains(result2.Output, "success") ||
				result2.Output == "")
			if isSuccess2 {
				return &hdc.HdcResult{
					Success: true,
					Output:  result2.Output,
					Error:   "",
				}, nil
			}
		}
	}

	return &hdc.HdcResult{
		Success: isSuccess,
		Output:  result.Output,
		Error: func() string {
			if isSuccess {
				return ""
			}
			if result.Error != "" {
				return result.Error
			}
			return result.Output
		}(),
	}, nil
}

// CheckPortForwardStatus 检查端口转发状态
func (a *App) CheckPortForwardStatus(localPort int, devicePort int) (*PortForwardStatus, error) {
	result, err := hdc.ExecuteHdc([]string{"fport", "ls"})
	if err != nil {
		return &PortForwardStatus{
			Configured: false,
			LocalPort:  localPort,
			DevicePort: devicePort,
			Status:     "not_configured",
		}, err
	}

	if !result.Success {
		return &PortForwardStatus{
			Configured: false,
			LocalPort:  localPort,
			DevicePort: devicePort,
			Status:     "not_configured",
		}, nil
	}

	// 检查输出中是否包含该转发
	forwardPattern := fmt.Sprintf("tcp:%d\\s+tcp:%d", localPort, devicePort)
	re := regexp.MustCompile(forwardPattern)
	isConfigured := re.MatchString(result.Output)

	return &PortForwardStatus{
		Configured: isConfigured,
		LocalPort:  localPort,
		DevicePort: devicePort,
		Status: func() string {
			if isConfigured {
				return "normal"
			}
			return "not_configured"
		}(),
	}, nil
}

// CheckReversePortForwardStatus 检查反向端口转发状态
func (a *App) CheckReversePortForwardStatus(deviceId string, localPort int, devicePort int) (*PortForwardStatus, error) {
	// rport ls 命令可能不被支持，我们尝试使用 fport ls 来检查
	// 或者直接尝试配置，如果失败说明可能已存在或端口被占用
	
	// 尝试使用 fport ls 检查所有端口转发
	result, err := hdc.ExecuteHdc([]string{"fport", "ls"})
	if err != nil {
		return &PortForwardStatus{
			Configured: false,
			LocalPort:  localPort,
			DevicePort: devicePort,
			Status:     "not_configured",
		}, err
	}

	if !result.Success {
		return &PortForwardStatus{
			Configured: false,
			LocalPort:  localPort,
			DevicePort: devicePort,
			Status:     "not_configured",
		}, nil
	}

	// 检查输出中是否包含该转发（正向或反向）
	// fport 格式: tcp:本地端口 tcp:设备端口 [Forward] 或 tcp:设备端口 tcp:本地端口 [Reverse]
	forwardPattern := fmt.Sprintf("tcp:%d\\s+tcp:%d\\s+\\[(Forward|Reverse)\\]", localPort, devicePort)
	reversePattern := fmt.Sprintf("tcp:%d\\s+tcp:%d\\s+\\[(Forward|Reverse)\\]", devicePort, localPort)
	
	re1 := regexp.MustCompile(forwardPattern)
	re2 := regexp.MustCompile(reversePattern)
	
	isConfigured := re1.MatchString(result.Output) || re2.MatchString(result.Output)

	return &PortForwardStatus{
		Configured: isConfigured,
		LocalPort:  localPort,
		DevicePort: devicePort,
		Status: func() string {
			if isConfigured {
				return "normal"
			}
			return "not_configured"
		}(),
	}, nil
}

// ListPortForwards 获取所有端口转发列表
func (a *App) ListPortForwards() ([]PortForwardItem, error) {
	log.Printf("[NetworkCapture] 开始获取端口转发列表...")

	// 先检查 HDC 服务状态
	serverInfo, err := hdc.CheckServer()
	if err != nil {
		log.Printf("[NetworkCapture] ❌ 检查 HDC 服务状态失败: %v", err)
		return []PortForwardItem{}, fmt.Errorf("HDC 服务检查失败: %v", err)
	}

	// 检查是否有设备连接
	devices, err := hdc.ListDevices(false)
	if err != nil {
		log.Printf("[NetworkCapture] ❌ 获取设备列表失败: %v", err)
		return []PortForwardItem{}, fmt.Errorf("获取设备列表失败: %v", err)
	}

	if len(devices) == 0 {
		log.Printf("[NetworkCapture] ⚠️ 没有设备连接，返回空列表")
		return []PortForwardItem{}, nil
	}

	log.Printf("[NetworkCapture] HDC 服务状态: client=%s, server=%s, 设备数量=%d",
		serverInfo["client"], serverInfo["server"], len(devices))

	result, err := hdc.ExecuteHdc([]string{"fport", "ls"})
	if err != nil {
		log.Printf("[NetworkCapture] ❌ 执行 fport ls 命令失败: %v", err)
		log.Printf("[NetworkCapture] 错误详情: %+v", err)
		return []PortForwardItem{}, fmt.Errorf("执行端口转发列表命令失败: %v", err)
	}

	if !result.Success {
		log.Printf("[NetworkCapture] ⚠️ fport ls 命令执行失败: Success=false, Output=%s, Error=%s",
			result.Output, result.Error)
		// 如果命令失败但输出为空，可能是没有端口转发配置
		if result.Output == "" && result.Error == "" {
			log.Printf("[NetworkCapture] 输出为空，返回空列表")
			return []PortForwardItem{}, nil
		}
		// 如果有错误信息，返回错误
		if result.Error != "" {
			return []PortForwardItem{}, fmt.Errorf("端口转发列表命令失败: %s", result.Error)
		}
		return []PortForwardItem{}, nil
	}

	if result.Output == "" {
		log.Printf("[NetworkCapture] ✅ 命令执行成功，但没有端口转发配置")
		return []PortForwardItem{}, nil
	}

	log.Printf("[NetworkCapture] ✅ 命令执行成功，输出长度: %d 字符", len(result.Output))

	// 匹配格式: tcp:1234 tcp:1080 [Forward]
	re := regexp.MustCompile(`tcp:(\d+)\s+tcp:(\d+)\s+\[(Forward|Reverse)\]`)
	lines := strings.Split(result.Output, "\n")

	// 使用lo.FilterMap优化解析
	forwards := lo.FilterMap(lines, func(line string, _ int) (PortForwardItem, bool) {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			return PortForwardItem{}, false
		}

		match := re.FindStringSubmatch(trimmed)
		if len(match) >= 4 {
			localPort, _ := strconv.Atoi(match[1])
			devicePort, _ := strconv.Atoi(match[2])
			return PortForwardItem{
				LocalPort:  localPort,
				DevicePort: devicePort,
				Type:       match[3],
			}, true
		}
		// 记录无法匹配的行，用于调试
		log.Printf("[NetworkCapture] ⚠️ 无法解析端口转发行: %s", trimmed)
		return PortForwardItem{}, false
	})

	log.Printf("[NetworkCapture] ✅ 成功解析 %d 个端口转发配置", len(forwards))
	return forwards, nil
}

// TestConnection 测试连接
func (a *App) TestConnection(localPort int) (map[string]interface{}, error) {
	conn, err := net.DialTimeout("tcp", fmt.Sprintf("localhost:%d", localPort), 5*time.Second)
	if err != nil {
		return NewErrorResponse(err), nil
	}
	defer conn.Close()

	// 发送测试消息
	testMsg := map[string]interface{}{
		"type":      "test",
		"timestamp": time.Now().UnixMilli(),
		"client":    "Harmony Hadice",
	}
	msgBytes, _ := json.Marshal(testMsg)
	conn.Write(append(msgBytes, '\n'))

	return NewSuccessResponse(map[string]interface{}{
		"latency": 10, // 简化处理，实际应该计算延迟
	}), nil
}
