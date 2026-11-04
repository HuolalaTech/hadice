package backend

import (
	"strings"
	"testing"
)

func TestParseTrackLogPayload_RequestPair(t *testing.T) {
	raw := `{
		"push_type":"network",
		"push_sign":"dbg_abcd",
		"push_client":"dbg_harmony",
		"push_data":{
			"log_type":"request",
			"log_data":{
				"request_id":"page_view#k1_1",
				"url":"page_view",
				"method":"TRACK",
				"data":"{\"event\":\"page_view\",\"properties\":{\"page_id\":21}}"
			}
		}
	}`
	ev, ok := parseTrackLogPayload([]byte(raw))
	if !ok {
		t.Fatal("expected TRACK payload")
	}
	if ev.Event != "page_view" {
		t.Fatalf("event=%q", ev.Event)
	}
	if ev.ID != "page_view#k1_1" {
		t.Fatalf("id=%q", ev.ID)
	}
	if !strings.Contains(ev.JSON, "page_id") {
		t.Fatalf("json=%s", ev.JSON)
	}
}

func TestParseTrackLogPayload_IgnoresHTTP(t *testing.T) {
	raw := `{"push_type":"network","push_data":{"log_type":"request","log_data":{"method":"POST","url":"https://api.example.com/x"}}}`
	if _, ok := parseTrackLogPayload([]byte(raw)); ok {
		t.Fatal("HTTP should be ignored")
	}
}

func TestParseTrackLogPayload_IgnoresBusinessAPIWithMParam(t *testing.T) {
	// 鸿蒙业务接口 url 形如 ?_m=consignee_order_entrance，不是神策埋点
	raw := `{"push_type":"network","push_data":{"log_type":"request","log_data":{"request_id":"su1","method":"GET","url":"https://api.example.com/?_m=consignee_order_entrance&_a=index"}}}`
	if _, ok := parseTrackLogPayload([]byte(raw)); ok {
		t.Fatal("business API with _m= must not be treated as TRACK")
	}
}

func TestParseTrackLogPayload_ObjectData(t *testing.T) {
	raw := `{"push_type":"network","push_data":{"log_data":{"method":"TRACK","url":"home_expo","data":{"event":"home_expo","properties":{}}}}}`
	ev, ok := parseTrackLogPayload([]byte(raw))
	if !ok {
		t.Fatal("expected object data")
	}
	if ev.Event != "home_expo" {
		t.Fatalf("event=%q", ev.Event)
	}
	if !strings.Contains(ev.JSON, "home_expo") {
		t.Fatalf("json=%s", ev.JSON)
	}
}

func TestParseTrackLogPayload_LegacySensorsURL(t *testing.T) {
	raw := `{"push_type":"network","push_data":{"log_type":"request","log_data":{"request_id":"x1","method":"POST","url":"https://sensors.track.local/?_m=profile_open","data":"{\"event\":\"profile_open\",\"properties\":{\"a\":1}}"}}} `
	ev, ok := parseTrackLogPayload([]byte(raw))
	if !ok {
		t.Fatal("expected legacy sensors url")
	}
	if ev.Event != "profile_open" {
		t.Fatalf("event=%q", ev.Event)
	}
}

func TestUpsertEvent_MergesRequestResponse(t *testing.T) {
	s := &trackLogServer{seenIDs: make(map[string]int)}
	s.upsertEvent(TrackLogEvent{ID: "profile_open#1", Event: "profile_open", JSON: "{}"})
	s.upsertEvent(TrackLogEvent{ID: "profile_open#1", Event: "profile_open", JSON: `{"event":"profile_open","properties":{"x":1}}`})
	if len(s.events) != 1 {
		t.Fatalf("len=%d", len(s.events))
	}
	if !strings.Contains(s.events[0].JSON, `"x"`) {
		t.Fatalf("json=%s", s.events[0].JSON)
	}
}

func TestNormalizeTrackLogPort(t *testing.T) {
	if normalizeTrackLogPort(0) != 8888 || normalizeTrackLogPort(-1) != 8888 || normalizeTrackLogPort(70000) != 8888 {
		t.Fatal("invalid port should fall back to 8888")
	}
	if normalizeTrackLogPort(9999) != 9999 {
		t.Fatal("valid port kept")
	}
}

func TestIsEmptyTrackJSON(t *testing.T) {
	if !isEmptyTrackJSON("{}") || !isEmptyTrackJSON("{\n}") || !isEmptyTrackJSON("  \n  ") {
		t.Fatal("expected empty")
	}
	if isEmptyTrackJSON(`{"event":"a"}`) {
		t.Fatal("expected non-empty")
	}
}

func TestJsonRicher_PrettyEmptyDoesNotWin(t *testing.T) {
	rich := "{\n  \"event\": \"a\",\n  \"properties\": {\n    \"x\": 1\n  }\n}"
	prettyEmpty := "{\n}"
	if jsonRicher(prettyEmpty, rich) {
		t.Fatal("empty must not replace rich")
	}
	if !jsonRicher(rich, prettyEmpty) {
		t.Fatal("rich must replace empty")
	}
}
