package backend

import (
	"fmt"

	"Hadice/backend/adb"
	"Hadice/backend/device"
	"Hadice/backend/hdc"
	"Hadice/backend/scrcpy"
)

func executeKeyCommand(deviceSn string, args []string) (map[string]interface{}, error) {
	result, err := hdc.ExecuteHdc(append([]string{"-t", deviceSn, "shell", "uitest", "uiInput", "keyEvent"}, args...))
	if err != nil {
		return NewErrorResponse(err), err
	}

	if !result.Success {
		return NewErrorResponseWithMsg(result.Error), nil
	}

	return NewSimpleSuccessResponse(), nil
}

func executeAndroidKeyCommand(deviceSn string, keyCode int) (map[string]interface{}, error) {
	result, err := adb.ExecuteAdb([]string{"-s", deviceSn, "shell", "input", "keyevent", fmt.Sprintf("%d", keyCode)})
	if err != nil {
		return NewErrorResponse(err), err
	}

	if !result.Success {
		return NewErrorResponseWithMsg(result.Error), nil
	}

	return NewSimpleSuccessResponse(), nil
}

func executeKeyPressAndRelease(deviceSn string, keyCode int, keyName string) (map[string]interface{}, error) {
	platform := deviceManager.GetDevicePlatform(deviceSn)

	if platform == device.PlatformAndroid {
		control := getAndroidControlChannel(deviceSn)
		if control != nil {
			if err := control.SendKeyEvent(scrcpy.ActionDown, keyCode); err != nil {
				return NewErrorResponseWithMsg(fmt.Sprintf("按下%s失败: %v", keyName, err)), err
			}
			if err := control.SendKeyEvent(scrcpy.ActionUp, keyCode); err != nil {
				return NewErrorResponseWithMsg(fmt.Sprintf("释放%s失败: %v", keyName, err)), err
			}
			return NewSimpleSuccessResponse(), nil
		}
		return executeAndroidKeyCommand(deviceSn, keyCode)
	}

	result, err := hdc.ExecuteHdc([]string{
		"-t", deviceSn,
		"shell", "uitest", "uiInput", "keyEvent", fmt.Sprintf("%d", keyCode),
	})
	if err != nil {
		return NewErrorResponseWithMsg(fmt.Sprintf("按下%s失败: %v", keyName, err)), err
	}
	if !result.Success {
		return NewErrorResponseWithMsg(fmt.Sprintf("按下%s失败: %s", keyName, result.Error)), nil
	}

	return NewSimpleSuccessResponse(), nil
}

func harmonyToAndroidKeyCode(harmonyKeyCode int) int {
	switch harmonyKeyCode {
	case 1:
		return 3
	case 2:
		return 4
	case 16:
		return 24
	case 17:
		return 25
	case 18:
		return 26
	default:
		return harmonyKeyCode
	}
}

func (a *App) PressBack(deviceSn string) (map[string]interface{}, error) {
	platform := deviceManager.GetDevicePlatform(deviceSn)
	if platform == device.PlatformAndroid {
		control := getAndroidControlChannel(deviceSn)
		if control != nil {
			if err := control.SendKeyEvent(scrcpy.ActionDown, 4); err != nil {
				return NewErrorResponse(err), err
			}
			if err := control.SendKeyEvent(scrcpy.ActionUp, 4); err != nil {
				return NewErrorResponse(err), err
			}
			return NewSimpleSuccessResponse(), nil
		}
		return executeAndroidKeyCommand(deviceSn, 4)
	}
	return executeKeyPressAndRelease(deviceSn, 2, "返回键")
}

func (a *App) PressHome(deviceSn string) (map[string]interface{}, error) {
	platform := deviceManager.GetDevicePlatform(deviceSn)
	if platform == device.PlatformAndroid {
		control := getAndroidControlChannel(deviceSn)
		if control != nil {
			if err := control.SendKeyEvent(scrcpy.ActionDown, 3); err != nil {
				return NewErrorResponse(err), err
			}
			if err := control.SendKeyEvent(scrcpy.ActionUp, 3); err != nil {
				return NewErrorResponse(err), err
			}
			return NewSimpleSuccessResponse(), nil
		}
		return executeAndroidKeyCommand(deviceSn, 3)
	}
	return executeKeyPressAndRelease(deviceSn, 1, "Home键")
}

func (a *App) PressKey(deviceSn string, keyCode int) (map[string]interface{}, error) {
	platform := deviceManager.GetDevicePlatform(deviceSn)

	if platform == device.PlatformAndroid {
		androidKeyCode := harmonyToAndroidKeyCode(keyCode)
		control := getAndroidControlChannel(deviceSn)
		if control != nil {
			if err := control.SendKeyEvent(scrcpy.ActionDown, androidKeyCode); err != nil {
				return NewErrorResponse(err), err
			}
			if err := control.SendKeyEvent(scrcpy.ActionUp, androidKeyCode); err != nil {
				return NewErrorResponse(err), err
			}
			return NewSimpleSuccessResponse(), nil
		}
		return executeAndroidKeyCommand(deviceSn, androidKeyCode)
	}

	return executeKeyPressAndRelease(deviceSn, keyCode, fmt.Sprintf("按键%d", keyCode))
}
