package adb

import "testing"

// 冷启动 daemon 日志混入输出时，不得把 "*"/"List" 误报为设备
func TestParseDevicesColdStart(t *testing.T) {
	out := "* daemon not running; starting now at tcp:5037\n" +
		"* daemon started successfully\n" +
		"List of devices attached\n" +
		"M2002J9E\tdevice product:vangogh model:M2002J9E device:vangogh\n" +
		"emulator-5554\toffline\n"
	devices := parseDevices(out, true)
	if len(devices) != 2 {
		t.Fatalf("want 2 devices, got %d: %+v", len(devices), devices)
	}
	if devices[0].ConnectKey != "M2002J9E" || devices[0].Status != "Connected" || devices[0].Model != "M2002J9E" {
		t.Errorf("unexpected device[0]: %+v", devices[0])
	}
	if devices[1].ConnectKey != "emulator-5554" || devices[1].Status != "Offline" {
		t.Errorf("unexpected device[1]: %+v", devices[1])
	}
}

func TestParseDevicesNormal(t *testing.T) {
	devices := parseDevices("List of devices attached\nabc123 unauthorized\n", false)
	if len(devices) != 1 || devices[0].Status != "Unauthorized" {
		t.Fatalf("unexpected: %+v", devices)
	}
}
