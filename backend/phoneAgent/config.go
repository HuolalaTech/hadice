package phoneAgent

// LLMProvider LLM服务提供商类型
type LLMProvider string

const (
	// ProviderZhipuAI 智谱AI
	ProviderZhipuAI LLMProvider = "zhipu"
	// ProviderOpenAI OpenAI
	ProviderOpenAI LLMProvider = "openai"
)

// LLMConfig LLM配置
type LLMConfig struct {
	Provider    LLMProvider `json:"provider"`    // 服务提供商
	APIKey      string      `json:"apiKey"`      // API密钥
	BaseURL     string      `json:"baseURL"`     // API基础URL（可选，用于自定义端点）
	Model       string      `json:"model"`       // 模型名称
	MaxTokens   int         `json:"maxTokens"`   // 最大token数
	Temperature float64     `json:"temperature"` // 温度参数（0-1）
	TopP        float64     `json:"topP"`        // TopP参数（0-1）
}

// AgentConfig Agent配置
type AgentConfig struct {
	MaxSteps     int       `json:"maxSteps"`     // 最大执行步数，默认100
	DeviceID     string    `json:"deviceID"`     // 设备标识符
	Platform     string    `json:"platform"`     // 平台：harmonyos 或 android
	LLMConfig    LLMConfig `json:"llmConfig"`    // LLM配置
	Language     string    `json:"language"`     // 语言，默认"cn"
	SystemPrompt string    `json:"systemPrompt"` // 系统提示词（可选）
}
