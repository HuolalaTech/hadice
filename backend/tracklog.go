package backend

import (
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"Hadice/backend/android"
	"Hadice/backend/device"
	"Hadice/backend/hdc"

	"github.com/gorilla/websocket"
	"github.com/wailsapp/wails/v3/pkg/application"
)

const (
	trackLogDefaultPort = 8888
	trackLogMaxEvents   = 5000
	trackLogEventName   = "trackLog:received"
	trackLogStatusName  = "trackLog:status"
	trackLogSnapshotName = "trackLog:snapshot"
)

var trackLogUpgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

// TrackLogEvent 一条埋点（左 event / 右 JSON）
type TrackLogEvent struct {
	ID         string `json:"id"`
	Event      string `json:"event"`
	JSON       string `json:"json"`
	Timestamp  int64  `json:"timestamp"`
	PushSign   string `json:"pushSign,omitempty"`
	PushClient string `json:"pushClient,omitempty"`
}

type TrackLogStatus struct {
	Running     bool   `json:"running"`
	Port        int    `json:"port"`
	HostHint    string `json:"hostHint"`
	DeviceID    string `json:"deviceId,omitempty"`
	ClientCount int    `json:"clientCount"`
	EventCount  int    `json:"eventCount"`
	Received    int    `json:"received,omitempty"`
	Parsed      int    `json:"parsed,omitempty"`
	Error       string `json:"error,omitempty"`
}

type trackLogServer struct {
	mu        sync.Mutex
	httpSrv   *http.Server
	listener  net.Listener
	running   bool
	port      int
	deviceID  string
	clients   int
	conns     map[*websocket.Conn]struct{}
	events    []TrackLogEvent
	seenIDs   map[string]int // id → index in events
	received  int
	parsed    int
	startedAt time.Time
	snapTimer *time.Timer
}

var trackLog = &trackLogServer{
	port:    trackLogDefaultPort,
	seenIDs: make(map[string]int),
	conns:   make(map[*websocket.Conn]struct{}),
}

func (s *trackLogServer) snapshot() TrackLogStatus {
	s.mu.Lock()
	defer s.mu.Unlock()
	return TrackLogStatus{
		Running:     s.running,
		Port:        s.port,
		HostHint:    fmt.Sprintf("127.0.0.1:%d", s.port),
		DeviceID:    s.deviceID,
		ClientCount: s.clients,
		EventCount:  len(s.events),
		Received:    s.received,
		Parsed:      s.parsed,
	}
}

func (s *trackLogServer) listEvents() []TrackLogEvent {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]TrackLogEvent, len(s.events))
	copy(out, s.events)
	return out
}

func (s *trackLogServer) emitStatus(errMsg string) {
	st := s.snapshot()
	st.Error = errMsg
	if app := application.Get(); app != nil {
		app.Event.Emit(trackLogStatusName, map[string]any{
			"running":     st.Running,
			"port":        st.Port,
			"hostHint":    st.HostHint,
			"deviceId":    st.DeviceID,
			"clientCount": st.ClientCount,
			"eventCount":  st.EventCount,
			"received":    st.Received,
			"parsed":      st.Parsed,
			"error":       st.Error,
		})
	}
}

func eventToMap(ev TrackLogEvent) map[string]any {
	return map[string]any{
		"id":         ev.ID,
		"event":      ev.Event,
		"json":       ev.JSON,
		"timestamp":  ev.Timestamp,
		"pushSign":   ev.PushSign,
		"pushClient": ev.PushClient,
	}
}

// emitSnapshotSoon 防抖全量快照，避免个人中心连发 20 条时 Wails 单条 Emit 丢前端。
func (s *trackLogServer) emitSnapshotSoon() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.snapTimer != nil {
		s.snapTimer.Stop()
	}
	s.snapTimer = time.AfterFunc(20*time.Millisecond, s.emitSnapshot)
}

func (s *trackLogServer) emitSnapshot() {
	events := s.listEvents()
	rows := make([]map[string]any, len(events))
	for i, ev := range events {
		rows[i] = eventToMap(ev)
	}
	if app := application.Get(); app != nil {
		// ponytail: 不能直接 Emit []，EventsOn 会把 array data 展开成多参，前端收到空列表
		app.Event.Emit(trackLogSnapshotName, map[string]any{"events": rows})
	}
}

// isEmptyTrackJSON：无载荷 / {} / 美化后的空对象，都算空（response 合并时别被空包盖住）。
func isEmptyTrackJSON(s string) bool {
	t := strings.TrimSpace(s)
	if t == "" || t == "{}" || t == "[]" || t == "null" {
		return true
	}
	var b strings.Builder
	b.Grow(len(t))
	for _, r := range t {
		if r == ' ' || r == '\n' || r == '\r' || r == '\t' {
			continue
		}
		b.WriteRune(r)
	}
	compact := b.String()
	return compact == "{}" || compact == "[]" || compact == "null"
}

func jsonRicher(next, prev string) bool {
	if isEmptyTrackJSON(next) {
		return false
	}
	if isEmptyTrackJSON(prev) {
		return true
	}
	return len(strings.TrimSpace(next)) > len(strings.TrimSpace(prev))
}

// upsertEvent 同 request_id：request/response 合并成一条；body 取更完整的。
func (s *trackLogServer) upsertEvent(ev TrackLogEvent) (created bool) {
	s.mu.Lock()
	if ev.ID != "" {
		if idx, ok := s.seenIDs[ev.ID]; ok && idx >= 0 && idx < len(s.events) {
			cur := s.events[idx]
			changed := false
			if jsonRicher(ev.JSON, cur.JSON) {
				cur.JSON = ev.JSON
				changed = true
			}
			if cur.Event == "" || cur.Event == "(unknown)" {
				cur.Event = ev.Event
				changed = true
			}
			s.events[idx] = cur
			out := cur
			s.mu.Unlock()
			if changed {
				// 合并补全后也发单条，避免只靠防抖快照时前端仍停在 {}
				if app := application.Get(); app != nil {
					app.Event.Emit(trackLogEventName, eventToMap(out))
				}
				s.emitSnapshotSoon()
			}
			return false
		}
	}

	s.events = append(s.events, ev)
	if ev.ID != "" {
		s.seenIDs[ev.ID] = len(s.events) - 1
	}
	for len(s.events) > trackLogMaxEvents {
		dropped := s.events[0]
		s.events = s.events[1:]
		if dropped.ID != "" {
			delete(s.seenIDs, dropped.ID)
		}
		for id, idx := range s.seenIDs {
			s.seenIDs[id] = idx - 1
		}
	}
	created = true
	s.mu.Unlock()

	if app := application.Get(); app != nil {
		app.Event.Emit(trackLogEventName, eventToMap(ev))
	}
	s.emitSnapshotSoon()
	return true
}

func (s *trackLogServer) clear() {
	s.mu.Lock()
	s.events = nil
	s.seenIDs = make(map[string]int)
	s.received = 0
	s.parsed = 0
	s.mu.Unlock()
	s.emitSnapshotSoon()
}

// normalizeTrackLogPort：非法端口回落默认 8888。
func normalizeTrackLogPort(port int) int {
	if port < 1 || port > 65535 {
		return trackLogDefaultPort
	}
	return port
}

func (s *trackLogServer) listenPort() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return normalizeTrackLogPort(s.port)
}

func (s *trackLogServer) start(deviceID string, port int) error {
	port = normalizeTrackLogPort(port)
	s.mu.Lock()
	if s.running {
		s.deviceID = deviceID
		s.mu.Unlock()
		return nil
	}
	s.mu.Unlock()

	mux := http.NewServeMux()
	mux.HandleFunc("/ws/log", s.handleWS)
	mux.HandleFunc("/ws/log/", s.handleWS)

	// ponytail: 占 :port 全接口，避免本机其它工具同端口并存抢包
	ln, err := net.Listen("tcp", fmt.Sprintf(":%d", port))
	if err != nil {
		if isAddrInUse(err) {
			return fmt.Errorf("本机 %d 已被占用（其它埋点/日志工具），请先关掉占用进程或换端口再点开始监听", port)
		}
		return fmt.Errorf("listen :%d: %w", port, err)
	}

	srv := &http.Server{Handler: mux}
	s.mu.Lock()
	s.httpSrv = srv
	s.listener = ln
	s.running = true
	s.port = port
	s.deviceID = deviceID
	s.startedAt = time.Now()
	s.mu.Unlock()

	go func() {
		if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
			log.Printf("[TrackLog] serve: %v", err)
			s.mu.Lock()
			s.running = false
			s.mu.Unlock()
			s.emitStatus(err.Error())
		}
	}()

	log.Printf("[TrackLog] listening ws://127.0.0.1:%d/ws/log", port)
	s.emitStatus("")
	return nil
}

func (s *trackLogServer) stop() {
	s.mu.Lock()
	srv := s.httpSrv
	ln := s.listener
	if s.snapTimer != nil {
		s.snapTimer.Stop()
		s.snapTimer = nil
	}
	s.httpSrv = nil
	s.listener = nil
	s.running = false
	s.deviceID = ""
	s.clients = 0
	s.mu.Unlock()

	if srv != nil {
		_ = srv.Close()
	}
	if ln != nil {
		_ = ln.Close()
	}
	s.emitStatus("")
}

func (s *trackLogServer) dropClients() {
	s.mu.Lock()
	conns := make([]*websocket.Conn, 0, len(s.conns))
	for c := range s.conns {
		conns = append(conns, c)
	}
	s.conns = make(map[*websocket.Conn]struct{})
	s.clients = 0
	s.mu.Unlock()
	for _, c := range conns {
		_ = c.Close()
	}
}

func (s *trackLogServer) handleWS(w http.ResponseWriter, r *http.Request) {
	conn, err := trackLogUpgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[TrackLog] upgrade: %v", err)
		return
	}
	defer conn.Close()

	s.mu.Lock()
	if s.conns == nil {
		s.conns = make(map[*websocket.Conn]struct{})
	}
	s.conns[conn] = struct{}{}
	s.clients++
	clients := s.clients
	bound := s.deviceID
	s.mu.Unlock()
	log.Printf("[TrackLog] client connected, total=%d bound=%s", clients, bound)
	s.emitStatus("")
	defer func() {
		s.mu.Lock()
		delete(s.conns, conn)
		if s.clients > 0 {
			s.clients--
		}
		left := s.clients
		s.mu.Unlock()
		log.Printf("[TrackLog] client disconnected, total=%d", left)
		s.emitStatus("")
	}()

	conn.SetReadLimit(2 << 20)
	_ = conn.SetReadDeadline(time.Now().Add(90 * time.Second))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(90 * time.Second))
	})

	for {
		_, payload, err := conn.ReadMessage()
		if err != nil {
			return
		}
		_ = conn.SetReadDeadline(time.Now().Add(90 * time.Second))
		s.mu.Lock()
		s.received++
		recv := s.received
		s.mu.Unlock()
		if ev, ok := parseTrackLogPayload(payload); ok {
			s.mu.Lock()
			s.parsed++
			s.mu.Unlock()
			s.upsertEvent(*ev)
		} else if recv <= 20 || recv%50 == 0 {
			preview := string(payload)
			if len(preview) > 160 {
				preview = preview[:160] + "…"
			}
			log.Printf("[TrackLog] skip non-track (#%d): %s", recv, preview)
		}
	}
}

type trackPushEnvelope struct {
	PushType   string `json:"push_type"`
	PushSign   string `json:"push_sign"`
	PushClient string `json:"push_client"`
	PushData   struct {
		LogType string `json:"log_type"`
		LogData struct {
			RequestID string          `json:"request_id"`
			URL       string          `json:"url"`
			Method    string          `json:"method"`
			Data      json.RawMessage `json:"data"`
		} `json:"log_data"`
	} `json:"push_data"`
}

func isTrackMirrorMethod(method, rawURL string) bool {
	if strings.ToUpper(strings.TrimSpace(method)) == "TRACK" {
		return true
	}
	u := strings.TrimSpace(rawURL)
	if u == "" {
		return false
	}
	// 仅兼容旧镜像伪 host；勿把业务接口 ?_m=xxx 当成埋点（鸿蒙 Axios 旁路会推真实 GET/POST）
	if strings.Contains(u, "sensors.track.local") {
		return true
	}
	return false
}

func extractTrackEventKey(rawURL string) string {
	s := strings.TrimSpace(rawURL)
	if s == "" {
		return "(unknown)"
	}
	if strings.Contains(s, "_m=") {
		if u, err := url.Parse(s); err == nil {
			if m := u.Query().Get("_m"); m != "" {
				return m
			}
		}
		if i := strings.Index(s, "_m="); i >= 0 {
			rest := s[i+3:]
			if j := strings.IndexAny(rest, "&#"); j >= 0 {
				rest = rest[:j]
			}
			if rest != "" {
				if dec, err := url.QueryUnescape(rest); err == nil {
					return dec
				}
				return rest
			}
		}
	}
	if !strings.HasPrefix(s, "http://") && !strings.HasPrefix(s, "https://") {
		return s
	}
	return s
}

// parseTrackLogPayload：method=TRACK 或旧 sensors.track.local；同 request_id 合并。
func parseTrackLogPayload(raw []byte) (*TrackLogEvent, bool) {
	text := strings.TrimSpace(string(raw))
	if text == "" || text == "ping" || text == "bye" {
		return nil, false
	}

	var env trackPushEnvelope
	if err := json.Unmarshal([]byte(text), &env); err != nil {
		return nil, false
	}
	if env.PushType != "network" {
		return nil, false
	}
	method := env.PushData.LogData.Method
	rawURL := env.PushData.LogData.URL
	if !isTrackMirrorMethod(method, rawURL) {
		return nil, false
	}

	eventName := extractTrackEventKey(rawURL)
	body := normalizeTrackJSON(env.PushData.LogData.Data)
	if eventName == "(unknown)" || eventName == rawURL {
		if name := eventNameFromBody(body); name != "" {
			eventName = name
		}
	}

	id := strings.TrimSpace(env.PushData.LogData.RequestID)
	if id == "" {
		id = fmt.Sprintf("%s#%d", eventName, time.Now().UnixNano())
	}

	// data 空但 url 有 event：仍入库（等 response 合并）；打日志便于对照 APP 镜像
	if isEmptyTrackJSON(body) {
		preview := text
		if len(preview) > 240 {
			preview = preview[:240] + "…"
		}
		log.Printf("[TrackLog] empty data event=%s id=%s log_type=%s preview=%s",
			eventName, id, env.PushData.LogType, preview)
	}

	return &TrackLogEvent{
		ID:         id,
		Event:      eventName,
		JSON:       body,
		Timestamp:  time.Now().UnixMilli(),
		PushSign:   env.PushSign,
		PushClient: env.PushClient,
	}, true
}

func eventNameFromBody(body string) string {
	var obj struct {
		Event string `json:"event"`
	}
	if err := json.Unmarshal([]byte(body), &obj); err != nil {
		return ""
	}
	return strings.TrimSpace(obj.Event)
}

func normalizeTrackJSON(raw json.RawMessage) string {
	if len(raw) == 0 {
		return "{}"
	}
	var asString string
	if err := json.Unmarshal(raw, &asString); err == nil {
		trimmed := strings.TrimSpace(asString)
		if trimmed == "" {
			return "{}"
		}
		if json.Valid([]byte(trimmed)) {
			return prettyJSON(trimmed)
		}
		return trimmed
	}
	if json.Valid(raw) {
		return prettyJSON(string(raw))
	}
	return string(raw)
}

func prettyJSON(s string) string {
	var v any
	if err := json.Unmarshal([]byte(s), &v); err != nil {
		return s
	}
	out, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return s
	}
	return string(out)
}

func isAddrInUse(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "address already in use") || strings.Contains(msg, "bind: address already in use")
}

func trackLogDevicePlatform(deviceId string) device.Platform {
	if deviceManager == nil || deviceId == "" {
		return ""
	}
	return deviceManager.GetDevicePlatform(deviceId)
}

func resolveTrackLogPlatform(deviceId string) device.Platform {
	if p := trackLogDevicePlatform(deviceId); p != "" {
		return p
	}
	// 缓存未命中时用 adb 属性兜底，避免安卓误走 hdc rport
	if deviceId != "" && android.IsAndroidDevice(deviceId) {
		return device.PlatformAndroid
	}
	return device.PlatformHarmonyOS
}

func removeTrackLogForwardForPlatform(deviceId string, platform device.Platform, port int) {
	if deviceId == "" {
		return
	}
	port = normalizeTrackLogPort(port)
	switch platform {
	case device.PlatformAndroid:
		_ = android.RemoveReversePortForward(deviceId, port)
	default:
		spec := fmt.Sprintf("tcp:%d", port)
		_, _ = hdc.ExecuteHdc([]string{"-t", deviceId, "fport", "rm", spec, spec})
		_, _ = hdc.ExecuteHdc([]string{"-t", deviceId, "rport", "rm", spec, spec})
	}
}

// clearOtherTrackLogForwards 当前端口只能绑一台机：清掉其它设备上残留的 reverse/rport。
func clearOtherTrackLogForwards(keepDeviceId string, port int) {
	if deviceManager == nil {
		return
	}
	port = normalizeTrackLogPort(port)
	devices, err := deviceManager.ListAllDevices(false)
	if err != nil {
		log.Printf("[TrackLog] list devices for exclusive forward: %v", err)
		return
	}
	for _, d := range devices {
		if d.ConnectKey == "" || d.ConnectKey == keepDeviceId {
			continue
		}
		log.Printf("[TrackLog] drop forward on other device %s (%s)", d.ConnectKey, d.Platform)
		removeTrackLogForwardForPlatform(d.ConnectKey, d.Platform, port)
	}
}

// ensureTrackLogHdcRport 鸿蒙：设备 127.0.0.1:port → 电脑 port（必须带 -t）
func ensureTrackLogHdcRport(deviceId string, port int) error {
	if deviceId == "" {
		return fmt.Errorf("empty deviceId")
	}
	port = normalizeTrackLogPort(port)
	spec := fmt.Sprintf("tcp:%d", port)
	_, _ = hdc.ExecuteHdc([]string{"-t", deviceId, "fport", "rm", spec, spec})
	_, _ = hdc.ExecuteHdc([]string{"-t", deviceId, "rport", "rm", spec, spec})
	result, err := hdc.ExecuteHdc([]string{"-t", deviceId, "rport", spec, spec})
	if err != nil {
		return err
	}
	if result != nil && !result.Success {
		msg := result.Error
		if msg == "" {
			msg = result.Output
		}
		return fmt.Errorf("rport failed: %s", msg)
	}
	log.Printf("[TrackLog] hdc rport ok: -t %s %s %s", deviceId, spec, spec)
	return nil
}

// ensureTrackLogAdbReverse 安卓：adb reverse tcp:port tcp:port
func ensureTrackLogAdbReverse(deviceId string, port int) error {
	if deviceId == "" {
		return fmt.Errorf("empty deviceId")
	}
	port = normalizeTrackLogPort(port)
	_ = android.RemoveReversePortForward(deviceId, port)
	if err := android.SetupReversePortForwardWithVerify(deviceId, port); err != nil {
		return err
	}
	log.Printf("[TrackLog] adb reverse ok: -s %s tcp:%d", deviceId, port)
	return nil
}

func ensureTrackLogDeviceForward(deviceId string) error {
	port := trackLog.listenPort()
	clearOtherTrackLogForwards(deviceId, port)
	switch resolveTrackLogPlatform(deviceId) {
	case device.PlatformAndroid:
		return ensureTrackLogAdbReverse(deviceId, port)
	default:
		return ensureTrackLogHdcRport(deviceId, port)
	}
}

func removeTrackLogDeviceForward(deviceId string) {
	removeTrackLogForwardForPlatform(deviceId, resolveTrackLogPlatform(deviceId), trackLog.listenPort())
}

func trackLogForwardHint(deviceId string) string {
	port := trackLog.listenPort()
	switch resolveTrackLogPlatform(deviceId) {
	case device.PlatformAndroid:
		return fmt.Sprintf("adb -s %s reverse tcp:%d tcp:%d", deviceId, port, port)
	default:
		return fmt.Sprintf("hdc -t %s rport tcp:%d tcp:%d", deviceId, port, port)
	}
}

// StartTrackLogServer 启动本机 /ws/log，并独占绑定 deviceId 的端口反转。
// port<=0 时用默认 8888；已在监听时再次调用：忽略新 port，仅换绑/保活转发。
func (a *App) StartTrackLogServer(deviceId string, port int) (*TrackLogStatus, error) {
	before := trackLog.snapshot()
	deviceChanged := before.Running && before.DeviceID != "" && deviceId != "" && before.DeviceID != deviceId
	prev := before.DeviceID

	if err := trackLog.start(deviceId, port); err != nil {
		st := trackLog.snapshot()
		st.Error = err.Error()
		return &st, err
	}

	if deviceChanged {
		log.Printf("[TrackLog] rebound %s → %s, drop clients + clear", prev, deviceId)
		if prev != "" {
			removeTrackLogDeviceForward(prev)
		}
		trackLog.dropClients()
		trackLog.clear()
	}

	st := trackLog.snapshot()
	if deviceId != "" {
		if err := ensureTrackLogDeviceForward(deviceId); err != nil {
			log.Printf("[TrackLog] device forward failed: %v", err)
			st.Error = "本机已监听，但端口反转失败，可手动: " + trackLogForwardHint(deviceId)
			trackLog.emitStatus(st.Error)
		} else {
			trackLog.emitStatus("")
		}
	}
	trackLog.emitSnapshot()
	st = trackLog.snapshot()
	return &st, nil
}

// StopTrackLogServer 停止本机埋点接收；以服务端已绑定设备为准（UI 可能已切到别的机）。
func (a *App) StopTrackLogServer(deviceId string) (*TrackLogStatus, error) {
	port := trackLog.listenPort()
	bound := trackLog.snapshot().DeviceID
	if bound != "" {
		removeTrackLogDeviceForward(bound)
	}
	if deviceId != "" && deviceId != bound {
		removeTrackLogDeviceForward(deviceId)
	}
	clearOtherTrackLogForwards("", port)
	trackLog.dropClients()
	trackLog.stop()
	st := trackLog.snapshot()
	return &st, nil
}

// GetTrackLogStatus 当前监听状态；副作用：推一次全量快照给前端对齐。
func (a *App) GetTrackLogStatus() *TrackLogStatus {
	st := trackLog.snapshot()
	trackLog.emitSnapshot()
	return &st
}

// ClearTrackLogs 清空已收到的埋点。
func (a *App) ClearTrackLogs() {
	trackLog.clear()
}
