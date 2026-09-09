package phoneAgent

import (
	"fmt"
	"testing"
)

// TestConfigManagerBasic 测试 ConfigManager 基础功能
func TestConfigManagerBasic(t *testing.T) {
	cm := NewConfigManager()

	// 验证默认配置
	config := cm.GetAgentConfig()
	if config.MaxSteps != 100 {
		t.Fatalf("expected MaxSteps=100, got %d", config.MaxSteps)
	}

	// 验证提示词
	if config.SystemPrompt == "" {
		t.Fatal("SystemPrompt should not be empty")
	}

	fmt.Println("✓ ConfigManager 基础测试通过")
}

// TestParserBasic 测试 Parser 基础功能
func TestParserBasic(t *testing.T) {
	parser := NewHarmonyOSParser()

	// 测试解析 do() 函数调用
	actionStr := `do(action="Tap", element=[500, 500])`
	action, err := parser.Parse(actionStr)
	if err != nil {
		t.Fatalf("failed to parse action: %v", err)
	}

	if action.Action != "Tap" {
		t.Fatalf("expected action=Tap, got %s", action.Action)
	}

	if len(action.Element) != 2 || action.Element[0] != 500 || action.Element[1] != 500 {
		t.Fatalf("expected element=[500, 500], got %v", action.Element)
	}

	// 测试解析 finish() 函数调用
	finishStr := `finish(message="任务完成")`
	finishAction, err := parser.Parse(finishStr)
	if err != nil {
		t.Fatalf("failed to parse finish action: %v", err)
	}

	if finishAction.Metadata != string(ActionTypeFinish) {
		t.Fatalf("expected metadata=finish, got %s", finishAction.Metadata)
	}

	fmt.Println("✓ Parser 基础测试通过")
}

// TestMessageBuilder 测试 MessageBuilder 基础功能
func TestMessageBuilder(t *testing.T) {
	prompt := "Test system prompt"
	mb := NewMessageBuilder(prompt)

	// 验证系统提示词
	if mb.GetSystemPrompt() != prompt {
		t.Fatal("SystemPrompt not set correctly")
	}

	// 验证消息计数
	if mb.GetMessageCount() != 0 {
		t.Fatalf("expected 0 messages initially, got %d", mb.GetMessageCount())
	}

	// 添加消息
	mb.AddAssistantMessage("thinking", "action")
	if mb.GetMessageCount() != 1 {
		t.Fatalf("expected 1 message after add, got %d", mb.GetMessageCount())
	}

	fmt.Println("✓ MessageBuilder 基础测试通过")
}

// TestActionHandler 测试 ActionHandler 基础功能
func TestActionHandler(t *testing.T) {
	handler := NewHarmonyOSActionHandler("test_device")

	// 验证支持的动作列表
	supported := handler.GetSupportedActions()
	if len(supported) == 0 {
		t.Fatal("should have supported actions")
	}

	// 验证动作验证
	validAction := &Action{
		Metadata: string(ActionTypeDo),
		Action:   "Tap",
		Element:  []int{500, 500},
	}

	if err := handler.ValidateAction(validAction); err != nil {
		t.Fatalf("valid action should not return error: %v", err)
	}

	// 验证无效动作
	invalidAction := &Action{
		Metadata: string(ActionTypeDo),
		Action:   "Tap",
		Element:  []int{},
	}

	if err := handler.ValidateAction(invalidAction); err == nil {
		t.Fatal("invalid action should return error")
	}

	fmt.Println("✓ ActionHandler 基础测试通过")
}

// TestSystemPrompt 测试系统提示词
func TestSystemPrompt(t *testing.T) {
	promptZH := GetSystemPromptZH()
	if promptZH == "" {
		t.Fatal("中文提示词不能为空")
	}

	// 验证提示词包含关键内容
	keywords := []string{"操作指令", "Tap", "Swipe", "Type", "finish"}
	for _, keyword := range keywords {
		if !contains(promptZH, keyword) {
			t.Fatalf("提示词缺少关键词: %s", keyword)
		}
	}

	promptEN := GetSystemPromptEN()
	if promptEN == "" {
		t.Fatal("英文提示词不能为空")
	}

	fmt.Println("✓ 系统提示词测试通过")
}

// contains 检查字符串是否包含指定内容
func contains(s, substr string) bool {
	for i := 0; i < len(s); i++ {
		if i+len(substr) <= len(s) && s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

// TestIntegration 集成测试
func TestIntegration(t *testing.T) {
	fmt.Println("开始运行 phoneAgent 改造验证测试...")

	TestConfigManagerBasic(t)
	TestParserBasic(t)
	TestMessageBuilder(t)
	TestActionHandler(t)
	TestSystemPrompt(t)

	fmt.Println("✅ 所有验证测试通过！改造完成。")
}
