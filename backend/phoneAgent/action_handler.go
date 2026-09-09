package phoneAgent

import (
	"fmt"
	"time"

	"Hadice/backend/hdc"
)

// ActionHandler 动作执行处理器接口
type ActionHandler interface {
	// Execute 执行一个动作，返回执行结果
	Execute(action *Action, screenWidth, screenHeight int) (*ActionResult, error)

	// GetSupportedActions 获取支持的动作列表
	GetSupportedActions() []string

	// ValidateAction 验证动作的参数是否有效
	ValidateAction(action *Action) error
}

// HarmonyOSActionHandler HarmonyOS平台的动作执行处理器
type HarmonyOSActionHandler struct {
	deviceID string // 设备标识符
}

// NewHarmonyOSActionHandler 创建HarmonyOS动作处理器
func NewHarmonyOSActionHandler(deviceID string) *HarmonyOSActionHandler {
	return &HarmonyOSActionHandler{
		deviceID: deviceID,
	}
}

// Execute 执行动作
func (h *HarmonyOSActionHandler) Execute(action *Action, screenWidth, screenHeight int) (*ActionResult, error) {
	if action == nil {
		fmt.Printf("[ActionHandler] 错误: 操作指令为空\n")
		return &ActionResult{
			Success:      false,
			ShouldFinish: true,
			Message:      "操作指令为空",
		}, nil
	}

	fmt.Printf("[ActionHandler] 开始执行操作 - 类型: %s, 操作: %s, 屏幕: %dx%d, 设备: %s\n",
		action.Metadata, action.Action, screenWidth, screenHeight, h.deviceID)

	// 检查是否是完成操作
	if action.Metadata == string(ActionTypeFinish) {
		fmt.Printf("[ActionHandler] 检测到完成操作: %s\n", action.Message)
		return &ActionResult{
			Success:      true,
			ShouldFinish: true,
			Message:      action.Message,
		}, nil
	}

	// 检查是否是执行操作
	if action.Metadata != string(ActionTypeDo) {
		fmt.Printf("[ActionHandler] 错误: 未知的操作类型 - %s\n", action.Metadata)
		return &ActionResult{
			Success:      false,
			ShouldFinish: true,
			Message:      fmt.Sprintf("未知的操作类型: %s", action.Metadata),
		}, nil
	}

	// 验证动作
	if err := h.ValidateAction(action); err != nil {
		fmt.Printf("[ActionHandler] 动作验证失败: %v\n", err)
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
		return h.executeType(action)
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
		fmt.Printf("[ActionHandler] 错误: 不支持的操作 - %s\n", action.Action)
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      fmt.Sprintf("不支持的操作: %s", action.Action),
		}, nil
	}
}

// GetSupportedActions 获取支持的动作列表
func (h *HarmonyOSActionHandler) GetSupportedActions() []string {
	return []string{
		"Tap", "Click", "Swipe", "Type", "Type_Name",
		"Back", "Home", "Launch", "Wait",
		"Long Press", "Double Tap",
	}
}

// ValidateAction 验证动作
func (h *HarmonyOSActionHandler) ValidateAction(action *Action) error {
	if action == nil {
		return fmt.Errorf("action is nil")
	}

	switch action.Action {
	case "Tap", "Click":
		if len(action.Element) < 2 {
			return fmt.Errorf("Tap action missing or invalid element parameter")
		}
		// 检查坐标范围
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
func (h *HarmonyOSActionHandler) convertRelativeToAbsolute(element []int, screenWidth, screenHeight int) (int, int) {
	if len(element) < 2 {
		return 0, 0
	}
	x := int(float64(element[0]) / 1000.0 * float64(screenWidth))
	y := int(float64(element[1]) / 1000.0 * float64(screenHeight))
	return x, y
}

// executeTap 执行点击操作
func (h *HarmonyOSActionHandler) executeTap(action *Action, screenWidth, screenHeight int) (*ActionResult, error) {
	if len(action.Element) < 2 {
		fmt.Printf("[ActionHandler] 错误: 点击操作缺少坐标信息\n")
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      "点击操作缺少坐标信息",
		}, nil
	}

	x, y := h.convertRelativeToAbsolute(action.Element, screenWidth, screenHeight)
	fmt.Printf("[ActionHandler] 点击坐标转换: 相对%v -> 绝对(%d, %d)\n", action.Element, x, y)

	// 调用HDC点击功能
	hdcCmd := []string{
		"-t", h.deviceID,
		"shell", "uitest", "uiInput", "click",
		fmt.Sprintf("%d", x),
		fmt.Sprintf("%d", y),
	}
	fmt.Printf("[ActionHandler] 执行HDC命令: hdc %v\n", hdcCmd)

	result, err := hdc.ExecuteHdc(hdcCmd)
	if err != nil {
		fmt.Printf("[ActionHandler] HDC执行失败: %v\n", err)
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      fmt.Sprintf("点击操作失败: %v", err),
		}, err
	}

	if !result.Success {
		fmt.Printf("[ActionHandler] HDC返回失败: %s\n", result.Error)
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      fmt.Sprintf("点击操作失败: %s", result.Error),
		}, nil
	}

	fmt.Printf("[ActionHandler] 点击操作成功\n")
	return &ActionResult{
		Success:      true,
		ShouldFinish: false,
		Message:      "点击操作成功",
	}, nil
}

// executeSwipe 执行滑动操作
func (h *HarmonyOSActionHandler) executeSwipe(action *Action, screenWidth, screenHeight int) (*ActionResult, error) {
	if len(action.Element) < 2 {
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      "滑动操作缺少起始坐标",
		}, nil
	}

	// 获取结束坐标
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

	fmt.Printf("[ActionHandler] 滑动操作: (%d, %d) -> (%d, %d)\n", x1, y1, x2, y2)

	// 调用HDC滑动功能
	result, err := hdc.ExecuteHdc([]string{
		"-t", h.deviceID,
		"shell", "uitest", "uiInput", "swipe",
		fmt.Sprintf("%d", x1),
		fmt.Sprintf("%d", y1),
		fmt.Sprintf("%d", x2),
		fmt.Sprintf("%d", y2),
		"600", // 默认速度
	})
	if err != nil {
		fmt.Printf("[ActionHandler] 滑动操作HDC执行失败: %v\n", err)
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      fmt.Sprintf("滑动操作失败: %v", err),
		}, err
	}

	if !result.Success {
		fmt.Printf("[ActionHandler] 滑动操作HDC返回失败: %s\n", result.Error)
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      fmt.Sprintf("滑动操作失败: %s", result.Error),
		}, nil
	}

	fmt.Printf("[ActionHandler] 滑动操作成功\n")
	return &ActionResult{
		Success:      true,
		ShouldFinish: false,
		Message:      "滑动操作成功",
	}, nil
}

// executeType 执行输入操作
func (h *HarmonyOSActionHandler) executeType(action *Action) (*ActionResult, error) {
	if action.Text == "" {
		fmt.Printf("[ActionHandler] 错误: 输入操作缺少文本内容\n")
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      "输入操作缺少文本内容",
		}, nil
	}

	fmt.Printf("[ActionHandler] 执行输入操作，文本: %s\n", action.Text)

	var hdcCmd []string

	// 如果有坐标信息，使用 inputText <x> <y> <text> 命令
	if len(action.Element) >= 2 {
		x := action.Element[0]
		y := action.Element[1]
		fmt.Printf("[ActionHandler] 在坐标 (%d, %d) 输入文本: %s\n", x, y, action.Text)
		hdcCmd = []string{
			"-t", h.deviceID,
			"shell", "uitest", "uiInput", "inputText",
			fmt.Sprintf("%d", x),
			fmt.Sprintf("%d", y),
			action.Text,
		}
	} else {
		// 没有坐标，直接尝试使用 keyEvent 或其他方式
		// 这里使用一个占位坐标 0,0，实际应该先点击输入框再输入
		fmt.Printf("[ActionHandler] 使用默认坐标输入文本\n")
		hdcCmd = []string{
			"-t", h.deviceID,
			"shell", "uitest", "uiInput", "inputText",
			"1",
			"1",
			action.Text,
		}
	}

	fmt.Printf("[ActionHandler] 执行HDC命令: hdc %v\n", hdcCmd)

	result, err := hdc.ExecuteHdc(hdcCmd)
	if err != nil {
		fmt.Printf("[ActionHandler] HDC执行失败: %v\n", err)
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      fmt.Sprintf("输入操作失败: %v", err),
		}, err
	}

	if !result.Success {
		fmt.Printf("[ActionHandler] HDC返回失败: %s\n", result.Error)
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      fmt.Sprintf("输入操作失败: %s", result.Error),
		}, nil
	}

	fmt.Printf("[ActionHandler] 输入操作成功\n")
	return &ActionResult{
		Success:      true,
		ShouldFinish: false,
		Message:      "输入操作成功",
	}, nil
}

// executeBack 执行返回操作
func (h *HarmonyOSActionHandler) executeBack() (*ActionResult, error) {
	result, err := hdc.ExecuteHdc([]string{
		"-t", h.deviceID,
		"shell", "uitest", "uiInput", "keyEvent", "Back",
	})
	if err != nil {
		fmt.Printf("[ActionHandler] 返回操作HDC执行失败: %v\n", err)
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      fmt.Sprintf("返回操作失败: %v", err),
		}, err
	}

	if !result.Success {
		fmt.Printf("[ActionHandler] 返回操作HDC返回失败: %s\n", result.Error)
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      fmt.Sprintf("返回操作失败: %s", result.Error),
		}, nil
	}

	fmt.Printf("[ActionHandler] 返回操作成功\n")
	return &ActionResult{
		Success:      true,
		ShouldFinish: false,
		Message:      "返回操作成功",
	}, nil
}

// executeHome 执行Home操作
func (h *HarmonyOSActionHandler) executeHome() (*ActionResult, error) {
	result, err := hdc.ExecuteHdc([]string{
		"-t", h.deviceID,
		"shell", "uitest", "uiInput", "keyEvent", "Home",
	})
	if err != nil {
		fmt.Printf("[ActionHandler] Home操作HDC执行失败: %v\n", err)
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      fmt.Sprintf("Home操作失败: %v", err),
		}, err
	}

	if !result.Success {
		fmt.Printf("[ActionHandler] Home操作HDC返回失败: %s\n", result.Error)
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      fmt.Sprintf("Home操作失败: %s", result.Error),
		}, nil
	}

	fmt.Printf("[ActionHandler] Home操作成功\n")
	return &ActionResult{
		Success:      true,
		ShouldFinish: false,
		Message:      "Home操作成功",
	}, nil
}

// executeLaunch 执行启动应用操作
func (h *HarmonyOSActionHandler) executeLaunch(action *Action) (*ActionResult, error) {
	if action.App == "" {
		fmt.Printf("[ActionHandler] 错误: 启动应用操作缺少应用名称\n")
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      "启动应用操作缺少应用名称",
		}, nil
	}

	fmt.Printf("[ActionHandler] 启动应用: %s\n", action.App)

	// 调用HDC启动应用功能
	result, err := hdc.StartApp(h.deviceID, action.App)
	if err != nil {
		fmt.Printf("[ActionHandler] 启动应用失败: %v\n", err)
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      fmt.Sprintf("启动应用失败: %v", err),
		}, err
	}

	if !result.Success {
		fmt.Printf("[ActionHandler] 启动应用返回失败: %s\n", result.Error)
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      fmt.Sprintf("启动应用失败: %s", result.Error),
		}, nil
	}

	fmt.Printf("[ActionHandler] 启动应用成功\n")
	return &ActionResult{
		Success:      true,
		ShouldFinish: false,
		Message:      fmt.Sprintf("应用 %s 启动成功", action.App),
	}, nil
}

// executeWait 执行等待操作
func (h *HarmonyOSActionHandler) executeWait(action *Action) (*ActionResult, error) {
	// 从message字段解析等待时间（秒）
	duration := 1 * time.Second // 默认1秒

	if action.Message != "" {
		// 尝试从字符串中解析时间，例如 "2 seconds"
		var seconds int
		_, err := fmt.Sscanf(action.Message, "%d", &seconds)
		if err == nil && seconds > 0 {
			duration = time.Duration(seconds) * time.Second
		}
	}

	fmt.Printf("[ActionHandler] 执行等待操作，时长: %v\n", duration)
	time.Sleep(duration)

	return &ActionResult{
		Success:      true,
		ShouldFinish: false,
		Message:      fmt.Sprintf("等待 %v 完成", duration),
	}, nil
}

// executeLongPress 执行长按操作
func (h *HarmonyOSActionHandler) executeLongPress(action *Action, screenWidth, screenHeight int) (*ActionResult, error) {
	if len(action.Element) < 2 {
		fmt.Printf("[ActionHandler] 错误: 长按操作缺少坐标信息\n")
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      "长按操作缺少坐标信息",
		}, nil
	}

	x, y := h.convertRelativeToAbsolute(action.Element, screenWidth, screenHeight)
	fmt.Printf("[ActionHandler] 长按坐标转换: 相对%v -> 绝对(%d, %d)\n", action.Element, x, y)

	// 调用HDC长按功能
	hdcCmd := []string{
		"-t", h.deviceID,
		"shell", "uitest", "uiInput", "longClick",
		fmt.Sprintf("%d", x),
		fmt.Sprintf("%d", y),
	}
	fmt.Printf("[ActionHandler] 执行HDC命令: hdc %v\n", hdcCmd)

	result, err := hdc.ExecuteHdc(hdcCmd)
	if err != nil {
		fmt.Printf("[ActionHandler] HDC执行失败: %v\n", err)
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      fmt.Sprintf("长按操作失败: %v", err),
		}, err
	}

	if !result.Success {
		fmt.Printf("[ActionHandler] HDC返回失败: %s\n", result.Error)
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      fmt.Sprintf("长按操作失败: %s", result.Error),
		}, nil
	}

	fmt.Printf("[ActionHandler] 长按操作成功\n")
	return &ActionResult{
		Success:      true,
		ShouldFinish: false,
		Message:      "长按操作成功",
	}, nil
}

// executeDoubleTap 执行双击操作
func (h *HarmonyOSActionHandler) executeDoubleTap(action *Action, screenWidth, screenHeight int) (*ActionResult, error) {
	if len(action.Element) < 2 {
		fmt.Printf("[ActionHandler] 错误: 双击操作缺少坐标信息\n")
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      "双击操作缺少坐标信息",
		}, nil
	}

	x, y := h.convertRelativeToAbsolute(action.Element, screenWidth, screenHeight)
	fmt.Printf("[ActionHandler] 双击坐标转换: 相对%v -> 绝对(%d, %d)\n", action.Element, x, y)

	// 调用HDC双击功能
	hdcCmd := []string{
		"-t", h.deviceID,
		"shell", "uitest", "uiInput", "doubleClick",
		fmt.Sprintf("%d", x),
		fmt.Sprintf("%d", y),
	}
	fmt.Printf("[ActionHandler] 执行HDC命令: hdc %v\n", hdcCmd)

	result, err := hdc.ExecuteHdc(hdcCmd)
	if err != nil {
		fmt.Printf("[ActionHandler] HDC执行失败: %v\n", err)
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      fmt.Sprintf("双击操作失败: %v", err),
		}, err
	}

	if !result.Success {
		fmt.Printf("[ActionHandler] HDC返回失败: %s\n", result.Error)
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      fmt.Sprintf("双击操作失败: %s", result.Error),
		}, nil
	}

	fmt.Printf("[ActionHandler] 双击操作成功\n")
	return &ActionResult{
		Success:      true,
		ShouldFinish: false,
		Message:      "双击操作成功",
	}, nil
}
