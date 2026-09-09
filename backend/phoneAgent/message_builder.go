package phoneAgent

import (
	"fmt"
	"regexp"
	"strings"
)

// MessageBuilder 消息构建器 - 统一管理LLM请求消息的构建
type MessageBuilder struct {
	systemPrompt string
	messages     []ChatMessage
}

// NewMessageBuilder 创建消息构建器
func NewMessageBuilder(systemPrompt string) *MessageBuilder {
	return &MessageBuilder{
		systemPrompt: systemPrompt,
		messages:     make([]ChatMessage, 0),
	}
}

// BuildFirstMessage 构建第一步的消息
// 包含系统提示词、用户任务和截图
func (mb *MessageBuilder) BuildFirstMessage(task string, screenshot *ScreenshotData, appInfo *AppInfo) error {
	if mb.messages == nil {
		mb.messages = make([]ChatMessage, 0)
	}

	// 添加系统提示词
	mb.messages = append(mb.messages, ChatMessage{
		Role:    "system",
		Content: mb.systemPrompt,
	})

	// 构建用户消息（包含任务、截图和应用信息）
	screenInfo := fmt.Sprintf("当前应用: %s (%s)", appInfo.AppName, appInfo.PackageName)
	textContent := fmt.Sprintf("%s\n\n** 屏幕信息 **\n\n%s", task, screenInfo)

	userMessage := ChatMessage{
		Role: "user",
		Content: []map[string]interface{}{
			{
				"type": "text",
				"text": textContent,
			},
			{
				"type": "image_url",
				"image_url": map[string]interface{}{
					"url": fmt.Sprintf("data:image/jpeg;base64,%s", screenshot.Base64Data),
				},
			},
		},
	}

	mb.messages = append(mb.messages, userMessage)
	return nil
}

// BuildFollowUpMessage 构建后续步骤的消息
// 只包含屏幕信息和截图（节省token）
func (mb *MessageBuilder) BuildFollowUpMessage(screenshot *ScreenshotData, appInfo *AppInfo) error {
	screenInfo := fmt.Sprintf("** 屏幕信息 **\n\n当前应用: %s (%s)", appInfo.AppName, appInfo.PackageName)
	userMessage := ChatMessage{
		Role: "user",
		Content: []map[string]interface{}{
			{
				"type": "text",
				"text": screenInfo,
			},
			{
				"type": "image_url",
				"image_url": map[string]interface{}{
					"url": fmt.Sprintf("data:image/jpeg;base64,%s", screenshot.Base64Data),
				},
			},
		},
	}

	mb.messages = append(mb.messages, userMessage)
	return nil
}

// AddAssistantMessage 添加助手响应消息到上下文
// 用于维护对话历史
func (mb *MessageBuilder) AddAssistantMessage(thinking, action string) {
	assistantMessage := ChatMessage{
		Role:    "assistant",
		Content: fmt.Sprintf("<think>%s</think><answer>%s</answer>", thinking, action),
	}
	mb.messages = append(mb.messages, assistantMessage)
}

// RemoveLastImage 移除最后一条消息中的图片
// 这样可以保持上下文清晰，避免token浪费
func (mb *MessageBuilder) RemoveLastImage() {
	if len(mb.messages) == 0 {
		return
	}

	lastIdx := len(mb.messages) - 1
	msg := mb.messages[lastIdx]

	// 如果是user角色的消息，尝试移除图片
	if msg.Role == "user" {
		if contentArray, ok := msg.Content.([]map[string]interface{}); ok {
			// 过滤掉图片部分，只保留文本
			var filteredContent []map[string]interface{}
			for _, item := range contentArray {
				if itemType, ok := item["type"].(string); ok {
					if itemType == "text" {
						filteredContent = append(filteredContent, item)
					}
					// 跳过 image_url 类型
				}
			}
			// 更新消息
			mb.messages[lastIdx].Content = filteredContent
		}
	}
}

// GetMessages 获取所有消息
func (mb *MessageBuilder) GetMessages() []ChatMessage {
	return mb.messages
}

// GetMessageCount 获取消息数量
func (mb *MessageBuilder) GetMessageCount() int {
	return len(mb.messages)
}

// ClearMessages 清空所有消息
func (mb *MessageBuilder) ClearMessages() {
	mb.messages = make([]ChatMessage, 0)
}

// UpdateSystemPrompt 更新系统提示词
func (mb *MessageBuilder) UpdateSystemPrompt(newPrompt string) {
	mb.systemPrompt = newPrompt
	// 如果已有消息且第一条是系统提示词，则更新它
	if len(mb.messages) > 0 && mb.messages[0].Role == "system" {
		mb.messages[0].Content = newPrompt
	}
}

// GetSystemPrompt 获取系统提示词
func (mb *MessageBuilder) GetSystemPrompt() string {
	return mb.systemPrompt
}

// GetMessageSummary 获取消息摘要信息（用于调试）
func (mb *MessageBuilder) GetMessageSummary() string {
	var summary strings.Builder
	summary.WriteString(fmt.Sprintf("Messages: %d total\n", len(mb.messages)))

	for i, msg := range mb.messages {
		summary.WriteString(fmt.Sprintf("[%d] Role: %s, ", i, msg.Role))

		switch content := msg.Content.(type) {
		case string:
			if len(content) > 50 {
				summary.WriteString(fmt.Sprintf("Content: %s...\n", content[:50]))
			} else {
				summary.WriteString(fmt.Sprintf("Content: %s\n", content))
			}
		case []map[string]interface{}:
			summary.WriteString(fmt.Sprintf("Content: [%d items]\n", len(content)))
		default:
			summary.WriteString("Content: [unknown type]\n")
		}
	}

	return summary.String()
}

// EstimateTokenCount 估计消息的token数量（简单估算）
// 实际token数取决于LLM的分词器
func (mb *MessageBuilder) EstimateTokenCount() int {
	tokenCount := 0

	for _, msg := range mb.messages {
		switch content := msg.Content.(type) {
		case string:
			// 粗略估计: 1 token ≈ 4 characters
			tokenCount += len(content) / 4
		case []map[string]interface{}:
			for _, item := range content {
				if itemType, ok := item["type"].(string); ok {
					if itemType == "text" {
						if text, ok := item["text"].(string); ok {
							tokenCount += len(text) / 4
						}
					} else if itemType == "image_url" {
						// 图片通常占用固定的token数
						tokenCount += 500 // 估计值
					}
				}
			}
		}
	}

	return tokenCount
}

// ExtractTextContent 从消息中提取文本内容
func ExtractTextContent(msg ChatMessage) string {
	switch content := msg.Content.(type) {
	case string:
		return content
	case []map[string]interface{}:
		var texts []string
		for _, item := range content {
			if itemType, ok := item["type"].(string); ok && itemType == "text" {
				if text, ok := item["text"].(string); ok {
					texts = append(texts, text)
				}
			}
		}
		return strings.Join(texts, "\n")
	default:
		return ""
	}
}

// CompactMessages 压缩消息上下文
// 移除所有消息中的图片数据以节省空间
func (mb *MessageBuilder) CompactMessages() {
	for i := range mb.messages {
		mb.messages[i] = RemoveImagesFromMessage(mb.messages[i])
	}
}

// ValidateMessageFormat 验证消息格式是否正确
func (mb *MessageBuilder) ValidateMessageFormat() error {
	for i, msg := range mb.messages {
		// 检查role是否有效
		if msg.Role != "system" && msg.Role != "user" && msg.Role != "assistant" {
			return fmt.Errorf("invalid role in message %d: %s", i, msg.Role)
		}

		// 检查content类型
		switch msg.Content.(type) {
		case string:
			// 字符串内容总是有效的
		case []map[string]interface{}:
			// 复杂内容，检查结构
			if contentArray, ok := msg.Content.([]map[string]interface{}); ok {
				for j, item := range contentArray {
					if itemType, ok := item["type"].(string); !ok {
						return fmt.Errorf("missing type in content item %d of message %d", j, i)
					} else if itemType != "text" && itemType != "image_url" {
						return fmt.Errorf("invalid content type '%s' in message %d", itemType, i)
					}
				}
			}
		default:
			return fmt.Errorf("invalid content type in message %d", i)
		}
	}

	return nil
}

// SanitizeContent 清理内容中的特殊字符和换行
func SanitizeContent(text string) string {
	// 替换多个连续换行为单个换行
	re := regexp.MustCompile(`\n\n+`)
	text = re.ReplaceAllString(text, "\n\n")

	// 移除末尾空白
	text = strings.TrimSpace(text)

	return text
}
