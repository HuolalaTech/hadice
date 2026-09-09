package backend

import (
	"fmt"

	"Hadice/backend/android"
)

type PlatformRouter struct {
	app *App
}

func NewPlatformRouter(app *App) *PlatformRouter {
	return &PlatformRouter{app: app}
}

func (r *PlatformRouter) DetectPlatform(deviceID string) android.DevicePlatform {
	return android.DetectPlatform(deviceID)
}

func (r *PlatformRouter) IsAndroidDevice(deviceID string) bool {
	return android.IsAndroidDevice(deviceID)
}

func (r *PlatformRouter) StartCapture(deviceID string, params map[string]interface{}) error {
	platform := android.DetectPlatform(deviceID)

	switch platform {
	case android.PlatformAndroid:
		packageName, _ := params["packageName"].(string)
		pid, _ := params["pid"].(int)
		localPort, _ := params["localPort"].(int)
		if localPort == 0 {
			localPort = 6200
		}
		agentPath, _ := params["agentPath"].(string)

		r.app.stopCaptureServersByPort(localPort)

		emitEvent := func(eventName string, data interface{}) {
			if r.app.app != nil {
				r.app.app.Event.Emit(eventName, data)
			}
		}

		return android.StartAndroidCapture(android.CaptureConfig{
			DeviceID:    deviceID,
			PackageName: packageName,
			PID:         pid,
			LocalPort:   localPort,
			AgentPath:   agentPath,
			EmitEvent:   emitEvent,
		})

	case android.PlatformHarmonyOS:
		localPort, _ := params["localPort"].(int)
		devicePort, _ := params["devicePort"].(int)
		if localPort == 0 {
			localPort = 6100
		}
		if devicePort == 0 {
			devicePort = 35201
		}
		_, err := r.app.StartCaptureServer(deviceID, localPort, devicePort)
		return err

	default:
		return fmt.Errorf("unknown device platform: %s", deviceID)
	}
}

func (r *PlatformRouter) StopCapture(deviceID string, params map[string]interface{}) error {
	platform := android.DetectPlatform(deviceID)

	switch platform {
	case android.PlatformAndroid:
		packageName, _ := params["packageName"].(string)
		if packageName != "" {
			return android.StopAndroidCapture(deviceID, packageName)
		}
		return fmt.Errorf("packageName is required for Android device")

	case android.PlatformHarmonyOS:
		return r.app.StopCaptureServer(deviceID)

	default:
		return fmt.Errorf("unknown device platform: %s", deviceID)
	}
}

func (r *PlatformRouter) GetCaptureStatus(deviceID string, params map[string]interface{}) (map[string]interface{}, error) {
	platform := android.DetectPlatform(deviceID)

	switch platform {
	case android.PlatformAndroid:
		packageName, _ := params["packageName"].(string)
		return android.GetAndroidCaptureStatus(deviceID, packageName), nil

	case android.PlatformHarmonyOS:
		return r.app.GetCaptureServerStatus(deviceID)

	default:
		return map[string]interface{}{
			"isCapturing": false,
			"platform":    "unknown",
		}, nil
	}
}
