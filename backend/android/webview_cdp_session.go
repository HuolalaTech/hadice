package android

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"Hadice/backend/adb"
	"github.com/gorilla/websocket"
)

const (
	webViewDiscoveryInterval  = 2 * time.Second
	webViewSocketScanInterval = 30 * time.Second
	webViewCommandTimeout     = 5 * time.Second
	webViewMaxBodyBytes       = 1024 * 1024
)

type WebViewCDPSession struct {
	deviceID    string
	packageName string
	pid         int
	captureRun  string
	emitEvent   EventEmitFunc

	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup

	mockMu     sync.RWMutex
	mockConfig webViewMockConfig

	targetMu sync.Mutex
	targets  map[string]*webViewCDPTarget
}

type webViewCDPForward struct {
	socketName string
	localPort  int
}

type webViewCDPTarget struct {
	key       string
	socket    string
	targetID  string
	websocket string
	cancel    context.CancelFunc
	update    chan struct{}
}

type webViewTargetInfo struct {
	ID                   string `json:"id"`
	Type                 string `json:"type"`
	URL                  string `json:"url"`
	Title                string `json:"title"`
	WebSocketDebuggerURL string `json:"webSocketDebuggerUrl"`
}

type webViewMockConfig struct {
	Enabled bool              `json:"enabled"`
	Rules   []webViewMockRule `json:"rules"`
}

type webViewMockRule struct {
	ID             string                    `json:"id"`
	Name           string                    `json:"name"`
	Enabled        bool                      `json:"enabled"`
	ResponseMode   string                    `json:"responseMode"`
	MatchCondition webViewMockMatchCondition `json:"matchCondition"`
	ResponseConfig webViewMockResponseConfig `json:"responseConfig"`
}

type webViewMockMatchCondition struct {
	URLPattern  string            `json:"urlPattern"`
	URLRegex    *bool             `json:"urlRegex"`
	Method      string            `json:"method"`
	Headers     map[string]string `json:"headers"`
	BodyPattern string            `json:"bodyPattern"`
}

type webViewMockResponseConfig struct {
	StatusCode int               `json:"statusCode"`
	Headers    map[string]string `json:"headers"`
	Body       string            `json:"body"`
}

func StartWebViewCDPSession(config CaptureConfig, captureRunID string) *WebViewCDPSession {
	ctx, cancel := context.WithCancel(context.Background())
	session := &WebViewCDPSession{
		deviceID:    config.DeviceID,
		packageName: config.PackageName,
		pid:         config.PID,
		captureRun:  captureRunID,
		emitEvent:   config.EmitEvent,
		ctx:         ctx,
		cancel:      cancel,
		targets:     make(map[string]*webViewCDPTarget),
	}
	if config.MockConfig != nil {
		session.UpdateMockConfig(config.MockConfig())
	}
	session.wg.Add(1)
	go session.run()
	return session
}

func (s *WebViewCDPSession) Stop() {
	if s == nil {
		return
	}
	s.cancel()
	s.wg.Wait()
}

func (s *WebViewCDPSession) UpdateMockConfig(config interface{}) {
	if s == nil {
		return
	}

	var parsed webViewMockConfig
	if data, err := json.Marshal(config); err == nil {
		if err := json.Unmarshal(data, &parsed); err != nil {
			log.Printf("[WebViewCDP] Ignore invalid Mock config: %v", err)
		}
	}

	s.mockMu.Lock()
	s.mockConfig = parsed
	s.mockMu.Unlock()

	s.targetMu.Lock()
	for _, target := range s.targets {
		select {
		case target.update <- struct{}{}:
		default:
		}
	}
	s.targetMu.Unlock()
}

func (s *WebViewCDPSession) currentMockConfig() webViewMockConfig {
	s.mockMu.RLock()
	defer s.mockMu.RUnlock()
	return s.mockConfig
}

func (s *WebViewCDPSession) run() {
	defer s.wg.Done()

	forwards := make(map[string]*webViewCDPForward)
	ticker := time.NewTicker(webViewDiscoveryInterval)
	defer ticker.Stop()
	defer func() {
		s.targetMu.Lock()
		for _, target := range s.targets {
			target.cancel()
		}
		s.targets = make(map[string]*webViewCDPTarget)
		s.targetMu.Unlock()
		for _, forward := range forwards {
			if err := RemovePortForward(s.deviceID, forward.localPort); err != nil {
				log.Printf("[WebViewCDP] Remove forward tcp:%d failed: %v", forward.localPort, err)
			}
		}
	}()

	s.refresh(forwards)
	lastSocketScan := time.Now()
	for {
		select {
		case <-s.ctx.Done():
			return
		case <-ticker.C:
			if len(forwards) == 0 || time.Since(lastSocketScan) >= webViewSocketScanInterval {
				s.refresh(forwards)
				lastSocketScan = time.Now()
				continue
			}
			for _, forward := range forwards {
				s.refreshTargets(forward)
			}
		}
	}
}

func (s *WebViewCDPSession) refresh(forwards map[string]*webViewCDPForward) {
	socketNames, err := discoverWebViewDevToolsSockets(s.deviceID, s.pid)
	if err != nil {
		log.Printf("[WebViewCDP] Discover sockets failed: %v", err)
		return
	}

	activeSockets := make(map[string]bool, len(socketNames))
	for _, socketName := range socketNames {
		activeSockets[socketName] = true
		forward := forwards[socketName]
		if forward == nil {
			localPort, err := allocateLocalPort()
			if err != nil {
				log.Printf("[WebViewCDP] Allocate local port failed: %v", err)
				continue
			}
			if err := SetupPortForward(
				s.deviceID,
				fmt.Sprintf("tcp:%d", localPort),
				"localabstract:"+socketName,
			); err != nil {
				log.Printf("[WebViewCDP] Forward %s failed: %v", socketName, err)
				continue
			}
			forward = &webViewCDPForward{socketName: socketName, localPort: localPort}
			forwards[socketName] = forward
			log.Printf("[WebViewCDP] Forwarded %s to localhost:%d", socketName, localPort)
		}
		s.refreshTargets(forward)
	}

	for socketName, forward := range forwards {
		if activeSockets[socketName] {
			continue
		}
		s.cancelTargetsForSocket(socketName, nil)
		if err := RemovePortForward(s.deviceID, forward.localPort); err != nil {
			log.Printf("[WebViewCDP] Remove stale forward tcp:%d failed: %v", forward.localPort, err)
		}
		delete(forwards, socketName)
	}
}

func discoverWebViewDevToolsSockets(deviceID string, pid int) ([]string, error) {
	result, err := adb.ExecuteAdbWithTimeout(
		[]string{"-s", deviceID, "shell", "cat", "/proc/net/unix"},
		5*time.Second,
	)
	if err != nil {
		return nil, err
	}
	if result == nil || !result.Success {
		return nil, fmt.Errorf("adb: %s", result.Error)
	}

	pidText := strconv.Itoa(pid)
	seen := make(map[string]bool)
	var sockets []string
	for _, line := range strings.Split(result.Output, "\n") {
		fields := strings.Fields(line)
		if len(fields) == 0 {
			continue
		}
		socket := strings.TrimPrefix(fields[len(fields)-1], "@")
		if !strings.HasPrefix(socket, "webview_devtools_remote_") ||
			!strings.HasSuffix(socket, pidText) {
			continue
		}
		prefixLength := len(socket) - len(pidText)
		if prefixLength > 0 {
			previous := socket[prefixLength-1]
			if previous >= '0' && previous <= '9' {
				continue
			}
		}
		if !seen[socket] {
			seen[socket] = true
			sockets = append(sockets, socket)
		}
	}
	return sockets, nil
}

func allocateLocalPort() (int, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	port := listener.Addr().(*net.TCPAddr).Port
	if err := listener.Close(); err != nil {
		return 0, err
	}
	return port, nil
}

func (s *WebViewCDPSession) refreshTargets(forward *webViewCDPForward) {
	ctx, cancel := context.WithTimeout(s.ctx, 3*time.Second)
	defer cancel()

	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodGet,
		fmt.Sprintf("http://localhost:%d/json", forward.localPort),
		nil,
	)
	if err != nil {
		return
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return
	}
	defer response.Body.Close()

	var targets []webViewTargetInfo
	if err := json.NewDecoder(response.Body).Decode(&targets); err != nil {
		return
	}

	visible := make(map[string]bool)
	for _, targetInfo := range targets {
		if targetInfo.Type != "page" || targetInfo.ID == "" ||
			targetInfo.WebSocketDebuggerURL == "" {
			continue
		}
		key := forward.socketName + "\x00" + targetInfo.ID
		visible[key] = true

		s.targetMu.Lock()
		_, exists := s.targets[key]
		s.targetMu.Unlock()
		if exists {
			continue
		}

		targetURL := normalizeWebViewDebuggerURL(targetInfo.WebSocketDebuggerURL, forward.localPort)
		targetContext, targetCancel := context.WithCancel(s.ctx)
		target := &webViewCDPTarget{
			key:       key,
			socket:    forward.socketName,
			targetID:  targetInfo.ID,
			websocket: targetURL,
			cancel:    targetCancel,
			update:    make(chan struct{}, 1),
		}
		s.targetMu.Lock()
		if _, exists = s.targets[key]; !exists {
			s.targets[key] = target
		}
		s.targetMu.Unlock()
		if exists {
			targetCancel()
			continue
		}

		s.wg.Add(1)
		go func() {
			defer s.wg.Done()
			s.runTarget(targetContext, target)
			s.targetMu.Lock()
			if s.targets[target.key] == target {
				delete(s.targets, target.key)
			}
			s.targetMu.Unlock()
		}()
	}

	s.cancelTargetsForSocket(forward.socketName, visible)
}

func normalizeWebViewDebuggerURL(raw string, localPort int) string {
	parsed, err := url.Parse(raw)
	if err != nil {
		return raw
	}
	// Chromium 150+ validates the WebSocket Host. The discovery endpoint
	// advertises localhost; do not rewrite it to 127.0.0.1.
	parsed.Host = fmt.Sprintf("localhost:%d", localPort)
	return parsed.String()
}

func (s *WebViewCDPSession) cancelTargetsForSocket(socketName string, visible map[string]bool) {
	s.targetMu.Lock()
	defer s.targetMu.Unlock()
	for key, target := range s.targets {
		if target.socket != socketName {
			continue
		}
		if visible == nil || !visible[key] {
			target.cancel()
			delete(s.targets, key)
		}
	}
}

type cdpEnvelope struct {
	ID     int64           `json:"id,omitempty"`
	Method string          `json:"method,omitempty"`
	Params json.RawMessage `json:"params,omitempty"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  *cdpError       `json:"error,omitempty"`
}

type cdpError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type webViewCDPClient struct {
	conn      *websocket.Conn
	nextID    atomic.Int64
	writeMu   sync.Mutex
	pendingMu sync.Mutex
	pending   map[int64]chan cdpEnvelope
	events    chan cdpEnvelope
}

func newWebViewCDPClient(conn *websocket.Conn) *webViewCDPClient {
	return &webViewCDPClient{
		conn:    conn,
		pending: make(map[int64]chan cdpEnvelope),
		events:  make(chan cdpEnvelope, 1024),
	}
}

func (c *webViewCDPClient) readLoop(ctx context.Context) error {
	c.conn.SetReadLimit(16 * 1024 * 1024)
	for {
		var message cdpEnvelope
		if err := c.conn.ReadJSON(&message); err != nil {
			return err
		}
		if message.ID != 0 {
			c.pendingMu.Lock()
			waiter := c.pending[message.ID]
			if waiter != nil {
				delete(c.pending, message.ID)
			}
			c.pendingMu.Unlock()
			if waiter != nil {
				waiter <- message
			}
			continue
		}
		select {
		case c.events <- message:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

func (c *webViewCDPClient) call(ctx context.Context, method string, params interface{}) (json.RawMessage, error) {
	id := c.nextID.Add(1)
	waiter := make(chan cdpEnvelope, 1)
	c.pendingMu.Lock()
	c.pending[id] = waiter
	c.pendingMu.Unlock()

	c.writeMu.Lock()
	err := c.conn.WriteJSON(map[string]interface{}{
		"id":     id,
		"method": method,
		"params": params,
	})
	c.writeMu.Unlock()
	if err != nil {
		c.pendingMu.Lock()
		delete(c.pending, id)
		c.pendingMu.Unlock()
		return nil, err
	}

	select {
	case response := <-waiter:
		if response.Error != nil {
			return nil, fmt.Errorf("CDP %s: %d %s", method, response.Error.Code, response.Error.Message)
		}
		return response.Result, nil
	case <-ctx.Done():
		c.pendingMu.Lock()
		delete(c.pending, id)
		c.pendingMu.Unlock()
		return nil, ctx.Err()
	}
}

func (s *WebViewCDPSession) runTarget(ctx context.Context, target *webViewCDPTarget) {
	defer target.cancel()
	dialer := websocket.Dialer{HandshakeTimeout: 5 * time.Second}
	conn, _, err := dialer.DialContext(ctx, target.websocket, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	client := newWebViewCDPClient(conn)
	readDone := make(chan error, 1)
	go func() {
		readDone <- client.readLoop(ctx)
	}()

	if err := callCDPNoResult(ctx, client, "Network.enable", map[string]interface{}{
		"maxTotalBufferSize":    8 * webViewMaxBodyBytes,
		"maxResourceBufferSize": webViewMaxBodyBytes,
	}); err != nil {
		log.Printf("[WebViewCDP] Network.enable failed: %v", err)
		return
	}

	requests := make(map[string]*webViewCDPRequest)
	fetchEnabled := false
	fetchEnabled = s.applyFetchConfig(ctx, client, fetchEnabled)
	log.Printf("[WebViewCDP] Attached page target %s", target.targetID)

	for {
		select {
		case <-ctx.Done():
			return
		case err := <-readDone:
			if ctx.Err() == nil {
				log.Printf("[WebViewCDP] Target %s disconnected: %v", target.targetID, err)
			}
			return
		case <-target.update:
			fetchEnabled = s.applyFetchConfig(ctx, client, fetchEnabled)
		case event := <-client.events:
			s.handleCDPEvent(ctx, client, target, event, requests)
		}
	}
}

func callCDPNoResult(parent context.Context, client *webViewCDPClient, method string, params interface{}) error {
	ctx, cancel := context.WithTimeout(parent, webViewCommandTimeout)
	defer cancel()
	_, err := client.call(ctx, method, params)
	return err
}

func (s *WebViewCDPSession) applyFetchConfig(
	ctx context.Context,
	client *webViewCDPClient,
	wasEnabled bool,
) bool {
	shouldEnable := s.currentMockConfig().hasReplaceRules()
	if shouldEnable == wasEnabled {
		return wasEnabled
	}
	if shouldEnable {
		err := callCDPNoResult(ctx, client, "Fetch.enable", map[string]interface{}{
			"patterns": []map[string]string{{
				"urlPattern":   "*",
				"requestStage": "Request",
			}},
		})
		if err != nil {
			log.Printf("[WebViewCDP] Fetch.enable failed: %v", err)
			return false
		}
		return true
	}
	if err := callCDPNoResult(ctx, client, "Fetch.disable", map[string]interface{}{}); err != nil {
		log.Printf("[WebViewCDP] Fetch.disable failed: %v", err)
		return wasEnabled
	}
	return false
}

func (c webViewMockConfig) hasReplaceRules() bool {
	if !c.Enabled {
		return false
	}
	for _, rule := range c.Rules {
		if rule.Enabled && strings.EqualFold(rule.ResponseMode, "replace") {
			return true
		}
	}
	return false
}

type webViewCDPRequest struct {
	UID             string
	Timestamp       int64
	Method          string
	URL             string
	RequestHeaders  map[string]string
	RequestBody     string
	StatusCode      int
	ResponseHeaders map[string]string
	MimeType        string
	MockRule        *webViewMockRule
}

func (s *WebViewCDPSession) handleCDPEvent(
	ctx context.Context,
	client *webViewCDPClient,
	target *webViewCDPTarget,
	event cdpEnvelope,
	requests map[string]*webViewCDPRequest,
) {
	switch event.Method {
	case "Network.requestWillBeSent":
		var params struct {
			RequestID string  `json:"requestId"`
			WallTime  float64 `json:"wallTime"`
			Request   struct {
				URL      string                 `json:"url"`
				Method   string                 `json:"method"`
				Headers  map[string]interface{} `json:"headers"`
				PostData string                 `json:"postData"`
			} `json:"request"`
		}
		if json.Unmarshal(event.Params, &params) != nil {
			return
		}
		timestamp := time.Now().UnixMilli()
		if params.WallTime > 0 {
			timestamp = int64(params.WallTime * 1000)
		}
		request := &webViewCDPRequest{
			UID:            "webview-" + target.targetID + "-" + params.RequestID,
			Timestamp:      timestamp,
			Method:         strings.ToUpper(params.Request.Method),
			URL:            params.Request.URL,
			RequestHeaders: flattenCDPHeaders(params.Request.Headers),
			RequestBody:    params.Request.PostData,
		}
		requests[params.RequestID] = request
		s.emitWebViewRecord(request, false, "")

	case "Network.responseReceived":
		var params struct {
			RequestID string `json:"requestId"`
			Response  struct {
				Status   float64                `json:"status"`
				Headers  map[string]interface{} `json:"headers"`
				MimeType string                 `json:"mimeType"`
				URL      string                 `json:"url"`
			} `json:"response"`
		}
		if json.Unmarshal(event.Params, &params) != nil {
			return
		}
		request := requests[params.RequestID]
		if request == nil {
			request = s.newFallbackRequest(target, params.RequestID, params.Response.URL)
			requests[params.RequestID] = request
		}
		request.StatusCode = int(params.Response.Status)
		request.ResponseHeaders = flattenCDPHeaders(params.Response.Headers)
		request.MimeType = params.Response.MimeType

	case "Network.loadingFinished":
		var params struct {
			RequestID string `json:"requestId"`
		}
		if json.Unmarshal(event.Params, &params) != nil {
			return
		}
		request := requests[params.RequestID]
		if request == nil {
			return
		}
		body := s.readCDPResponseBody(ctx, client, params.RequestID, request.MimeType)
		s.emitWebViewRecord(request, true, body)
		delete(requests, params.RequestID)

	case "Network.loadingFailed":
		var params struct {
			RequestID string `json:"requestId"`
			ErrorText string `json:"errorText"`
		}
		if json.Unmarshal(event.Params, &params) != nil {
			return
		}
		request := requests[params.RequestID]
		if request == nil {
			return
		}
		s.emitWebViewRecord(request, true, params.ErrorText)
		delete(requests, params.RequestID)

	case "Fetch.requestPaused":
		s.handleFetchPaused(ctx, client, target, event.Params, requests)
	}
}

func (s *WebViewCDPSession) newFallbackRequest(
	target *webViewCDPTarget,
	requestID string,
	requestURL string,
) *webViewCDPRequest {
	return &webViewCDPRequest{
		UID:             "webview-" + target.targetID + "-" + requestID,
		Timestamp:       time.Now().UnixMilli(),
		Method:          "GET",
		URL:             requestURL,
		RequestHeaders:  map[string]string{},
		ResponseHeaders: map[string]string{},
	}
}

func (s *WebViewCDPSession) readCDPResponseBody(
	parent context.Context,
	client *webViewCDPClient,
	requestID string,
	mimeType string,
) string {
	ctx, cancel := context.WithTimeout(parent, webViewCommandTimeout)
	defer cancel()
	result, err := client.call(ctx, "Network.getResponseBody", map[string]string{
		"requestId": requestID,
	})
	if err != nil {
		return ""
	}
	var bodyResult struct {
		Body          string `json:"body"`
		Base64Encoded bool   `json:"base64Encoded"`
	}
	if json.Unmarshal(result, &bodyResult) != nil {
		return ""
	}
	if !bodyResult.Base64Encoded {
		return truncateWebViewBody(bodyResult.Body)
	}
	decoded, err := base64.StdEncoding.DecodeString(bodyResult.Body)
	if err != nil {
		return ""
	}
	if len(decoded) > webViewMaxBodyBytes {
		decoded = decoded[:webViewMaxBodyBytes]
	}
	if isWebViewTextMimeType(mimeType) {
		return string(decoded)
	}
	if strings.HasPrefix(strings.ToLower(mimeType), "image/") {
		return "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(decoded)
	}
	return fmt.Sprintf("[binary:%s]", mimeType)
}

func truncateWebViewBody(body string) string {
	if len(body) <= webViewMaxBodyBytes {
		return body
	}
	return body[:webViewMaxBodyBytes]
}

func isWebViewTextMimeType(mimeType string) bool {
	lower := strings.ToLower(mimeType)
	return strings.HasPrefix(lower, "text/") ||
		strings.Contains(lower, "json") ||
		strings.Contains(lower, "xml") ||
		strings.Contains(lower, "javascript") ||
		strings.Contains(lower, "form")
}

func flattenCDPHeaders(headers map[string]interface{}) map[string]string {
	result := make(map[string]string, len(headers))
	for name, value := range headers {
		result[name] = fmt.Sprintf("%v", value)
	}
	return result
}

func (s *WebViewCDPSession) handleFetchPaused(
	parent context.Context,
	client *webViewCDPClient,
	target *webViewCDPTarget,
	raw json.RawMessage,
	requests map[string]*webViewCDPRequest,
) {
	var params struct {
		RequestID string `json:"requestId"`
		NetworkID string `json:"networkId"`
		Request   struct {
			URL      string                 `json:"url"`
			Method   string                 `json:"method"`
			Headers  map[string]interface{} `json:"headers"`
			PostData string                 `json:"postData"`
		} `json:"request"`
	}
	if json.Unmarshal(raw, &params) != nil {
		return
	}

	headers := flattenCDPHeaders(params.Request.Headers)
	rule := s.currentMockConfig().matchReplaceRule(
		params.Request.Method,
		params.Request.URL,
		headers,
		params.Request.PostData,
	)
	if rule == nil {
		if err := callCDPNoResult(parent, client, "Fetch.continueRequest", map[string]string{
			"requestId": params.RequestID,
		}); err != nil {
			log.Printf("[WebViewCDP] Continue request failed: %v", err)
		}
		return
	}

	responseHeaders := make(map[string]string, len(rule.ResponseConfig.Headers)+3)
	for name, value := range rule.ResponseConfig.Headers {
		responseHeaders[name] = value
	}
	setHeaderCaseInsensitive(responseHeaders, "Hadice-Mock", "true")
	if getHeaderCaseInsensitive(responseHeaders, "Content-Type") == "" {
		setHeaderCaseInsensitive(responseHeaders, "Content-Type", "application/json; charset=utf-8")
	}
	body := []byte(rule.ResponseConfig.Body)
	setHeaderCaseInsensitive(responseHeaders, "Content-Length", strconv.Itoa(len(body)))

	headerEntries := make([]map[string]string, 0, len(responseHeaders))
	for name, value := range responseHeaders {
		headerEntries = append(headerEntries, map[string]string{"name": name, "value": value})
	}
	statusCode := rule.ResponseConfig.StatusCode
	if statusCode <= 0 {
		statusCode = http.StatusOK
	}
	err := callCDPNoResult(parent, client, "Fetch.fulfillRequest", map[string]interface{}{
		"requestId":       params.RequestID,
		"responseCode":    statusCode,
		"responseHeaders": headerEntries,
		"body":            base64.StdEncoding.EncodeToString(body),
	})
	if err != nil {
		log.Printf("[WebViewCDP] Fulfill request failed: %v", err)
		return
	}

	if params.NetworkID != "" {
		if request := requests[params.NetworkID]; request != nil {
			ruleCopy := *rule
			request.MockRule = &ruleCopy
		}
	}
	log.Printf("[WebViewCDP] Replace matched: %s %s (%s)", params.Request.Method, params.Request.URL, rule.Name)
}

func (c webViewMockConfig) matchReplaceRule(
	method string,
	requestURL string,
	headers map[string]string,
	body string,
) *webViewMockRule {
	if !c.Enabled {
		return nil
	}
	for i := range c.Rules {
		rule := &c.Rules[i]
		if !rule.Enabled || !strings.EqualFold(rule.ResponseMode, "replace") {
			continue
		}
		condition := rule.MatchCondition
		if condition.URLPattern == "" {
			continue
		}
		useRegex := true
		if condition.URLRegex != nil {
			useRegex = *condition.URLRegex
		}
		if !matchesWebViewPattern(condition.URLPattern, requestURL, useRegex) {
			continue
		}
		if condition.Method != "" && !strings.EqualFold(condition.Method, method) {
			continue
		}
		if condition.BodyPattern != "" &&
			!matchesWebViewPattern(condition.BodyPattern, body, true) {
			continue
		}
		if !matchWebViewHeaders(condition.Headers, headers) {
			continue
		}
		return rule
	}
	return nil
}

func matchesWebViewPattern(pattern, value string, useRegex bool) bool {
	if pattern == "" {
		return false
	}
	if useRegex {
		if compiled, err := regexp.Compile(pattern); err == nil && compiled.FindStringIndex(value) != nil {
			return true
		}
	}
	return strings.Contains(value, pattern)
}

func matchWebViewHeaders(expected, actual map[string]string) bool {
	for name, pattern := range expected {
		value := getHeaderCaseInsensitive(actual, name)
		if value == "" || !matchesWebViewPattern(pattern, value, true) {
			return false
		}
	}
	return true
}

func getHeaderCaseInsensitive(headers map[string]string, expected string) string {
	for name, value := range headers {
		if strings.EqualFold(name, expected) {
			return value
		}
	}
	return ""
}

func setHeaderCaseInsensitive(headers map[string]string, name, value string) {
	for existing := range headers {
		if strings.EqualFold(existing, name) {
			delete(headers, existing)
			break
		}
	}
	headers[name] = value
}

func (s *WebViewCDPSession) emitWebViewRecord(
	request *webViewCDPRequest,
	response bool,
	responseBody string,
) {
	if s.emitEvent == nil || request == nil {
		return
	}

	extra := map[string]interface{}{
		"uid":           request.UID,
		"captureRunId":  s.captureRun,
		"captureSource": "WebView",
		"reqTime":       request.Timestamp,
	}
	record := map[string]interface{}{
		"id":             "android-" + s.captureRun + "-" + request.UID,
		"timestamp":      request.Timestamp,
		"direction":      "request",
		"method":         request.Method,
		"url":            request.URL,
		"fullUrl":        request.URL,
		"requestHeaders": request.RequestHeaders,
		"requestBody":    request.RequestBody,
		"extra":          extra,
	}
	if response {
		record["direction"] = "response"
		record["statusCode"] = request.StatusCode
		record["responseHeaders"] = request.ResponseHeaders
		record["responseBody"] = responseBody
		responseTime := time.Now().UnixMilli()
		if responseTime < request.Timestamp {
			responseTime = request.Timestamp
		}
		extra["respTime"] = responseTime
		if request.MockRule != nil {
			extra["mocked"] = true
			extra["mockRuleId"] = request.MockRule.ID
			extra["mockRuleName"] = request.MockRule.Name
		}
	}

	s.emitEvent("networkCapture:requestReceived", map[string]interface{}{
		"deviceId": s.deviceID,
		"request":  record,
	})
}
