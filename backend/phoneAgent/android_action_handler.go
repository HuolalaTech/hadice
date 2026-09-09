package phoneAgent

import (
	"fmt"
	"time"

	"Hadice/backend/adb"
)

// AndroidActionHandler Android平台的动作执行处理器
type AndroidActionHandler struct {
	deviceID string // 设备标识符
}

// NewAndroidActionHandler 创建Android动作处理器
func NewAndroidActionHandler(deviceID string) *AndroidActionHandler {
	return &AndroidActionHandler{
		deviceID: deviceID,
	}
}

// Execute 执行动作
func (h *AndroidActionHandler) Execute(action *Action, screenWidth, screenHeight int) (*ActionResult, error) {
	if action == nil {
		fmt.Printf("[AndroidActionHandler] 错误: 操作指令为空\n")
		return &ActionResult{
			Success:      false,
			ShouldFinish: true,
			Message:      "操作指令为空",
		}, nil
	}

	fmt.Printf("[AndroidActionHandler] 开始执行操作 - 类型: %s, 操作: %s, 屏幕: %dx%d, 设备: %s\n",
		action.Metadata, action.Action, screenWidth, screenHeight, h.deviceID)

	// 检查是否是完成操作
	if action.Metadata == string(ActionTypeFinish) {
		fmt.Printf("[AndroidActionHandler] 检测到完成操作: %s\n", action.Message)
		return &ActionResult{
			Success:      true,
			ShouldFinish: true,
			Message:      action.Message,
		}, nil
	}

	// 检查是否是执行操作
	if action.Metadata != string(ActionTypeDo) {
		fmt.Printf("[AndroidActionHandler] 错误: 未知的操作类型 - %s\n", action.Metadata)
		return &ActionResult{
			Success:      false,
			ShouldFinish: true,
			Message:      fmt.Sprintf("未知的操作类型: %s", action.Metadata),
		}, nil
	}

	// 验证动作
	if err := h.ValidateAction(action); err != nil {
		fmt.Printf("[AndroidActionHandler] 动作验证失败: %v\n", err)
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      fmt.Sprintf("动作验证失败: %v", err),
		}, err
	}

	// 根据操作类型执行
	switch action.Action {
	case "Tap", "Click":
		return h.executeTap(action, screenWidth, screenHeight)
	case "Swipe":
		return h.executeSwipe(action, screenWidth, screenHeight)
	case "Type", "Type_Name":
		return h.executeType(action, screenWidth, screenHeight)
	case "Back":
		return h.executeBack()
	case "Home":
		return h.executeHome()
	case "Launch":
		return h.executeLaunch(action)
	case "Wait":
		return h.executeWait(action)
	case "Long Press":
		return h.executeLongPress(action, screenWidth, screenHeight)
	case "Double Tap":
		return h.executeDoubleTap(action, screenWidth, screenHeight)
	default:
		fmt.Printf("[AndroidActionHandler] 错误: 不支持的操作 - %s\n", action.Action)
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      fmt.Sprintf("不支持的操作: %s", action.Action),
		}, nil
	}
}

// GetSupportedActions 获取支持的动作列表
func (h *AndroidActionHandler) GetSupportedActions() []string {
	return []string{
		"Tap", "Click", "Swipe", "Type", "Type_Name",
		"Back", "Home", "Launch", "Wait",
		"Long Press", "Double Tap",
	}
}

// ValidateAction 验证动作
func (h *AndroidActionHandler) ValidateAction(action *Action) error {
	if action == nil {
		return fmt.Errorf("action is nil")
	}

	switch action.Action {
	case "Tap", "Click":
		if len(action.Element) < 2 {
			return fmt.Errorf("Tap action missing or invalid element parameter")
		}
		for _, coord := range action.Element {
			if coord < 0 || coord > 999 {
				return fmt.Errorf("coordinate out of range: %d (valid range: 0-999)", coord)
			}
		}
	case "Swipe":
		if len(action.Element) < 2 {
			return fmt.Errorf("Swipe action missing start coordinates")
		}
		if action.Extra == nil {
			return fmt.Errorf("Swipe action missing end coordinates")
		}
		if end, ok := action.Extra["end"].([]int); !ok || len(end) < 2 {
			return fmt.Errorf("Swipe action missing valid end coordinates")
		}
	case "Type", "Type_Name":
		if action.Text == "" {
			return fmt.Errorf("%s action missing text parameter", action.Action)
		}
	case "Launch":
		if action.App == "" {
			return fmt.Errorf("Launch action missing app parameter")
		}
	case "Wait":
		if action.Message == "" {
			return fmt.Errorf("Wait action missing duration parameter")
		}
	case "Long Press", "Double Tap":
		if len(action.Element) < 2 {
			return fmt.Errorf("%s action missing or invalid element parameter", action.Action)
		}
	}

	return nil
}

// convertRelativeToAbsolute 将相对坐标(0-1000)转换为绝对像素坐标
func (h *AndroidActionHandler) convertRelativeToAbsolute(element []int, screenWidth, screenHeight int) (int, int) {
	if len(element) < 2 {
		return 0, 0
	}
	x := int(float64(element[0]) / 1000.0 * float64(screenWidth))
	y := int(float64(element[1]) / 1000.0 * float64(screenHeight))
	return x, y
}

// executeTap 执行点击操作
func (h *AndroidActionHandler) executeTap(action *Action, screenWidth, screenHeight int) (*ActionResult, error) {
	if len(action.Element) < 2 {
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      "点击操作缺少坐标信息",
		}, nil
	}

	x, y := h.convertRelativeToAbsolute(action.Element, screenWidth, screenHeight)
	fmt.Printf("[AndroidActionHandler] 点击坐标转换: 相对%v -> 绝对(%d, %d)\n", action.Element, x, y)

	result, err := adb.ExecuteAdb([]string{
		"-s", h.deviceID,
		"shell", "input", "tap",
		fmt.Sprintf("%d", x),
		fmt.Sprintf("%d", y),
	})
	if err != nil {
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      fmt.Sprintf("点击操作失败: %v", err),
		}, err
	}

	if !result.Success {
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      fmt.Sprintf("点击操作失败: %s", result.Error),
		}, nil
	}

	fmt.Printf("[AndroidActionHandler] 点击操作成功\n")
	return &ActionResult{
		Success:      true,
		ShouldFinish: false,
		Message:      "点击操作成功",
	}, nil
}

// executeSwipe 执行滑动操作
func (h *AndroidActionHandler) executeSwipe(action *Action, screenWidth, screenHeight int) (*ActionResult, error) {
	if len(action.Element) < 2 {
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      "滑动操作缺少起始坐标",
		}, nil
	}

	var x2, y2 int
	if action.Extra != nil {
		if end, ok := action.Extra["end"].([]int); ok && len(end) >= 2 {
			x2, y2 = h.convertRelativeToAbsolute(end, screenWidth, screenHeight)
		} else {
			return &ActionResult{
				Success:      false,
				ShouldFinish: false,
				Message:      "滑动操作缺少结束坐标",
			}, nil
		}
	} else {
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      "滑动操作缺少结束坐标",
		}, nil
	}

	x1, y1 := h.convertRelativeToAbsolute(action.Element, screenWidth, screenHeight)
	fmt.Printf("[AndroidActionHandler] 滑动操作: (%d, %d) -> (%d, %d)\n", x1, y1, x2, y2)

	result, err := adb.ExecuteAdb([]string{
		"-s", h.deviceID,
		"shell", "input", "swipe",
		fmt.Sprintf("%d", x1),
		fmt.Sprintf("%d", y1),
		fmt.Sprintf("%d", x2),
		fmt.Sprintf("%d", y2),
		"600",
	})
	if err != nil {
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      fmt.Sprintf("滑动操作失败: %v", err),
		}, err
	}

	if !result.Success {
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      fmt.Sprintf("滑动操作失败: %s", result.Error),
		}, nil
	}

	fmt.Printf("[AndroidActionHandler] 滑动操作成功\n")
	return &ActionResult{
		Success:      true,
		ShouldFinish: false,
		Message:      "滑动操作成功",
	}, nil
}

// executeType 执行输入操作
func (h *AndroidActionHandler) executeType(action *Action, screenWidth, screenHeight int) (*ActionResult, error) {
	if action.Text == "" {
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      "输入操作缺少文本内容",
		}, nil
	}

	// 如果有坐标，先点击输入框
	if len(action.Element) >= 2 {
		x, y := h.convertRelativeToAbsolute(action.Element, screenWidth, screenHeight)
		fmt.Printf("[AndroidActionHandler] 先点击输入框 (%d, %d)\n", x, y)
		adb.ExecuteAdb([]string{
			"-s", h.deviceID,
			"shell", "input", "tap",
			fmt.Sprintf("%d", x),
			fmt.Sprintf("%d", y),
		})
		time.Sleep(200 * time.Millisecond)
	}

	fmt.Printf("[AndroidActionHandler] 输入文本: %s\n", action.Text)

	result, err := adb.ExecuteAdb([]string{
		"-s", h.deviceID,
		"shell", "input", "text", action.Text,
	})
	if err != nil {
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      fmt.Sprintf("输入操作失败: %v", err),
		}, err
	}

	if !result.Success {
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      fmt.Sprintf("输入操作失败: %s", result.Error),
		}, nil
	}

	fmt.Printf("[AndroidActionHandler] 输入操作成功\n")
	return &ActionResult{
		Success:      true,
		ShouldFinish: false,
		Message:      "输入操作成功",
	}, nil
}

// executeBack 执行返回操作
func (h *AndroidActionHandler) executeBack() (*ActionResult, error) {
	result, err := adb.ExecuteAdb([]string{
		"-s", h.deviceID,
		"shell", "input", "keyevent", "4",
	})
	if err != nil {
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      fmt.Sprintf("返回操作失败: %v", err),
		}, err
	}

	if !result.Success {
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      fmt.Sprintf("返回操作失败: %s", result.Error),
		}, nil
	}

	return &ActionResult{
		Success:      true,
		ShouldFinish: false,
		Message:      "返回操作成功",
	}, nil
}

// executeHome 执行Home操作
func (h *AndroidActionHandler) executeHome() (*ActionResult, error) {
	result, err := adb.ExecuteAdb([]string{
		"-s", h.deviceID,
		"shell", "input", "keyevent", "3",
	})
	if err != nil {
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      fmt.Sprintf("Home操作失败: %v", err),
		}, err
	}

	if !result.Success {
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      fmt.Sprintf("Home操作失败: %s", result.Error),
		}, nil
	}

	return &ActionResult{
		Success:      true,
		ShouldFinish: false,
		Message:      "Home操作成功",
	}, nil
}

// executeLaunch 执行启动应用操作
func (h *AndroidActionHandler) executeLaunch(action *Action) (*ActionResult, error) {
	if action.App == "" {
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      "启动应用操作缺少应用名称",
		}, nil
	}

	fmt.Printf("[AndroidActionHandler] 启动应用: %s\n", action.App)

	// 使用 monkey 命令启动应用（只需要包名）
	result, err := adb.ExecuteAdb([]string{
		"-s", h.deviceID,
		"shell", "monkey", "-p", action.App,
		"-c", "android.intent.category.LAUNCHER", "1",
	})
	if err != nil {
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      fmt.Sprintf("启动应用失败: %v", err),
		}, err
	}

	if !result.Success {
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      fmt.Sprintf("启动应用失败: %s", result.Error),
		}, nil
	}

	return &ActionResult{
		Success:      true,
		ShouldFinish: false,
		Message:      fmt.Sprintf("应用 %s 启动成功", action.App),
	}, nil
}

// executeWait 执行等待操作
func (h *AndroidActionHandler) executeWait(action *Action) (*ActionResult, error) {
	duration := 1 * time.Second

	if action.Message != "" {
		var seconds int
		_, err := fmt.Sscanf(action.Message, "%d", &seconds)
		if err == nil && seconds > 0 {
			duration = time.Duration(seconds) * time.Second
		}
	}

	fmt.Printf("[AndroidActionHandler] 执行等待操作，时长: %v\n", duration)
	time.Sleep(duration)

	return &ActionResult{
		Success:      true,
		ShouldFinish: false,
		Message:      fmt.Sprintf("等待 %v 完成", duration),
	}, nil
}

// executeLongPress 执行长按操作
func (h *AndroidActionHandler) executeLongPress(action *Action, screenWidth, screenHeight int) (*ActionResult, error) {
	if len(action.Element) < 2 {
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      "长按操作缺少坐标信息",
		}, nil
	}

	x, y := h.convertRelativeToAbsolute(action.Element, screenWidth, screenHeight)
	fmt.Printf("[AndroidActionHandler] 长按坐标转换: 相对%v -> 绝对(%d, %d)\n", action.Element, x, y)

	// Android 使用 input swipe 实现长按：从同一点滑到同一点
	result, err := adb.ExecuteAdb([]string{
		"-s", h.deviceID,
		"shell", "input", "swipe",
		fmt.Sprintf("%d", x),
		fmt.Sprintf("%d", y),
		fmt.Sprintf("%d", x),
		fmt.Sprintf("%d", y),
		"1000",
	})
	if err != nil {
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      fmt.Sprintf("长按操作失败: %v", err),
		}, err
	}

	if !result.Success {
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      fmt.Sprintf("长按操作失败: %s", result.Error),
		}, nil
	}

	return &ActionResult{
		Success:      true,
		ShouldFinish: false,
		Message:      "长按操作成功",
	}, nil
}

// executeDoubleTap 执行双击操作
func (h *AndroidActionHandler) executeDoubleTap(action *Action, screenWidth, screenHeight int) (*ActionResult, error) {
	if len(action.Element) < 2 {
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      "双击操作缺少坐标信息",
		}, nil
	}

	x, y := h.convertRelativeToAbsolute(action.Element, screenWidth, screenHeight)
	fmt.Printf("[AndroidActionHandler] 双击坐标转换: 相对%v -> 绝对(%d, %d)\n", action.Element, x, y)

	// 双击：连续两次 tap，间隔 100ms
	adb.ExecuteAdb([]string{
		"-s", h.deviceID,
		"shell", "input", "tap",
		fmt.Sprintf("%d", x),
		fmt.Sprintf("%d", y),
	})
	time.Sleep(100 * time.Millisecond)
	result, err := adb.ExecuteAdb([]string{
		"-s", h.deviceID,
		"shell", "input", "tap",
		fmt.Sprintf("%d", x),
		fmt.Sprintf("%d", y),
	})
	if err != nil {
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      fmt.Sprintf("双击操作失败: %v", err),
		}, err
	}

	if !result.Success {
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      fmt.Sprintf("双击操作失败: %s", result.Error),
		}, nil
	}

	return &ActionResult{
		Success:      true,
		ShouldFinish: false,
		Message:      "双击操作成功",
	}, nil
}
