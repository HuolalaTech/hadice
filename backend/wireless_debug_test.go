package backend

import (
	"reflect"
	"testing"

	"Hadice/backend/device"
)

func TestBuildWirelessDebugPlanAndroidConnectOnly(t *testing.T) {
	plan, err := buildWirelessDebugPlan(WirelessDebugRequest{
		Platform: "android",
		Address:  "192.168.1.20:5555",
	})
	if err != nil {
		t.Fatalf("buildWirelessDebugPlan returned error: %v", err)
	}
	if plan.Platform != device.PlatformAndroid {
		t.Fatalf("platform = %q, want %q", plan.Platform, device.PlatformAndroid)
	}
	if plan.ConnectKey != "192.168.1.20:5555" {
		t.Fatalf("connect key = %q", plan.ConnectKey)
	}
	if len(plan.PairArgs) != 0 {
		t.Fatalf("pair args = %#v, want empty", plan.PairArgs)
	}
	if !reflect.DeepEqual(plan.ConnectArgs, []string{"connect", "192.168.1.20:5555"}) {
		t.Fatalf("connect args = %#v", plan.ConnectArgs)
	}
}

func TestBuildWirelessDebugPlanHarmonyOS(t *testing.T) {
	plan, err := buildWirelessDebugPlan(WirelessDebugRequest{
		Platform: "harmonyos",
		Address:  "192.168.1.30:8710",
	})
	if err != nil {
		t.Fatalf("buildWirelessDebugPlan returned error: %v", err)
	}
	if plan.Platform != device.PlatformHarmonyOS {
		t.Fatalf("platform = %q, want %q", plan.Platform, device.PlatformHarmonyOS)
	}
	if plan.ConnectKey != "192.168.1.30:8710" {
		t.Fatalf("connect key = %q", plan.ConnectKey)
	}
	if !reflect.DeepEqual(plan.ConnectArgs, []string{"tconn", "192.168.1.30:8710"}) {
		t.Fatalf("connect args = %#v", plan.ConnectArgs)
	}
}

func TestBuildWirelessDebugPlanValidation(t *testing.T) {
	tests := []struct {
		name string
		req  WirelessDebugRequest
	}{
		{
			name: "android missing address",
			req:  WirelessDebugRequest{Platform: "android"},
		},
		{
			name: "android fullwidth colon",
			req:  WirelessDebugRequest{Platform: "android", Address: "192.168.1.50：36000"},
		},
		{
			name: "harmony missing address",
			req:  WirelessDebugRequest{Platform: "harmonyos"},
		},
		{
			name: "harmony fullwidth colon",
			req:  WirelessDebugRequest{Platform: "harmonyos", Address: "192.168.1.50：36000"},
		},
		{
			name: "unknown platform",
			req:  WirelessDebugRequest{Platform: "ios"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := buildWirelessDebugPlan(tt.req); err == nil {
				t.Fatalf("buildWirelessDebugPlan returned nil error")
			}
		})
	}
}
