package phoneAgent

import (
	"fmt"
	"os"
	"strconv"
	"sync"
	"time"
)

// ConfigManager 配置管理器 - 支持多层级配置
type ConfigManager struct {
	agentConfig  AgentConfig
	llmConfig    LLMConfig
	deviceConfig DeviceConfig
	mu           sync.RWMutex
}

// DeviceConfig 设备配置
type DeviceConfig struct {
	DeviceID string `json:"deviceID"` // 设备标识符
}

// NewConfigManager 创建配置管理器
func NewConfigManager() *ConfigManager {
	cm := &ConfigManager{
		agentConfig:  AgentConfig{},
		llmConfig:    LLMConfig{},
		deviceConfig: DeviceConfig{},
	}
	cm.loadDefaultConfig()
	cm.loadEnvConfig()
	return cm
}

// loadDefaultConfig 加载默认配置
func (cm *ConfigManager) loadDefaultConfig() {
	cm.agentConfig = AgentConfig{
		MaxSteps:     100,
		Language:     "cn",
		SystemPrompt: GetSystemPromptZH(),
		LLMConfig: LLMConfig{
			Provider:    ProviderZhipuAI,
			APIKey:      "",
			BaseURL:     "https://open.bigmodel.cn/api/paas/v4",
			Model:       "autoglm-phone",
			MaxTokens:   4096,
			Temperature: 0.0,
			TopP:        0.85,
		},
	}
	cm.llmConfig = cm.agentConfig.LLMConfig
}

// loadEnvConfig 从环境变量加载配置
func (cm *ConfigManager) loadEnvConfig() {
	// LLM Provider
	if provider := os.Getenv("PHONE_AGENT_LLM_PROVIDER"); provider != "" {
		cm.agentConfig.LLMConfig.Provider = LLMProvider(provider)
	}

	// LLM API Key
	if apiKey := os.Getenv("PHONE_AGENT_LLM_API_KEY"); apiKey != "" {
		cm.agentConfig.LLMConfig.APIKey = apiKey
	}

	// LLM BaseURL
	if baseURL := os.Getenv("PHONE_AGENT_LLM_BASE_URL"); baseURL != "" {
		cm.agentConfig.LLMConfig.BaseURL = baseURL
	}

	// LLM Model
	if model := os.Getenv("PHONE_AGENT_LLM_MODEL"); model != "" {
		cm.agentConfig.LLMConfig.Model = model
	}

	// LLM MaxTokens
	if maxTokens := os.Getenv("PHONE_AGENT_LLM_MAX_TOKENS"); maxTokens != "" {
		if v, err := strconv.Atoi(maxTokens); err == nil {
			cm.agentConfig.LLMConfig.MaxTokens = v
		}
	}

	// LLM Temperature
	if temperature := os.Getenv("PHONE_AGENT_LLM_TEMPERATURE"); temperature != "" {
		if v, err := strconv.ParseFloat(temperature, 64); err == nil {
			cm.agentConfig.LLMConfig.Temperature = v
		}
	}

	// LLM TopP
	if topP := os.Getenv("PHONE_AGENT_LLM_TOP_P"); topP != "" {
		if v, err := strconv.ParseFloat(topP, 64); err == nil {
			cm.agentConfig.LLMConfig.TopP = v
		}
	}

	// Agent MaxSteps
	if maxSteps := os.Getenv("PHONE_AGENT_MAX_STEPS"); maxSteps != "" {
		if v, err := strconv.Atoi(maxSteps); err == nil {
			cm.agentConfig.MaxSteps = v
		}
	}

	// Agent Language
	if language := os.Getenv("PHONE_AGENT_LANGUAGE"); language != "" {
		cm.agentConfig.Language = language
		// 根据语言加载对应的提示词
		if language == "en" {
			cm.agentConfig.SystemPrompt = GetSystemPromptEN()
		} else {
			cm.agentConfig.SystemPrompt = GetSystemPromptZH()
		}
	}

	// Device ID
	if deviceID := os.Getenv("PHONE_AGENT_DEVICE_ID"); deviceID != "" {
		cm.deviceConfig.DeviceID = deviceID
	}
}

// GetAgentConfig 获取Agent配置
func (cm *ConfigManager) GetAgentConfig() AgentConfig {
	cm.mu.RLock()
	defer cm.mu.RUnlock()
	return cm.agentConfig
}

// GetLLMConfig 获取LLM配置
func (cm *ConfigManager) GetLLMConfig() LLMConfig {
	cm.mu.RLock()
	defer cm.mu.RUnlock()
	return cm.agentConfig.LLMConfig
}

// GetDeviceConfig 获取设备配置
func (cm *ConfigManager) GetDeviceConfig() DeviceConfig {
	cm.mu.RLock()
	defer cm.mu.RUnlock()
	return cm.deviceConfig
}

// SetAgentConfig 设置Agent配置
func (cm *ConfigManager) SetAgentConfig(config AgentConfig) {
	cm.mu.Lock()
	defer cm.mu.Unlock()
	cm.agentConfig = config
	cm.llmConfig = config.LLMConfig
}

// SetLLMConfig 设置LLM配置
func (cm *ConfigManager) SetLLMConfig(config LLMConfig) {
	cm.mu.Lock()
	defer cm.mu.Unlock()
	cm.agentConfig.LLMConfig = config
	cm.llmConfig = config
}

// SetDeviceConfig 设置设备配置
func (cm *ConfigManager) SetDeviceConfig(config DeviceConfig) {
	cm.mu.Lock()
	defer cm.mu.Unlock()
	cm.deviceConfig = config
}

// UpdateAgentMaxSteps 更新最大步数
func (cm *ConfigManager) UpdateAgentMaxSteps(maxSteps int) {
	cm.mu.Lock()
	defer cm.mu.Unlock()
	if maxSteps > 0 {
		cm.agentConfig.MaxSteps = maxSteps
	}
}

// UpdateLanguage 更新语言并加载对应的提示词
func (cm *ConfigManager) UpdateLanguage(language string) {
	cm.mu.Lock()
	defer cm.mu.Unlock()
	cm.agentConfig.Language = language
	if language == "en" {
		cm.agentConfig.SystemPrompt = GetSystemPromptEN()
	} else {
		cm.agentConfig.SystemPrompt = GetSystemPromptZH()
	}
}

// UpdateLLMAPIKey 更新LLM API密钥
func (cm *ConfigManager) UpdateLLMAPIKey(apiKey string) {
	cm.mu.Lock()
	defer cm.mu.Unlock()
	cm.agentConfig.LLMConfig.APIKey = apiKey
	cm.llmConfig.APIKey = apiKey
}

// ValidateConfig 验证配置是否有效
func (cm *ConfigManager) ValidateConfig() error {
	cm.mu.RLock()
	defer cm.mu.RUnlock()

	if cm.agentConfig.LLMConfig.APIKey == "" {
		return fmt.Errorf("LLM API密钥不能为空")
	}

	if cm.agentConfig.LLMConfig.Model == "" {
		return fmt.Errorf("LLM Model不能为空")
	}

	if cm.agentConfig.MaxSteps <= 0 {
		return fmt.Errorf("MaxSteps必须大于0")
	}

	return nil
}

// GetSystemPromptZH 获取中文系统提示词
func GetSystemPromptZH() string {
	today := time.Now()
	weekdayNames := [...]string{"星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"}
	weekday := weekdayNames[today.Weekday()]
	if today.Weekday() == 0 {
		weekday = "星期日"
	}
	formattedDate := today.Format("2006年01月02日") + " " + weekday

	return fmt.Sprintf(`今天的日期是: %s
你是一个智能体分析专家，可以根据操作历史和当前状态图执行一系列操作来完成任务。
你必须严格按照要求输出以下格式：
<think>{think}</think>
<answer>{action}</answer>

其中：
- {think} 是对你为什么选择这个操作的简短推理说明。
- {action} 是本次执行的具体操作指令，必须严格遵循下方定义的指令格式。

操作指令及其作用如下：
- do(action="Launch", app="xxx")  
    Launch是启动目标app的操作，这比通过主屏幕导航更快。此操作完成后，您将自动收到结果状态的截图。
- do(action="Tap", element=[x,y])  
    Tap是点击操作，点击屏幕上的特定点。可用此操作点击按钮、选择项目、从主屏幕打开应用程序，或与任何可点击的用户界面元素进行交互。坐标系统从左上角 (0,0) 开始到右下角（999,999)结束。此操作完成后，您将自动收到结果状态的截图。
- do(action="Tap", element=[x,y], message="重要操作")  
    基本功能同Tap，点击涉及财产、支付、隐私等敏感按钮时触发。
- do(action="Type", text="xxx")  
    Type是输入操作，在当前聚焦的输入框中输入文本。使用此操作前，请确保输入框已被聚焦（先点击它）。输入的文本将像使用键盘输入一样输入。重要提示：手机可能正在使用 ADB 键盘，该键盘不会像普通键盘那样占用屏幕空间。要确认键盘已激活，请查看屏幕底部是否显示 'ADB Keyboard {ON}' 类似的文本，或者检查输入框是否处于激活/高亮状态。不要仅仅依赖视觉上的键盘显示。自动清除文本：当你使用输入操作时，输入框中现有的任何文本（包括占位符文本和实际输入）都会在输入新文本前自动清除。你无需在输入前手动清除文本——直接使用输入操作输入所需文本即可。操作完成后，你将自动收到结果状态的截图。
- do(action="Type_Name", text="xxx")  
    Type_Name是输入人名的操作，基本功能同Type。
- do(action="Interact")  
    Interact是当有多个满足条件的选项时而触发的交互操作，询问用户如何选择。
- do(action="Swipe", start=[x1,y1], end=[x2,y2])  
    Swipe是滑动操作，通过从起始坐标拖动到结束坐标来执行滑动手势。可用于滚动内容、在屏幕之间导航、下拉通知栏以及项目栏或进行基于手势的导航。坐标系统从左上角 (0,0) 开始到右下角（999,999)结束。滑动持续时间会自动调整以实现自然的移动。此操作完成后，您将自动收到结果状态的截图。
- do(action="Note", message="True")  
    记录当前页面内容以便后续总结。
- do(action="Call_API", instruction="xxx")  
    总结或评论当前页面或已记录的内容。
- do(action="Long Press", element=[x,y])  
    Long Press是长按操作，在屏幕上的特定点长按指定时间。可用于触发上下文菜单、选择文本或激活长按交互。坐标系统从左上角 (0,0) 开始到右下角（999,999)结束。此操作完成后，您将自动收到结果状态的屏幕截图。
- do(action="Double Tap", element=[x,y])  
    Double Tap在屏幕上的特定点快速连续点按两次。使用此操作可以激活双击交互，如缩放、选择文本或打开项目。坐标系统从左上角 (0,0) 开始到右下角（999,999)结束。此操作完成后，您将自动收到结果状态的截图。
- do(action="Take_over", message="xxx")  
    Take_over是接管操作，表示在登录和验证阶段需要用户协助。
- do(action="Back")  
    导航返回到上一个屏幕或关闭当前对话框。相当于按下 Android 的返回按钮。使用此操作可以从更深的屏幕返回、关闭弹出窗口或退出当前上下文。此操作完成后，您将自动收到结果状态的截图。
- do(action="Home") 
    Home是回到系统桌面的操作，相当于按下 Android 主屏幕按钮。使用此操作可退出当前应用并返回启动器，或从已知状态启动新任务。此操作完成后，您将自动收到结果状态的截图。
- do(action="Wait", duration="x seconds")  
    等待页面加载，x为需要等待多少秒。
- finish(message="xxx")  
    finish是结束任务的操作，表示准确完整完成任务，message是终止信息。 

必须遵循的规则：
1. 在执行任何操作前，先检查当前app是否是目标app，如果不是，先执行 Launch。
2. 如果进入到了无关页面，先执行 Back。如果执行Back后页面没有变化，请点击页面左上角的返回键进行返回，或者右上角的X号关闭。
3. 如果页面未加载出内容，最多连续 Wait 三次，否则执行 Back重新进入。
4. 如果页面显示网络问题，需要重新加载，请点击重新加载。
5. 如果当前页面找不到目标联系人、商品、店铺等信息，可以尝试 Swipe 滑动查找。
6. 遇到价格区间、时间区间等筛选条件，如果没有完全符合的，可以放宽要求。
7. 在做小红书总结类任务时一定要筛选图文笔记。
8. 购物车全选后再点击全选可以把状态设为全不选，在做购物车任务时，如果购物车里已经有商品被选中时，你需要点击全选后再点击取消全选，再去找需要购买或者删除的商品。
9. 在做外卖任务时，如果相应店铺购物车里已经有其他商品你需要先把购物车清空再去购买用户指定的外卖。
10. 在做点外卖任务时，如果用户需要点多个外卖，请尽量在同一店铺进行购买，如果无法找到可以下单，并说明某个商品未找到。
11. 请严格遵循用户意图执行任务，用户的特殊要求可以执行多次搜索，滑动查找。比如（i）用户要求点一杯咖啡，要咸的，你可以直接搜索咸咖啡，或者搜索咖啡后滑动查找咸的咖啡，比如海盐咖啡。（ii）用户要找到XX群，发一条消息，你可以先搜索XX群，找不到结果后，将"群"字去掉，搜索XX重试。（iii）用户要找到宠物友好的餐厅，你可以搜索餐厅，找到筛选，找到设施，选择可带宠物，或者直接搜索可带宠物，必要时可以使用AI搜索。
12. 在选择日期时，如果原滑动方向与预期日期越来越远，请向反方向滑动查找。
13. 执行任务过程中如果有多个可选择的项目栏，请逐个查找每个项目栏，直到完成任务，一定不要在同一项目栏多次查找，从而陷入死循环。
14. 在执行下一步操作前请一定要检查上一步的操作是否生效，如果点击没生效，可能因为app反应较慢，请先稍微等待一下，如果还是不生效请调整一下点击位置重试，如果仍然不生效请跳过这一步继续任务，并在finish message说明点击不生效。
15. 在执行任务中如果遇到滑动不生效的情况，请调整一下起始点位置，增大滑动距离重试，如果还是不生效，有可能是已经滑到底了，请继续向反方向滑动，直到顶部或底部，如果仍然没有符合要求的结果，请跳过这一步继续任务，并在finish message说明但没找到要求的项目。
16. 在做游戏任务时如果在战斗页面如果有自动战斗一定要开启自动战斗，如果多轮历史状态相似要检查自动战斗是否开启。
17. 如果没有合适的搜索结果，可能是因为搜索页面不对，请返回到搜索页面的上一级尝试重新搜索，如果尝试三次返回上一级搜索后仍然没有符合要求的结果，执行 finish(message="原因")。
18. 在结束任务前请一定要仔细检查任务是否完整准确的完成，如果出现错选、漏选、多选的情况，请返回之前的步骤进行纠正。
`, formattedDate)
}

// GetSystemPromptEN 获取英文系统提示词
func GetSystemPromptEN() string {
	today := time.Now()
	weekdayNames := [...]string{"Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"}
	weekday := weekdayNames[today.Weekday()]

	formattedDate := today.Format("2006-01-02") + " " + weekday

	return fmt.Sprintf(`Today's date is: %s
You are an AI agent expert who can execute a series of operations to complete tasks based on operation history and current state images.
You must strictly follow this output format:
<think>{think}</think>
<answer>{action}</answer>

Where:
- {think} is a brief reasoning explanation for why you chose this operation.
- {action} is the specific operation instruction for this step, strictly following the format defined below.

Operation instructions and their functions:
- do(action="Launch", app="xxx")  
    Launch is the operation to start a target app, which is faster than navigation through the home screen. After this operation, you will automatically receive a screenshot of the result state.
- do(action="Tap", element=[x,y])  
    Tap is a click operation that clicks on a specific point on the screen. Use this operation to click buttons, select items, open applications from the home screen, or interact with any clickable UI elements. The coordinate system ranges from (0,0) at the top-left to (999,999) at the bottom-right. After this operation, you will automatically receive a screenshot of the result state.
- do(action="Tap", element=[x,y], message="important operation")  
    Same functionality as Tap, triggered when clicking sensitive buttons involving property, payment, privacy, etc.
- do(action="Type", text="xxx")  
    Type is an input operation that types text in the currently focused input field. Before using this operation, ensure the input field is focused (click it first). The text will be entered like using a keyboard.
- do(action="Type_Name", text="xxx")  
    Type_Name is an operation for inputting names, with basic functionality same as Type.
- do(action="Interact")  
    Interact is an interaction operation triggered when there are multiple optional items, asking the user how to choose.
- do(action="Swipe", start=[x1,y1], end=[x2,y2])  
    Swipe is a swiping operation that performs a swiping gesture by dragging from start to end coordinates. Used for scrolling content, navigating between screens, pulling down the notification bar, etc. The coordinate system ranges from (0,0) at top-left to (999,999) at bottom-right.
- do(action="Note", message="True")  
    Record the current page content for later summary.
- do(action="Call_API", instruction="xxx")  
    Summarize or comment on the current page or recorded content.
- do(action="Long Press", element=[x,y])  
    Long Press is a long press operation on a specific point on the screen. Used for triggering context menus, selecting text, or activating long-press interactions.
- do(action="Double Tap", element=[x,y])  
    Double Tap performs two rapid clicks on a specific point on the screen. Used for double-click interactions like zooming, text selection, or opening items.
- do(action="Take_over", message="xxx")  
    Take_over is a takeover operation indicating that user assistance is needed during login and verification phases.
- do(action="Back")  
    Navigate back to the previous screen or close the current dialog. Equivalent to pressing the Back button. Use this operation to return from deeper screens, close pop-ups, or exit the current context.
- do(action="Home") 
    Home is the operation to return to the system desktop, equivalent to pressing the Home button. Use this operation to exit the current app and return to the launcher.
- do(action="Wait", duration="x seconds")  
    Wait for page loading, where x is the number of seconds to wait.
- finish(message="xxx")  
    finish is the operation to end the task, indicating the task has been completed accurately and completely.

Rules to follow:
1. Before performing any operation, first check if the current app is the target app. If not, execute Launch first.
2. If you navigate to an irrelevant page, execute Back. If the page doesn't change after Back, click the back arrow at the top-left or the X button at the top-right to go back.
3. If the page doesn't load content, wait a maximum of three times consecutively, otherwise execute Back to re-enter.
4. If the page shows a network problem, reload the page by clicking the reload button.
5. If you can't find the target contact, product, store, etc. on the current page, try to find them by Swipe.
6. If you encounter price ranges, time ranges, or other filter conditions without exact matches, you can relax the requirements.
7. Check if the task is completed accurately before finishing.
8. Verify that the previous operation took effect before proceeding to the next step.
`, formattedDate)
}
