package backend

import (
	"fmt"

	"Hadice/backend/adb"
	"Hadice/backend/device"
	"Hadice/backend/hdc"
	"Hadice/backend/hypium"
	"Hadice/backend/scrcpy"
)

func harmonyGesture(deviceSn string) *hypium.GestureChannel {
	screenMirrorMutex.RLock()
	defer screenMirrorMutex.RUnlock()
	session := screenMirrorSessions[deviceSn]
	if session == nil {
		return nil
	}
	return session.gesture
}

func executeHarmonyGesture(deviceSn, api string, x, y int) (map[string]interface{}, error) {
	gesture := harmonyGesture(deviceSn)
	if gesture == nil {
		return nil, nil
	}
	var err error
	switch api {
	case "touchDown":
		err = gesture.TouchDown(x, y)
	case "touchMove":
		err = gesture.TouchMove(x, y)
	case "touchUp":
		err = gesture.TouchUp(x, y)
	default:
		err = fmt.Errorf("unsupported gesture api: %s", api)
	}
	if err != nil {
		return NewErrorResponse(err), err
	}
	return NewSimpleSuccessResponse(), nil
}

// executeTouchCommand 执行触摸命令的通用函数
// 使用 uitest uiInput 命令替代 uinput
func executeTouchCommand(deviceSn string, args []string) (map[string]interface{}, error) {
	result, err := hdc.ExecuteHdc(append([]string{"-t", deviceSn, "shell", "uitest", "uiInput"}, args...))
	if err != nil {
		return NewErrorResponse(err), err
	}

	if !result.Success {
		return NewErrorResponseWithMsg(result.Error), nil
	}

	return NewSimpleSuccessResponse(), nil
}

// executeAndroidTouchCommand 执行 Android 触摸命令（备用，通过 ADB）
func executeAndroidTouchCommand(deviceSn string, args []string) (map[string]interface{}, error) {
	result, err := adb.ExecuteAdb(append([]string{"-s", deviceSn, "shell", "input"}, args...))
	if err != nil {
		return NewErrorResponse(err), err
	}

	if !result.Success {
		return NewErrorResponseWithMsg(result.Error), nil
	}

	return NewSimpleSuccessResponse(), nil
}

// getAndroidControlChannel 获取 Android 控制通道
func getAndroidControlChannel(deviceSn string) *scrcpy.ControlChannel {
	manager := scrcpy.GetManager()
	return manager.GetControlChannel(deviceSn)
}

// Click 点击事件
// HarmonyOS: 使用 uitest uiInput click
// Android: 使用 scrcpy 控制通道或 input tap
func (a *App) Click(deviceSn string, x int, y int) (map[string]interface{}, error) {
	platform := deviceManager.GetDevicePlatform(deviceSn)

	if platform == device.PlatformAndroid {
		control := getAndroidControlChannel(deviceSn)
		if control != nil {
			if err := control.SendTouchEvent(scrcpy.ActionDown, x, y, 1.0); err != nil {
				return NewErrorResponse(err), err
			}
			if err := control.SendTouchEvent(scrcpy.ActionUp, x, y, 1.0); err != nil {
				return NewErrorResponse(err), err
			}
			return NewSimpleSuccessResponse(), nil
		}
		return executeAndroidTouchCommand(deviceSn, []string{"tap", fmt.Sprintf("%d", x), fmt.Sprintf("%d", y)})
	}

	if gesture := harmonyGesture(deviceSn); gesture != nil {
		if err := gesture.TouchDown(x, y); err != nil {
			return NewErrorResponse(err), err
		}
		if err := gesture.TouchUp(x, y); err != nil {
			return NewErrorResponse(err), err
		}
		return NewSimpleSuccessResponse(), nil
	}
	return executeTouchCommand(deviceSn, []string{"click", fmt.Sprintf("%d", x), fmt.Sprintf("%d", y)})
}

// TouchDown 触摸按下事件
// HarmonyOS: 使用 uitest uiInput longClick 模拟按下
// Android: 使用 scrcpy 控制通道发送 DOWN 事件
func (a *App) TouchDown(deviceSn string, x int, y int) (map[string]interface{}, error) {
	platform := deviceManager.GetDevicePlatform(deviceSn)

	if platform == device.PlatformAndroid {
		control := getAndroidControlChannel(deviceSn)
		if control != nil {
			if err := control.SendTouchEvent(scrcpy.ActionDown, x, y, 1.0); err != nil {
				return NewErrorResponse(err), err
			}
			return NewSimpleSuccessResponse(), nil
		}
		return executeAndroidTouchCommand(deviceSn, []string{"swipe", fmt.Sprintf("%d", x), fmt.Sprintf("%d", y), fmt.Sprintf("%d", x), fmt.Sprintf("%d", y), "1000"})
	}

	if result, err := executeHarmonyGesture(deviceSn, "touchDown", x, y); result != nil {
		return result, err
	}
	return executeTouchCommand(deviceSn, []string{"longClick", fmt.Sprintf("%d", x), fmt.Sprintf("%d", y)})
}

// TouchMove 触摸移动事件
func (a *App) TouchMove(deviceSn string, x int, y int) (map[string]interface{}, error) {
	platform := deviceManager.GetDevicePlatform(deviceSn)

	if platform == device.PlatformAndroid {
		control := getAndroidControlChannel(deviceSn)
		if control != nil {
			if err := control.SendTouchEvent(scrcpy.ActionMove, x, y, 1.0); err != nil {
				return NewErrorResponse(err), err
			}
			return NewSimpleSuccessResponse(), nil
		}
		return NewSimpleSuccessResponse(), nil
	}

	if result, err := executeHarmonyGesture(deviceSn, "touchMove", x, y); result != nil {
		return result, err
	}
	startX := x
	startY := y
	if x > 2 {
		startX = x - 2
	}
	if y > 2 {
		startY = y - 2
	}
	return executeTouchCommand(deviceSn, []string{
		"swipe",
		fmt.Sprintf("%d", startX),
		fmt.Sprintf("%d", startY),
		fmt.Sprintf("%d", x),
		fmt.Sprintf("%d", y),
		"200",
	})
}

// TouchUp 触摸抬起事件
func (a *App) TouchUp(deviceSn string, x int, y int) (map[string]interface{}, error) {
	platform := deviceManager.GetDevicePlatform(deviceSn)

	if platform == device.PlatformAndroid {
		control := getAndroidControlChannel(deviceSn)
		if control != nil {
			if err := control.SendTouchEvent(scrcpy.ActionUp, x, y, 1.0); err != nil {
				return NewErrorResponse(err), err
			}
			return NewSimpleSuccessResponse(), nil
		}
		return NewSimpleSuccessResponse(), nil
	}

	if result, err := executeHarmonyGesture(deviceSn, "touchUp", x, y); result != nil {
		return result, err
	}
	return executeTouchCommand(deviceSn, []string{"click", fmt.Sprintf("%d", x), fmt.Sprintf("%d", y)})
}

// TouchMoveFromTo 触摸从起点移动到终点
// HarmonyOS: 使用 uitest uiInput swipe
// Android: 使用 scrcpy 控制通道或 input swipe
func (a *App) TouchMoveFromTo(deviceSn string, startX int, startY int, endX int, endY int, smoothTime int) (map[string]interface{}, error) {
	platform := deviceManager.GetDevicePlatform(deviceSn)

	if platform == device.PlatformAndroid {
		control := getAndroidControlChannel(deviceSn)
		if control != nil {
			if err := control.SendTouchEvent(scrcpy.ActionDown, startX, startY, 1.0); err != nil {
				return NewErrorResponse(err), err
			}
			if err := control.SendTouchEvent(scrcpy.ActionMove, endX, endY, 1.0); err != nil {
				return NewErrorResponse(err), err
			}
			if err := control.SendTouchEvent(scrcpy.ActionUp, endX, endY, 1.0); err != nil {
				return NewErrorResponse(err), err
			}
			return NewSimpleSuccessResponse(), nil
		}

		duration := smoothTime
		if duration <= 0 {
			duration = 300
		}
		if duration > 10000 {
			duration = 10000
		}
		return executeAndroidTouchCommand(deviceSn, []string{
			"swipe",
			fmt.Sprintf("%d", startX),
			fmt.Sprintf("%d", startY),
			fmt.Sprintf("%d", endX),
			fmt.Sprintf("%d", endY),
			fmt.Sprintf("%d", duration),
		})
	}

	if gesture := harmonyGesture(deviceSn); gesture != nil {
		if err := gesture.TouchDown(startX, startY); err != nil {
			return NewErrorResponse(err), err
		}
		if err := gesture.TouchMove(endX, endY); err != nil {
			return NewErrorResponse(err), err
		}
		if err := gesture.TouchUp(endX, endY); err != nil {
			return NewErrorResponse(err), err
		}
		return NewSimpleSuccessResponse(), nil
	}

	velocity := 600
	if smoothTime > 0 {
		velocity = 40000 - (smoothTime-1)*(40000-200)/(15000-1)
		if velocity < 200 {
			velocity = 200
		}
		if velocity > 40000 {
			velocity = 40000
		}
	}
	return executeTouchCommand(deviceSn, []string{
		"swipe",
		fmt.Sprintf("%d", startX),
		fmt.Sprintf("%d", startY),
		fmt.Sprintf("%d", endX),
		fmt.Sprintf("%d", endY),
		fmt.Sprintf("%d", velocity),
	})
}

// Scroll 滚动事件
// HarmonyOS: 使用 uitest uiInput scroll (暂不支持，使用 swipe 模拟)
// Android: 使用 scrcpy 控制通道 SendScrollEvent
func (a *App) Scroll(deviceSn string, x int, y int, hscroll int, vscroll int) (map[string]interface{}, error) {
	platform := deviceManager.GetDevicePlatform(deviceSn)

	if platform == device.PlatformAndroid {
		control := getAndroidControlChannel(deviceSn)
		if control != nil {
			hscrollFloat := float32(hscroll) * 0.5
			vscrollFloat := float32(vscroll) * 0.5
			if err := control.SendScrollEvent(x, y, hscrollFloat, vscrollFloat); err != nil {
				return NewErrorResponse(err), err
			}
			return NewSimpleSuccessResponse(), nil
		}
		return executeAndroidTouchCommand(deviceSn, []string{
			"swipe",
			fmt.Sprintf("%d", x),
			fmt.Sprintf("%d", y+100),
			fmt.Sprintf("%d", x),
			fmt.Sprintf("%d", y-100),
			"300",
		})
	}

	return executeTouchCommand(deviceSn, []string{
		"scroll",
		fmt.Sprintf("%d", x),
		fmt.Sprintf("%d", y),
		fmt.Sprintf("%d", hscroll*200),
		fmt.Sprintf("%d", -vscroll*200),
	})
}
