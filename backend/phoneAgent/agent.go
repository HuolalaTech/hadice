package phoneAgent

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// Agent PhoneAgent实例 - 改造为使用ConfigManager、Parser、ActionHandler、MessageBuilder
type Agent struct {
	configManager  *ConfigManager  // 配置管理器
	llmClient      *LLMClient      // LLM客户端
	parser         Parser          // 动作解析器
	actionHandler  ActionHandler   // 动作执行处理器
	messageBuilder *MessageBuilder // 消息构建器
	screenshotFunc func(string) (*ScreenshotData, error) // 截图函数（根据平台选择）
	appInfoFunc    func(string) (*AppInfo, error)         // 应用信息函数（根据平台选择）
	ctx            context.Context // 上下文
	sessionID      string          // 会话ID
	stepCount      int             // 当前步数
	mu             sync.Mutex      // 并发保护
	isRunning      bool            // 运行状态
}

// NewAgent 创建新的Agent实例
func NewAgent(ctx context.Context, config AgentConfig) (*Agent, error) {
	// 创建配置管理器
	configManager := NewConfigManager()

	// 如果提供了自定义配置，则更新
	if config.LLMConfig.APIKey != "" {
		configManager.SetAgentConfig(config)
	}

	// 始终设置设备配置（DeviceID 是必需的）
	configManager.SetDeviceConfig(DeviceConfig{
		DeviceID: config.DeviceID,
	})

	// 验证配置
	if err := configManager.ValidateConfig(); err != nil {
		return nil, fmt.Errorf("config validation failed: %w", err)
	}

	// 创建LLM客户端
	llmClient := NewLLMClient(configManager.GetLLMConfig())

	// 创建解析器（双平台通用）
	parser := NewHarmonyOSParser()

	// 根据平台创建对应的动作处理器和截图函数
	var actionHandler ActionHandler
	var screenshotFunc func(string) (*ScreenshotData, error)
	var appInfoFunc func(string) (*AppInfo, error)

	if config.Platform == "android" {
		actionHandler = NewAndroidActionHandler(config.DeviceID)
		screenshotFunc = GetAndroidScreenshotDirect
		appInfoFunc = GetAndroidCurrentAppInfo
	} else {
		actionHandler = NewHarmonyOSActionHandler(config.DeviceID)
		screenshotFunc = GetScreenshotDirect
		appInfoFunc = GetCurrentAppInfo
	}

	// 获取系统提示词
	agentConfig := configManager.GetAgentConfig()
	systemPrompt := agentConfig.SystemPrompt
	if systemPrompt == "" {
		if agentConfig.Language == "en" {
			systemPrompt = GetSystemPromptEN()
		} else {
			systemPrompt = GetSystemPromptZH()
		}
	}

	// 创建消息构建器
	messageBuilder := NewMessageBuilder(systemPrompt)

	// 生成会话ID
	sessionID := fmt.Sprintf("agent_%d", time.Now().UnixNano())

	return &Agent{
		configManager:  configManager,
		llmClient:      llmClient,
		parser:         parser,
		actionHandler:  actionHandler,
		messageBuilder: messageBuilder,
		screenshotFunc: screenshotFunc,
		appInfoFunc:    appInfoFunc,
		ctx:            ctx,
		sessionID:      sessionID,
		stepCount:      0,
		isRunning:      false,
	}, nil
}

// ExecuteStep 执行单步操作
// task: 任务描述（仅在第一步需要）
// isFirst: 是否是第一步
// 返回执行结果
func (a *Agent) ExecuteStep(task string, isFirst bool) (*StepResult, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	agentConfig := a.configManager.GetAgentConfig()

	// 检查最大步数限制
	if !isFirst && a.stepCount >= agentConfig.MaxSteps {
		fmt.Printf("[PhoneAgent] 达到最大步数限制 %d，终止执行\n", agentConfig.MaxSteps)
		return &StepResult{
			Success:   false,
			Finished:  true,
			Message:   fmt.Sprintf("达到最大步数限制: %d", agentConfig.MaxSteps),
			StepCount: a.stepCount,
		}, nil
	}

	a.stepCount++
	// 获取设备状态（截图和应用信息）
	deviceConfig := a.configManager.GetDeviceConfig()

	screenshot, err := a.screenshotFunc(deviceConfig.DeviceID)
	if err != nil {
		fmt.Printf("[PhoneAgent] 步骤 %d/%d - 获取截图失败: %v\n", a.stepCount, agentConfig.MaxSteps, err)
		return &StepResult{
			Success:   false,
			Finished:  true,
			Message:   fmt.Sprintf("获取截图失败: %v", err),
			StepCount: a.stepCount,
		}, err
	}

	appInfo, err := a.appInfoFunc(deviceConfig.DeviceID)
	if err != nil {
		appInfo = &AppInfo{PackageName: "unknown", AppName: "unknown"}
	}

	appName := appInfo.AppName
	if appName == "unknown" {
		appName = appInfo.PackageName
	}

	fmt.Printf("[PhoneAgent] 步骤 %d/%d - 截图: %dx%d, 应用: %s\n",
		a.stepCount, agentConfig.MaxSteps, screenshot.Width, screenshot.Height, appName)

	// 构建消息
	if isFirst {
		if err := a.messageBuilder.BuildFirstMessage(task, screenshot, appInfo); err != nil {
			fmt.Printf("[PhoneAgent] 步骤 %d - 构建消息失败: %v\n", a.stepCount, err)
			return &StepResult{
				Success:   false,
				Finished:  true,
				Message:   fmt.Sprintf("构建消息失败: %v", err),
				StepCount: a.stepCount,
			}, err
		}
	} else {
		if err := a.messageBuilder.BuildFollowUpMessage(screenshot, appInfo); err != nil {
			fmt.Printf("[PhoneAgent] 步骤 %d - 构建消息失败: %v\n", a.stepCount, err)
			return &StepResult{
				Success:   false,
				Finished:  true,
				Message:   fmt.Sprintf("构建消息失败: %v", err),
				StepCount: a.stepCount,
			}, err
		}
	}

	messages := a.messageBuilder.GetMessages()
	fmt.Printf("[PhoneAgent] 步骤 %d - 消息数: %d\n", a.stepCount, len(messages))

	// 调用LLM（流式）
	var llmResponse *LLMResponse
	var llmErr error

	llmResponse, llmErr = a.llmClient.Request(messages, func(chunk *StreamChunk) error {
		// 发送流式数据到前端
		app := application.Get()
		if app != nil {
			app.Event.Emit(fmt.Sprintf("phoneAgent:stream:%s", a.sessionID), chunk)
		}
		return nil
	})

	if llmErr != nil {
		fmt.Printf("[PhoneAgent] 步骤 %d - LLM调用失败: %v\n", a.stepCount, llmErr)
		return &StepResult{
			Success:   false,
			Finished:  true,
			Message:   fmt.Sprintf("LLM调用失败: %v", llmErr),
			StepCount: a.stepCount,
		}, llmErr
	}

	// 解析思考过程
	thinking, _ := a.parser.ParseThinking(llmResponse.Thinking)

	// 解析操作指令
	action, err := a.parser.Parse(llmResponse.Action)
	actionType := "unknown"
	if err != nil {
		// 解析失败，尝试作为finish处理
		action = &Action{
			Metadata: string(ActionTypeFinish),
			Message:  llmResponse.Action,
		}
		actionType = "finish(fallback)"
	} else {
		actionType = action.Metadata
	}

	// 完整日志输出
	fmt.Printf("[PhoneAgent] 步骤 %d - 解析完成 - 类型: %s\n", a.stepCount, actionType)
	fmt.Printf("[PhoneAgent] 步骤 %d - Thinking (%d字符):\n%s\n", a.stepCount, len(thinking), thinking)
	if action != nil {
		fmt.Printf("[PhoneAgent] 步骤 %d - Action (%d字符):\n%v\n", a.stepCount, len(llmResponse.Action), action)
	}

	// 移除最后一条消息中的图片以节省上下文空间
	a.messageBuilder.RemoveLastImage()

	actionResult, err := a.actionHandler.Execute(action, screenshot.Width, screenshot.Height)
	if err != nil {
		// 操作失败不中断主流程，只返回失败状态给大模型
		fmt.Printf("[PhoneAgent] 步骤 %d - 操作执行失败: %v\n", a.stepCount, err)
		actionResult = &ActionResult{
			Success:      false,
			ShouldFinish: false,
			Message:      fmt.Sprintf("操作失败: %v", err),
		}
	}

	// 添加助手响应到消息上下文
	a.messageBuilder.AddAssistantMessage(thinking, llmResponse.Action)

	// 检查是否完成
	finished := action.Metadata == string(ActionTypeFinish) || actionResult.ShouldFinish

	fmt.Printf("[PhoneAgent] 步骤 %d 完成 - Success=%v, Finished=%v\n", a.stepCount, actionResult.Success, finished)

	return &StepResult{
		Success:   actionResult.Success,
		Finished:  finished,
		Action:    action,
		Thinking:  thinking,
		Message:   actionResult.Message,
		StepCount: a.stepCount,
	}, nil
}

// Reset 重置Agent状态
func (a *Agent) Reset() {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.stepCount = 0
	a.messageBuilder.ClearMessages()
}

// GetSessionID 获取会话ID
func (a *Agent) GetSessionID() string {
	return a.sessionID
}

// IsRunning 检查是否正在运行
func (a *Agent) IsRunning() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.isRunning
}

// SetRunning 设置运行状态
func (a *Agent) SetRunning(running bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.isRunning = running
}

// GetStepCount 获取当前步数
func (a *Agent) GetStepCount() int {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.stepCount
}

// GetConfig 获取Agent配置
func (a *Agent) GetConfig() AgentConfig {
	return a.configManager.GetAgentConfig()
}

// UpdateConfig 更新Agent配置
func (a *Agent) UpdateConfig(config AgentConfig) error {
	a.configManager.SetAgentConfig(config)

	// 更新消息构建器中的系统提示词
	systemPrompt := config.SystemPrompt
	if systemPrompt == "" {
		if config.Language == "en" {
			systemPrompt = GetSystemPromptEN()
		} else {
			systemPrompt = GetSystemPromptZH()
		}
	}
	a.messageBuilder.UpdateSystemPrompt(systemPrompt)

	// 重建LLM客户端
	a.llmClient = NewLLMClient(a.configManager.GetLLMConfig())

	return nil
}

// GetMessageSummary 获取消息摘要（用于调试）
func (a *Agent) GetMessageSummary() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.messageBuilder.GetMessageSummary()
}

// EstimateTokenCount 估计消息token数量
func (a *Agent) EstimateTokenCount() int {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.messageBuilder.EstimateTokenCount()
}
