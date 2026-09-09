package backend

import (
	"Hadice/backend/adb"
	"Hadice/backend/device"
	"Hadice/backend/hdc"
	"fmt"
	"os"
)

func (a *App) ExecuteHdcCommand(connectKey string, shellCommand string) (map[string]interface{}, error) {
	args := []string{"-t", connectKey, "shell", shellCommand}
	result, err := hdc.ExecuteHdc(args)

	if err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		}, err
	}

	return map[string]interface{}{
		"success": result.Success,
		"output":  result.Output,
		"error":   result.Error,
	}, nil
}

func (a *App) StartHilogStream(connectKey string, options map[string]interface{}) (*hdc.HdcResult, error) {
	var hilogOptions *hdc.HilogOptions
	if options != nil {
		hilogOptions = &hdc.HilogOptions{}
		if level, ok := options["level"].(string); ok {
			levelEnum := hdc.LogLevel(level)
			hilogOptions.Level = &levelEnum
		}
		if tag, ok := options["tag"].(string); ok {
			hilogOptions.Tag = tag
		}
		if domain, ok := options["domain"].(string); ok {
			hilogOptions.Domain = domain
		}
		if pid, ok := options["pid"].(string); ok {
			hilogOptions.Pid = pid
		} else if pidNum, ok := options["pid"].(float64); ok {
			hilogOptions.Pid = fmt.Sprintf("%d", int(pidNum))
		}
		if regex, ok := options["regex"].(string); ok {
			hilogOptions.Regex = regex
		}
	}

	err := hdc.StartHilogStream(connectKey, hilogOptions, func(entry *hdc.LogEntry, err error) {
		if a.app == nil {
			return
		}
		if err != nil {
			a.app.Event.Emit("hilog:error", map[string]interface{}{
				"connectKey": connectKey,
				"error":      err.Error(),
			})
		} else if entry != nil {
			a.app.Event.Emit("hilog:log", map[string]interface{}{
				"connectKey": connectKey,
				"entry": map[string]interface{}{
					"timestamp": entry.Timestamp,
					"time":      entry.Time,
					"pid":       entry.Pid,
					"tid":       entry.Tid,
					"level":     entry.Level,
					"tag":       entry.Tag,
					"message":   entry.Message,
					"raw":       entry.Raw,
				},
			})
		}
	})

	if err != nil {
		return &hdc.HdcResult{
			Success: false,
			Error:   err.Error(),
		}, err
	}

	return &hdc.HdcResult{
		Success: true,
	}, nil
}

func (a *App) StopHilogStream(connectKey string) (*hdc.HdcResult, error) {
	err := hdc.StopHilogStream(connectKey)
	if err != nil {
		return &hdc.HdcResult{
			Success: false,
			Error:   err.Error(),
		}, err
	}
	return &hdc.HdcResult{
		Success: true,
	}, nil
}

func (a *App) StopAllHilogStreams() (*hdc.HdcResult, error) {
	hdc.StopAllHilogStreams()
	return &hdc.HdcResult{
		Success: true,
	}, nil
}

func (a *App) StartLogcatStream(deviceId string, options map[string]interface{}) (*adb.AdbResult, error) {
	var logcatOptions *adb.LogcatOptions
	if options != nil {
		logcatOptions = &adb.LogcatOptions{}
		if level, ok := options["level"].(string); ok {
			levelEnum := adb.LogcatLogLevel(level)
			logcatOptions.Level = &levelEnum
		}
		if tag, ok := options["tag"].(string); ok {
			logcatOptions.Tag = tag
		}
		if pid, ok := options["pid"].(string); ok {
			logcatOptions.Pid = pid
		} else if pidNum, ok := options["pid"].(float64); ok {
			logcatOptions.Pid = fmt.Sprintf("%d", int(pidNum))
		}
		if regex, ok := options["regex"].(string); ok {
			logcatOptions.Regex = regex
		}
		if format, ok := options["format"].(string); ok {
			logcatOptions.Format = format
		}
	}

	err := adb.StartLogcatStream(deviceId, logcatOptions, func(entry *adb.LogcatEntry, err error) {
		if a.app == nil {
			return
		}
		if err != nil {
			a.app.Event.Emit("logcat:error", map[string]interface{}{
				"deviceId": deviceId,
				"error":    err.Error(),
			})
		} else if entry != nil {
			a.app.Event.Emit("logcat:log", map[string]interface{}{
				"deviceId": deviceId,
				"entry": map[string]interface{}{
					"timestamp": entry.Timestamp,
					"time":      entry.Time,
					"pid":       entry.Pid,
					"tid":       entry.Tid,
					"level":     entry.Level,
					"tag":       entry.Tag,
					"message":   entry.Message,
					"raw":       entry.Raw,
				},
			})
		}
	})

	if err != nil {
		return &adb.AdbResult{
			Success: false,
			Error:   err.Error(),
		}, err
	}

	return &adb.AdbResult{
		Success: true,
	}, nil
}

func (a *App) StopLogcatStream(deviceId string) (*adb.AdbResult, error) {
	err := adb.StopLogcatStream(deviceId)
	if err != nil {
		return &adb.AdbResult{
			Success: false,
			Error:   err.Error(),
		}, err
	}
	return &adb.AdbResult{
		Success: true,
	}, nil
}

func (a *App) StopAllLogcatStreams() (*adb.AdbResult, error) {
	adb.StopAllLogcatStreams()
	return &adb.AdbResult{
		Success: true,
	}, nil
}

func (a *App) StartLogStream(connectKey string, platform string, options map[string]interface{}) (map[string]interface{}, error) {
	// 如果前端没有传递 platform，尝试从缓存获取
	if platform == "" {
		platform = string(deviceManager.GetDevicePlatform(connectKey))
	}

	if platform == string(device.PlatformAndroid) {
		result, err := a.StartLogcatStream(connectKey, options)
		if err != nil {
			return map[string]interface{}{
				"success":  false,
				"error":    err.Error(),
				"platform": platform,
			}, err
		}
		return map[string]interface{}{
			"success":  result.Success,
			"error":    result.Error,
			"platform": platform,
		}, nil
	}

	result, err := a.StartHilogStream(connectKey, options)
	if err != nil {
		return map[string]interface{}{
			"success":  false,
			"error":    err.Error(),
			"platform": platform,
		}, err
	}
	return map[string]interface{}{
		"success":  result.Success,
		"error":    result.Error,
		"platform": platform,
	}, nil
}

func (a *App) StopLogStream(connectKey string, platform string) (map[string]interface{}, error) {
	// 如果前端没有传递 platform，尝试从缓存获取
	if platform == "" {
		platform = string(deviceManager.GetDevicePlatform(connectKey))
	}

	if platform == string(device.PlatformAndroid) {
		result, err := a.StopLogcatStream(connectKey)
		if err != nil {
			return map[string]interface{}{
				"success":  false,
				"error":    err.Error(),
				"platform": platform,
			}, err
		}
		return map[string]interface{}{
			"success":  result.Success,
			"error":    result.Error,
			"platform": platform,
		}, nil
	}

	result, err := a.StopHilogStream(connectKey)
	if err != nil {
		return map[string]interface{}{
			"success":  false,
			"error":    err.Error(),
			"platform": platform,
		}, err
	}
	return map[string]interface{}{
		"success":  result.Success,
		"error":    result.Error,
		"platform": platform,
	}, nil
}

func (a *App) SaveLogsToFile(content string, defaultFileName string) (map[string]interface{}, error) {
	if a.app == nil {
		return map[string]interface{}{
			"success": false,
			"error":   "应用实例不可用",
		}, nil
	}

	filePath, err := a.app.Dialog.SaveFile().
		SetMessage("保存日志").
		SetFilename(defaultFileName).
		AddFilter("文本文件", "*.txt").
		PromptForSingleSelection()

	if err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		}, err
	}

	if filePath == "" {
		return map[string]interface{}{
			"success": false,
			"error":   "用户取消",
		}, nil
	}

	err = os.WriteFile(filePath, []byte(content), 0644)
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		}, err
	}

	return map[string]interface{}{
		"success":  true,
		"filePath": filePath,
	}, nil
}
