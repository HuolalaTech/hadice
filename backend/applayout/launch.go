package applayout

import (
	"fmt"
	"strings"
	"time"

	"Hadice/backend/adb"
	"Hadice/backend/device"
	"Hadice/backend/hdc"
)

const settleDelay = 1500 * time.Millisecond

func startPage(connectKey, platform, packageName, pageName string) error {
	packageName = strings.TrimSpace(packageName)
	pageName = strings.TrimSpace(pageName)
	if packageName == "" || pageName == "" {
		return fmt.Errorf("包名与页面名不能为空")
	}

	switch platform {
	case string(device.PlatformAndroid):
		return startAndroidActivity(connectKey, packageName, pageName)
	default:
		return startHarmonyAbility(connectKey, packageName, pageName)
	}
}

func startHarmonyAbility(connectKey, bundleName, abilityName string) error {
	result, err := hdc.ExecuteHdcWithTimeout(
		[]string{"-t", connectKey, "shell", "aa", "start", "-a", abilityName, "-b", bundleName},
		20*time.Second,
	)
	if err != nil {
		return fmt.Errorf("启动 Ability 失败: %w", err)
	}
	if result != nil && containsLaunchError(result.Output+result.Error) {
		msg := result.Output
		if msg == "" {
			msg = result.Error
		}
		return fmt.Errorf("启动 Ability 失败: %s", strings.TrimSpace(msg))
	}
	time.Sleep(settleDelay)
	return nil
}

func startAndroidActivity(connectKey, packageName, activityName string) error {
	component := activityName
	if !strings.Contains(activityName, "/") {
		if strings.HasPrefix(activityName, ".") {
			component = packageName + "/" + activityName
		} else if strings.HasPrefix(activityName, packageName) {
			component = packageName + "/" + activityName
		} else {
			component = packageName + "/" + activityName
		}
	}

	result, err := adb.ExecuteAdbWithTimeout(
		[]string{"-s", connectKey, "shell", "am", "start", "-n", component},
		20*time.Second,
	)
	if err != nil {
		return fmt.Errorf("启动 Activity 失败: %w", err)
	}
	if result != nil && containsLaunchError(result.Output+result.Error) {
		msg := result.Output
		if msg == "" {
			msg = result.Error
		}
		return fmt.Errorf("启动 Activity 失败: %s", strings.TrimSpace(msg))
	}
	time.Sleep(settleDelay)
	return nil
}

func containsLaunchError(s string) bool {
	lower := strings.ToLower(s)
	// am start 成功输出是 "Starting: Intent..."，不含下列关键词
	for _, key := range []string{
		"error:",
		"exception:",
		"not found",
		"does not exist",
		"unable to resolve",
		"permission denial",
		"error code",
		"fail to start",
		"failed to start",
	} {
		if strings.Contains(lower, key) {
			return true
		}
	}
	return false
}
