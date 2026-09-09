package phoneAgent

// ActionType 操作类型
type ActionType string

const (
	// ActionTypeFinish 完成任务
	ActionTypeFinish ActionType = "finish"
	// ActionTypeDo 执行操作
	ActionTypeDo ActionType = "do"
)

// Action 操作指令
// 对标 AutoGLM-GUI 的 Action 结构，扩展支持HarmonyOS特性
type Action struct {
	Metadata  string                 `json:"_metadata"` // "finish" 或 "do"
	Action    string                 `json:"action"`    // 操作名称，如 "Tap", "Swipe", "Type" 等
	Element   []int                  `json:"element"`   // 元素坐标 [x, y] (相对坐标 0-1000)
	Text      string                 `json:"text"`      // 输入文本
	App       string                 `json:"app"`       // 应用包名或应用名称
	Message   string                 `json:"message"`   // 消息或说明
	Params    map[string]interface{} `json:"params"`    // 操作参数（对标AutoGLM-GUI）
	Extra     map[string]interface{} `json:"extra"`     // 额外参数
	Reasoning string                 `json:"reasoning"` // 推理说明
}

// ActionResult 操作执行结果
type ActionResult struct {
	Success      bool   `json:"success"`      // 是否成功
	ShouldFinish bool   `json:"shouldFinish"` // 是否应该结束任务
	Message      string `json:"message"`      // 结果消息
}

// StepResult 单步执行结果
type StepResult struct {
	Success   bool    `json:"success"`   // 是否成功
	Finished  bool    `json:"finished"`  // 是否完成
	Action    *Action `json:"action"`    // 执行的操作
	Thinking  string  `json:"thinking"`  // AI推理过程
	Message   string  `json:"message"`   // 消息
	StepCount int     `json:"stepCount"` // 当前步数
}

// ScreenshotData 截图数据
type ScreenshotData struct {
	Base64Data string `json:"base64Data"` // Base64编码的图片数据
	Width      int    `json:"width"`      // 图片宽度
	Height     int    `json:"height"`     // 图片高度
}

// DeviceState 设备状态
type DeviceState struct {
	Screenshot *ScreenshotData `json:"screenshot"` // 截图数据
	AppInfo    *AppInfo        `json:"appInfo"`    // 当前应用信息
}

// AppInfo 应用信息
type AppInfo struct {
	PackageName string `json:"packageName"` // 包名
	AppName     string `json:"appName"`     // 应用名称
	Activity    string `json:"activity"`    // 当前Activity
}

// LLMResponse LLM响应
type LLMResponse struct {
	Thinking string `json:"thinking"` // 推理过程
	Action   string `json:"action"`   // 操作指令（JSON字符串）
}

// StreamChunk 流式响应数据块
type StreamChunk struct {
	Type       string `json:"type"`       // 类型: "thinking" 或 "action"
	Content    string `json:"content"`    // 内容
	IsComplete bool   `json:"isComplete"` // 是否完成
}
