package backend

import (
	"bytes"
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	applogger "Hadice/backend/logger"
)

const (
	defaultPosthogCaptureURL = "https://us.i.posthog.com/capture/"
	posthogFlushSize         = 10
	posthogFlushInterval     = 5 * time.Second
)

var (
	posthogApiKey     string
	posthogCaptureURL string
	posthogDistinctID string
	posthogMutex      sync.Mutex
	posthogBuffer     []posthogEvent
	posthogStopCh     chan struct{}
	posthogHTTPClient *http.Client
)

type posthogEvent struct {
	Event      string                 `json:"event"`
	Properties map[string]interface{} `json:"properties"`
}

type posthogPayload struct {
	APIKey     string                 `json:"api_key"`
	Event      string                 `json:"event"`
	Properties map[string]interface{} `json:"properties"`
}

type posthogBatchPayload struct {
	APIKey               string           `json:"api_key"`
	Batch                []posthogPayload `json:"batch"`
	HistoricalMigrations interface{}      `json:"historical_migrations,omitempty"`
}

// InitPosthog 初始化 PostHog 后端追踪。
// 密钥来自环境变量、本地 `.env.ci`（开发）或构建期嵌入值：POSTHOG_API_KEY / VITE_POSTHOG_KEY。
// 未配置则禁用。发布包不再包含 `.env.ci` 文件。
func InitPosthog() {
	posthogApiKey = EnvOr("", "POSTHOG_API_KEY", "VITE_POSTHOG_KEY")
	posthogCaptureURL = EnvOr(defaultPosthogCaptureURL, "POSTHOG_CAPTURE_URL")
	if posthogApiKey == "" {
		if applogger.Sugar != nil {
			applogger.Sugar.Info("[PostHog] disabled (no API key in env / embed)")
		}
		return
	}

	posthogBuffer = make([]posthogEvent, 0, posthogFlushSize)
	posthogStopCh = make(chan struct{})
	posthogHTTPClient = &http.Client{Timeout: 10 * time.Second}

	go posthogFlushLoop()

	if applogger.Sugar != nil {
		applogger.Sugar.Info("[PostHog] Backend tracking initialized")
	}
}

// FlushPosthog 刷新 PostHog 事件队列
func FlushPosthog() {
	posthogMutex.Lock()
	defer posthogMutex.Unlock()

	if len(posthogBuffer) > 0 {
		posthogSendBatch(posthogBuffer)
		posthogBuffer = posthogBuffer[:0]
	}
}

// SetPosthogDistinctId 设置用户 distinct_id（由前端调用）
func (a *AppService) SetPosthogDistinctId(id string) {
	posthogDistinctID = id
}

// CapturePosthogEvent 捕获一个 PostHog 事件
func CapturePosthogEvent(event string, properties map[string]interface{}) {
	if posthogApiKey == "" {
		return
	}

	props := properties
	if props == nil {
		props = make(map[string]interface{})
	}
	props["distinct_id"] = posthogDistinctID
	props["$lib"] = "posthog-go-custom"

	evt := posthogEvent{
		Event:      event,
		Properties: props,
	}

	posthogMutex.Lock()
	posthogBuffer = append(posthogBuffer, evt)
	shouldFlush := len(posthogBuffer) >= posthogFlushSize
	buf := make([]posthogEvent, len(posthogBuffer))
	copy(buf, posthogBuffer)
	if shouldFlush {
		posthogBuffer = posthogBuffer[:0]
	}
	posthogMutex.Unlock()

	if shouldFlush {
		go posthogSendBatch(buf)
	}
}

func posthogFlushLoop() {
	ticker := time.NewTicker(posthogFlushInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			FlushPosthog()
		case <-posthogStopCh:
			return
		}
	}
}

func posthogSendBatch(events []posthogEvent) {
	if len(events) == 0 || posthogApiKey == "" || posthogHTTPClient == nil {
		return
	}

	batch := make([]posthogPayload, len(events))
	for i, evt := range events {
		batch[i] = posthogPayload{
			APIKey:     posthogApiKey,
			Event:      evt.Event,
			Properties: evt.Properties,
		}
	}

	payload := posthogBatchPayload{
		APIKey: posthogApiKey,
		Batch:  batch,
	}

	data, err := json.Marshal(payload)
	if err != nil {
		log.Printf("[PostHog] Failed to marshal payload: %v", err)
		return
	}

	resp, err := posthogHTTPClient.Post(posthogCaptureURL, "application/json", bytes.NewReader(data))
	if err != nil {
		log.Printf("[PostHog] Failed to send events: %v", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		log.Printf("[PostHog] Unexpected status code: %d", resp.StatusCode)
	}
}
