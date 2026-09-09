package phoneAgent

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// LLMClient LLM客户端
type LLMClient struct {
	config LLMConfig
	client *http.Client
}

// RemoveImagesFromMessage 移除消息中的图片以节省上下文空间
// 保留文本内容，只移除image_url部分
func RemoveImagesFromMessage(msg ChatMessage) ChatMessage {
	if contentList, ok := msg.Content.([]map[string]interface{}); ok {
		// 过滤出非image_url类型的内容
		var filteredContent []map[string]interface{}
		for _, item := range contentList {
			if itemType, ok := item["type"].(string); ok && itemType != "image_url" {
				filteredContent = append(filteredContent, item)
			}
		}
		msg.Content = filteredContent
	}
	return msg
}

// NewLLMClient 创建LLM客户端
func NewLLMClient(config LLMConfig) *LLMClient {
	return &LLMClient{
		config: config,
		client: &http.Client{
			Timeout: 120 * time.Second, // 2分钟超时
		},
	}
}

// ChatMessage 聊天消息
type ChatMessage struct {
	Role    string      `json:"role"`    // "system", "user", "assistant"
	Content interface{} `json:"content"` // 字符串或包含text和image_url的对象
}

// LLMRequest LLM请求
type LLMRequest struct {
	Model       string        `json:"model"`
	Messages    []ChatMessage `json:"messages"`
	MaxTokens   int           `json:"max_tokens,omitempty"`
	Temperature float64       `json:"temperature,omitempty"`
	TopP        float64       `json:"top_p,omitempty"`
	Stream      bool          `json:"stream,omitempty"`
}

// LLMResponseChunk LLM流式响应块
type LLMResponseChunk struct {
	Choices []struct {
		Delta struct {
			Content string `json:"content"`
		} `json:"delta"`
	} `json:"choices"`
}

// Request 发送请求到LLM（流式）
// messages: 消息列表
// onChunk: 接收数据块的回调函数
// 返回完整响应和错误
func (c *LLMClient) Request(messages []ChatMessage, onChunk func(chunk *StreamChunk) error) (*LLMResponse, error) {
	var apiURL string
	var requestBody LLMRequest

	// 根据提供商设置API URL和请求格式
	switch c.config.Provider {
	case ProviderZhipuAI:
		apiURL = "https://open.bigmodel.cn/api/paas/v4/chat/completions"
		if c.config.BaseURL != "" {
			// 如果BaseURL不包含/chat/completions，则自动拼接
			if !strings.Contains(c.config.BaseURL, "/chat/completions") {
				apiURL = strings.TrimSuffix(c.config.BaseURL, "/") + "/chat/completions"
			} else {
				apiURL = c.config.BaseURL
			}
		}
		requestBody = LLMRequest{
			Model:       c.config.Model,
			Messages:    messages,
			MaxTokens:   c.config.MaxTokens,
			Temperature: c.config.Temperature,
			TopP:        c.config.TopP,
			Stream:      true,
		}
	case ProviderOpenAI:
		apiURL = "https://api.openai.com/v1/chat/completions"
		if c.config.BaseURL != "" {
			apiURL = c.config.BaseURL
		}
		requestBody = LLMRequest{
			Model:       c.config.Model,
			Messages:    messages,
			MaxTokens:   c.config.MaxTokens,
			Temperature: c.config.Temperature,
			TopP:        c.config.TopP,
			Stream:      true,
		}
	default:
		return nil, fmt.Errorf("不支持的LLM提供商: %s", c.config.Provider)
	}

	// 序列化请求体
	jsonData, err := json.Marshal(requestBody)
	if err != nil {
		return nil, fmt.Errorf("序列化请求失败: %v", err)
	}
	fmt.Printf("[LLMClient] 请求准备 - URL: %s, 模型: %s, 消息数: %d, 大小: %dbytes, 参数: MaxTokens=%d, Temperature=%.2f, TopP=%.2f\n",
		apiURL, requestBody.Model, len(messages), len(jsonData), requestBody.MaxTokens, requestBody.Temperature, requestBody.TopP)

	// 创建HTTP请求
	req, err := http.NewRequest("POST", apiURL, bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, fmt.Errorf("创建请求失败: %v", err)
	}
	// 设置请求头
	req.Header.Set("Content-Type", "application/json")
	if c.config.Provider == ProviderZhipuAI {
		// 智谱AI使用Authorization Bearer格式
		req.Header.Set("Authorization", "Bearer "+c.config.APIKey)
	} else {
		// OpenAI也使用Authorization Bearer格式
		req.Header.Set("Authorization", "Bearer "+c.config.APIKey)
	}

	// 发送请求
	resp, err := c.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("请求失败: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		bodyStr := string(body)
		if len(bodyStr) > 200 {
			bodyStr = bodyStr[:200] + "..."
		}
		fmt.Printf("[LLMClient] API请求失败 - HTTP %d, 响应: %s\n", resp.StatusCode, bodyStr)
		return nil, fmt.Errorf("API请求失败: HTTP %d, %s", resp.StatusCode, string(body))
	}

	// 读取流式响应（SSE格式）
	var fullContent strings.Builder
	var thinking strings.Builder
	inActionPhase := false
	buffer := ""

	// 使用bufio.Scanner逐行读取SSE格式的响应
	scanner := bufio.NewScanner(resp.Body)
	chunkCount := 0

	for scanner.Scan() {
		line := scanner.Text()
		line = strings.TrimSpace(line)

		// 跳过空行
		if line == "" {
			continue
		}

		// 检查是否是SSE格式的data行
		if strings.HasPrefix(line, "data: ") {
			dataStr := strings.TrimPrefix(line, "data: ")

			// 检查是否是结束标记
			if dataStr == "[DONE]" {
				break
			}

			// 解析JSON数据
			var chunk LLMResponseChunk
			if err := json.Unmarshal([]byte(dataStr), &chunk); err != nil {
				continue
			}

			// 处理chunk内容
			if len(chunk.Choices) > 0 && chunk.Choices[0].Delta.Content != "" {
				chunkCount++
				content := chunk.Choices[0].Delta.Content
				fullContent.WriteString(content)

				if !inActionPhase {
					buffer += content
					// 检查是否进入action阶段
					markerFound := false

					if strings.Contains(buffer, "finish(message=") {
						// 找到finish标记
						parts := strings.SplitN(buffer, "finish(message=", 2)
						thinking.WriteString(parts[0])
						inActionPhase = true
						markerFound = true
					} else if strings.Contains(buffer, "do(action=") {
						// 找到do标记
						parts := strings.SplitN(buffer, "do(action=", 2)
						thinking.WriteString(parts[0])
						inActionPhase = true
						markerFound = true
					}

					if !markerFound {
						// 检查buffer是否以marker的前缀结尾，如果是则不输出（等待更多内容）
						isPotentialMarker := false
						for _, marker := range []string{"finish(message=", "do(action="} {
							for i := 1; i < len(marker); i++ {
								if strings.HasSuffix(buffer, marker[:i]) {
									isPotentialMarker = true
									break
								}
							}
							if isPotentialMarker {
								break
							}
						}

						if !isPotentialMarker {
							// 安全地输出buffer内容并发送到前端
							if onChunk != nil {
								onChunk(&StreamChunk{
									Type:       "thinking",
									Content:    buffer,
									IsComplete: false,
								})
							}
							thinking.WriteString(buffer)
							buffer = ""
						}
					}
				} else {
					// 发送action块
					if onChunk != nil {
						onChunk(&StreamChunk{
							Type:       "action",
							Content:    content,
							IsComplete: false,
						})
					}
				}
			}
		}
	}

	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("读取流式响应时出错: %v", err)
	}

	// 发送完成标记
	if onChunk != nil {
		onChunk(&StreamChunk{
			Type:       "action",
			Content:    "",
			IsComplete: true,
		})
	}

	// 解析响应
	thinkingStr := thinking.String()
	actionStr := fullContent.String()

	actionType := "none"
	// 如果包含action标记，提取action部分
	if strings.Contains(fullContent.String(), "finish(message=") {
		parts := strings.SplitN(fullContent.String(), "finish(message=", 2)
		if len(parts) == 2 {
			thinkingStr = strings.TrimSpace(parts[0])
			actionStr = "finish(message=" + parts[1]
			actionType = "finish"
		}
	} else if strings.Contains(fullContent.String(), "do(action=") {
		parts := strings.SplitN(fullContent.String(), "do(action=", 2)
		if len(parts) == 2 {
			thinkingStr = strings.TrimSpace(parts[0])
			actionStr = "do(action=" + parts[1]
			actionType = "do"
		}
	}

	// 如果thinking为空但fullContent有内容，说明可能没有明确的标记，将全部内容作为thinking
	if thinkingStr == "" && fullContent.Len() > 0 {
		thinkingStr = fullContent.String()
		actionType = "thinking_only"
	}

	// 完整日志输出（不截断）
	fmt.Printf("[LLMClient] 解析完成 - 类型: %s\n", actionType)
	fmt.Printf("[LLMClient] Thinking内容 (%d字符):\n%s\n", len(thinkingStr), thinkingStr)
	fmt.Printf("[LLMClient] Action内容 (%d字符):\n%s\n", len(actionStr), actionStr)

	return &LLMResponse{
		Thinking: thinkingStr,
		Action:   actionStr,
	}, nil
}
