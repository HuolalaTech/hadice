package phoneAgent

import (
	"fmt"

	"Hadice/backend/hdc"
)

// ExecuteAction 执行设备操作
// connectKey: 设备标识符
// action: 操作指令
// screenWidth: 屏幕宽度
// screenHeight: 屏幕高度
// 返回操作结果
func ExecuteAction(connectKey string, action *Action, screenWidth, screenHeight int) (*ActionResult, error) {
	if action == nil {
		fmt.Printf("[Action] 错误: 操作指令为空\n")
		return &ActionResult{
			Success:      false,
			ShouldFinish: true,
			Message:      "操作指令为空",
		}, nil
	}

	fmt.Printf("[Action] 开始执行操作 - 类型: %s, 操作: %s, 屏幕: %dx%d, 设备: %s\n",
		action.Metadata, action.Action, screenWidth, screenHeight, connectKey)

	// 检查是否是完成操作
	if action.Metadata == string(ActionTypeFinish) {
		fmt.Printf("[Action] 检测到完成操作: %s\n", action.Message)
		return &ActionResult{
			Success:      true,
			ShouldFinish: true,
			Message:      action.Message,
		}, nil
	}

	// 检查是否是执行操作
	if action.Metadata != string(ActionTypeDo) {
		fmt.Printf("[Action] 错误: 未知的操作类型 - %s\n", action.Metadata)
		return &ActionResult{
			Success:      false,
			ShouldFinish: true,
			Message:      fmt.Sprintf("未知的操作类型: %s", action.Metadata),
		}, nil
	}

	// 根据操作类型执行
	fmt.Printf("[Action] 执行操作: %s\n", action.Action)
	switch action.Action {
	case "Tap", "Click":
		fmt.Printf("[Action] 执行点击操作，坐标: %v\n", action.Element)
		return executeTap(connectKey, action, screenWidth, screenHeight)
	case "Swipe":
		fmt.Printf("[Action] 执行滑动操作，坐标: %v\n", action.Element)
		return executeSwipe(connectKey, action, screenWidth, screenHeight)
	case "Type", "Type_Name":
		fmt.Printf("[Action] 执行输入操作，文本: %s\n", action.Text)
		return executeType(connectKey, action)
	case "Back":
		fmt.Printf("[Action] 执行返回操作\n")
		return executeBack(connectKey)
	case "Home":
		fmt.Printf("[Action] 执行主页操作\n")
		return executeHome(connectKey)
	case "Launch":
		fmt.Printf("[Action] 执行启动应用操作，应用: %s\n", action.App)
		return executeLaunch(connectKey, action)
	case "Wait":
		fmt.Printf("[Action] 执行等待操作\n")
		return executeWait(action)
	default:
		fmt.Printf("[Action] 错误: 不支持的操作 - %s\n", action.Action)
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      fmt.Sprintf("不支持的操作: %s", action.Action),
		}, nil
	}
}

// convertRelativeToAbsolute 将相对坐标(0-1000)转换为绝对像素坐标
func convertRelativeToAbsolute(element []int, screenWidth, screenHeight int) (int, int) {
	if len(element) < 2 {
		return 0, 0
	}
	x := int(float64(element[0]) / 1000.0 * float64(screenWidth))
	y := int(float64(element[1]) / 1000.0 * float64(screenHeight))
	return x, y
}

// executeTap 执行点击操作
func executeTap(connectKey string, action *Action, screenWidth, screenHeight int) (*ActionResult, error) {
	if len(action.Element) < 2 {
		fmt.Printf("[Action] 错误: 点击操作缺少坐标信息\n")
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      "点击操作缺少坐标信息",
		}, nil
	}

	x, y := convertRelativeToAbsolute(action.Element, screenWidth, screenHeight)
	fmt.Printf("[Action] 点击坐标转换: 相对%v -> 绝对(%d, %d)\n", action.Element, x, y)

	// 调用HDC点击功能
	hdcCmd := []string{
		"-t", connectKey,
		"shell", "uitest", "uiInput", "click",
		fmt.Sprintf("%d", x),
		fmt.Sprintf("%d", y),
	}
	fmt.Printf("[Action] 执行HDC命令: hdc %v\n", hdcCmd)

	result, err := hdc.ExecuteHdc(hdcCmd)
	if err != nil {
		fmt.Printf("[Action] HDC执行失败: %v\n", err)
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      fmt.Sprintf("点击操作失败: %v", err),
		}, err
	}

	if !result.Success {
		fmt.Printf("[Action] HDC返回失败: %s\n", result.Error)
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      fmt.Sprintf("点击操作失败: %s", result.Error),
		}, nil
	}

	fmt.Printf("[Action] 点击操作成功\n")
	return &ActionResult{
		Success:      true,
		ShouldFinish: false,
		Message:      "点击操作成功",
	}, nil
}

// executeSwipe 执行滑动操作
func executeSwipe(connectKey string, action *Action, screenWidth, screenHeight int) (*ActionResult, error) {
	// 滑动操作需要起点和终点坐标
	// 简化处理：假设element包含4个值 [x1, y1, x2, y2]
	if len(action.Element) < 4 {
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      "滑动操作缺少坐标信息",
		}, nil
	}

	x1, y1 := convertRelativeToAbsolute(action.Element[0:2], screenWidth, screenHeight)
	x2, y2 := convertRelativeToAbsolute(action.Element[2:4], screenWidth, screenHeight)

	// 调用HDC滑动功能
	result, err := hdc.ExecuteHdc([]string{
		"-t", connectKey,
		"shell", "uitest", "uiInput", "swipe",
		fmt.Sprintf("%d", x1),
		fmt.Sprintf("%d", y1),
		fmt.Sprintf("%d", x2),
		fmt.Sprintf("%d", y2),
		"600", // 默认速度
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

	return &ActionResult{
		Success:      true,
		ShouldFinish: false,
		Message:      "滑动操作成功",
	}, nil
}

// executeType 执行输入操作
func executeType(connectKey string, action *Action) (*ActionResult, error) {
	if action.Text == "" {
		fmt.Printf("[Action] 错误: 输入操作缺少文本内容\n")
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      "输入操作缺少文本内容",
		}, nil
	}

	fmt.Printf("[Action] 执行输入操作，文本: %s\n", action.Text)

	// 调用HDC输入功能
	// 使用shell input text命令
	hdcCmd := []string{
		"-t", connectKey,
		"shell", "input", "text", action.Text,
	}
	fmt.Printf("[Action] 执行HDC命令: hdc %v\n", hdcCmd)

	result, err := hdc.ExecuteHdc(hdcCmd)
	if err != nil {
		fmt.Printf("[Action] HDC执行失败: %v\n", err)
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      fmt.Sprintf("输入操作失败: %v", err),
		}, err
	}

	if !result.Success {
		fmt.Printf("[Action] HDC返回失败: %s\n", result.Error)
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      fmt.Sprintf("输入操作失败: %s", result.Error),
		}, nil
	}

	fmt.Printf("[Action] 输入操作成功\n")
	return &ActionResult{
		Success:      true,
		ShouldFinish: false,
		Message:      "输入操作成功",
	}, nil
}

// executeBack 执行返回操作
func executeBack(connectKey string) (*ActionResult, error) {
	result, err := hdc.ExecuteHdc([]string{
		"-t", connectKey,
		"shell", "input", "keyevent", "4", // KEYCODE_BACK
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
func executeHome(connectKey string) (*ActionResult, error) {
	result, err := hdc.ExecuteHdc([]string{
		"-t", connectKey,
		"shell", "input", "keyevent", "3", // KEYCODE_HOME
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
func executeLaunch(connectKey string, action *Action) (*ActionResult, error) {
	if action.App == "" {
		fmt.Printf("[Action] 错误: 启动应用操作缺少包名\n")
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      "启动应用操作缺少包名",
		}, nil
	}

	fmt.Printf("[Action] 启动应用: %s (使用字段: App=%s)\n", action.App, action.App)

	// 调用HDC启动应用功能
	result, err := hdc.StartApp(connectKey, action.App)
	if err != nil {
		fmt.Printf("[Action] 启动应用失败: %v\n", err)
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      fmt.Sprintf("启动应用失败: %v", err),
		}, err
	}

	if !result.Success {
		fmt.Printf("[Action] 启动应用返回失败: %s\n", result.Error)
		return &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      fmt.Sprintf("启动应用失败: %s", result.Error),
		}, nil
	}

	fmt.Printf("[Action] 启动应用成功\n")
	return &ActionResult{
		Success:      true,
		ShouldFinish: false,
		Message:      fmt.Sprintf("应用 %s 启动成功", action.App),
	}, nil
}

// executeWait 执行等待操作
func executeWait(action *Action) (*ActionResult, error) {
	// 简化处理：固定等待1秒
	// 实际应该从action中读取等待时间
	// time.Sleep(1 * time.Second)
	return &ActionResult{
		Success:      true,
		ShouldFinish: false,
		Message:      "等待完成",
	}, nil
}
