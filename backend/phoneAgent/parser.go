package phoneAgent

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// Parser 动作解析器接口 - 负责将LLM响应解析为结构化动作
type Parser interface {
	// Parse 解析动作字符串，返回结构化的Action
	Parse(actionStr string) (*Action, error)

	// ParseThinking 解析思考过程
	ParseThinking(thinkingStr string) (string, error)

	// ValidateAction 验证动作是否有效
	ValidateAction(action *Action) error
}

// HarmonyOSParser HarmonyOS平台的动作解析器实现
type HarmonyOSParser struct {
	// 支持的动作类型
	supportedActions map[string]bool
}

// NewHarmonyOSParser 创建HarmonyOS解析器
func NewHarmonyOSParser() *HarmonyOSParser {
	return &HarmonyOSParser{
		supportedActions: map[string]bool{
			"Launch":     true,
			"Tap":        true,
			"Type":       true,
			"Type_Name":  true,
			"Swipe":      true,
			"Back":       true,
			"Home":       true,
			"Wait":       true,
			"Long Press": true,
			"Double Tap": true,
			"Note":       true,
			"Call_API":   true,
			"Interact":   true,
			"Take_over":  true,
		},
	}
}

// Parse 解析LLM输出的动作字符串
// 支持两种格式：
// 1. 函数调用格式: do(action="Launch", app="xxx") 或 finish(message="xxx")
// 2. JSON格式: {"action": "Tap", "params": {"element": [500, 500]}}
func (p *HarmonyOSParser) Parse(actionStr string) (*Action, error) {
	actionStr = strings.TrimSpace(actionStr)

	if actionStr == "" {
		return nil, fmt.Errorf("action string is empty")
	}

	// 尝试作为JSON解析
	if strings.HasPrefix(strings.TrimSpace(actionStr), "{") {
		return p.parseJSON(actionStr)
	}

	// 解析函数调用格式
	return p.parseFunctionCall(actionStr)
}

// parseJSON 解析JSON格式的动作
func (p *HarmonyOSParser) parseJSON(actionStr string) (*Action, error) {
	var action Action
	if err := json.Unmarshal([]byte(actionStr), &action); err != nil {
		return nil, fmt.Errorf("failed to unmarshal JSON action: %w", err)
	}

	// 设置元数据
	if action.Metadata == "" {
		if action.Action == "" {
			action.Metadata = string(ActionTypeFinish)
		} else {
			action.Metadata = string(ActionTypeDo)
		}
	}

	return &action, nil
}

// parseFunctionCall 解析函数调用格式的动作
func (p *HarmonyOSParser) parseFunctionCall(actionStr string) (*Action, error) {
	// 处理 finish() 函数
	if strings.HasPrefix(actionStr, "finish") {
		return p.parseFinish(actionStr)
	}

	// 处理 do() 函数
	if strings.HasPrefix(actionStr, "do") {
		return p.parseDo(actionStr)
	}

	// 处理简化的函数调用格式，如 Launch("微信")
	return p.parseSimplifiedFormat(actionStr)
}

// parseFinish 解析finish函数调用
func (p *HarmonyOSParser) parseFinish(actionStr string) (*Action, error) {
	// 提取message参数: finish(message="xxx")
	messageStart := strings.Index(actionStr, `message="`)
	if messageStart == -1 {
		messageStart = strings.Index(actionStr, "message=")
		if messageStart == -1 {
			return nil, fmt.Errorf("finish() call missing message parameter")
		}
		messageStart += len("message=")
		messageEnd := strings.LastIndex(actionStr, ")")
		if messageEnd == -1 {
			return nil, fmt.Errorf("finish() call format error")
		}
		message := strings.Trim(actionStr[messageStart:messageEnd], `"`)
		return &Action{
			Metadata: string(ActionTypeFinish),
			Message:  message,
		}, nil
	}

	messageStart += len(`message="`)
	messageEnd := strings.Index(actionStr[messageStart:], `"`)
	if messageEnd == -1 {
		return nil, fmt.Errorf("finish() message parameter format error")
	}
	message := actionStr[messageStart : messageStart+messageEnd]

	return &Action{
		Metadata: string(ActionTypeFinish),
		Message:  message,
	}, nil
}

// parseDo 解析do函数调用
// 支持格式：do(action="Launch", app="xxx", element=[x,y], text="xxx", message="xxx")
func (p *HarmonyOSParser) parseDo(actionStr string) (*Action, error) {
	// 特殊处理Type和Type_Name操作
	if strings.Contains(actionStr, `action="Type"`) || strings.Contains(actionStr, `action="Type_Name"`) {
		return p.parseTypeAction(actionStr)
	}

	// 提取括号内的参数
	openParen := strings.Index(actionStr, "(")
	if openParen == -1 {
		return nil, fmt.Errorf("do() call missing opening parenthesis")
	}

	closeParen := p.findMatchingParen(actionStr, openParen)
	if closeParen == -1 {
		return nil, fmt.Errorf("do() call parentheses mismatch")
	}

	argsStr := actionStr[openParen+1 : closeParen]
	action := &Action{
		Metadata: string(ActionTypeDo),
		Extra:    make(map[string]interface{}),
	}

	// 解析参数
	if err := p.parseParameters(argsStr, action); err != nil {
		return nil, err
	}

	if action.Action == "" {
		return nil, fmt.Errorf("do() call missing required 'action' parameter")
	}

	return action, nil
}

// parseTypeAction 特殊处理Type和Type_Name操作
func (p *HarmonyOSParser) parseTypeAction(actionStr string) (*Action, error) {
	// 提取text参数: do(action="Type", text="xxx")
	textStart := strings.Index(actionStr, `text="`)
	if textStart == -1 {
		return nil, fmt.Errorf("Type action missing text parameter")
	}
	textStart += len(`text="`)
	textEnd := strings.Index(actionStr[textStart:], `"`)
	if textEnd == -1 {
		return nil, fmt.Errorf("Type action text parameter format error")
	}
	text := actionStr[textStart : textStart+textEnd]

	actionType := "Type"
	if strings.Contains(actionStr, "Type_Name") {
		actionType = "Type_Name"
	}

	return &Action{
		Metadata: string(ActionTypeDo),
		Action:   actionType,
		Text:     text,
		Extra:    make(map[string]interface{}),
	}, nil
}

// parseSimplifiedFormat 解析简化的函数调用格式
// 例如：Launch("微信") -> do(action="Launch", app="微信")
func (p *HarmonyOSParser) parseSimplifiedFormat(actionStr string) (*Action, error) {
	if !strings.Contains(actionStr, "(") || !strings.Contains(actionStr, ")") {
		return nil, fmt.Errorf("invalid action format: %s", actionStr)
	}

	openParen := strings.Index(actionStr, "(")
	funcName := strings.TrimSpace(actionStr[:openParen])

	// 检查是否是已知的动作名称
	if !p.supportedActions[funcName] {
		return nil, fmt.Errorf("unsupported action: %s", funcName)
	}

	// 尝试转换为do()格式并解析
	closeParen := strings.LastIndex(actionStr, ")")
	if closeParen == -1 {
		return nil, fmt.Errorf("malformed function call: missing closing parenthesis")
	}

	argsStr := actionStr[openParen+1 : closeParen]

	// 构建do()格式
	var converted string
	if funcName == "Launch" {
		appName := strings.Trim(argsStr, `"`)
		converted = fmt.Sprintf(`do(action="Launch", app="%s")`, appName)
	} else if funcName == "Tap" {
		// Tap可能有坐标参数
		converted = fmt.Sprintf(`do(action="Tap", element=%s)`, argsStr)
	} else {
		// 其他动作暂时不支持自动转换
		return nil, fmt.Errorf("auto-conversion not supported for action: %s", funcName)
	}

	// 递归解析转换后的格式
	return p.parseFunctionCall(converted)
}

// parseParameters 解析参数字符串
// 支持的格式：action="Launch", app="xxx", element=[x,y], text="xxx", message="xxx", duration="x seconds"
func (p *HarmonyOSParser) parseParameters(argsStr string, action *Action) error {
	// 移除空白
	argsStr = strings.ReplaceAll(argsStr, "\n", "")
	argsStr = strings.ReplaceAll(argsStr, "\t", "")

	// 分割参数（考虑引号和数组）
	parts := p.splitParameters(argsStr)

	for _, part := range parts {
		if part = strings.TrimSpace(part); part == "" {
			continue
		}

		eqIdx := strings.Index(part, "=")
		if eqIdx == -1 {
			continue
		}

		key := strings.TrimSpace(part[:eqIdx])
		valueStr := strings.TrimSpace(part[eqIdx+1:])

		// 解析值
		if err := p.parseValue(key, valueStr, action); err != nil {
			// 继续解析其他参数，不中断
			fmt.Printf("[HarmonyOSParser] Warning: failed to parse parameter %s=%s: %v\n", key, valueStr, err)
		}
	}

	return nil
}

// parseValue 解析单个参数值
func (p *HarmonyOSParser) parseValue(key, valueStr string, action *Action) error {
	// 字符串值
	if strings.HasPrefix(valueStr, `"`) && strings.HasSuffix(valueStr, `"`) {
		value := valueStr[1 : len(valueStr)-1]
		switch key {
		case "action":
			if !p.supportedActions[value] {
				return fmt.Errorf("unsupported action type: %s", value)
			}
			action.Action = value
		case "app":
			action.App = value
		case "text":
			action.Text = value
		case "message":
			action.Message = value
		case "duration":
			action.Message = value // Wait操作的duration存储在message字段
		}
		return nil
	}

	// 数组值: [500, 1000] 或 [[x1,y1], [x2,y2]]
	if strings.HasPrefix(valueStr, "[") && strings.HasSuffix(valueStr, "]") {
		return p.parseArrayValue(key, valueStr, action)
	}

	// 数值
	if num, err := strconv.Atoi(valueStr); err == nil {
		if action.Extra == nil {
			action.Extra = make(map[string]interface{})
		}
		action.Extra[key] = num
		return nil
	}

	// 其他类型
	return fmt.Errorf("unable to parse value type for %s=%s", key, valueStr)
}

// parseArrayValue 解析数组参数值
func (p *HarmonyOSParser) parseArrayValue(key, valueStr string, action *Action) error {
	arrayStr := valueStr[1 : len(valueStr)-1]

	// 检查是否是嵌套数组
	if strings.Contains(arrayStr, "[") {
		// 嵌套数组格式，如 [[x1,y1], [x2,y2]]
		switch key {
		case "start", "end":
			// 解析start和end参数（用于Swipe操作）
			coords, err := p.parseCoordinates(arrayStr)
			if err != nil {
				return err
			}
			if key == "start" && len(coords) >= 2 {
				action.Element = coords[:2]
			} else if key == "end" && len(coords) >= 2 {
				// 需要单独存储end坐标
				if action.Extra == nil {
					action.Extra = make(map[string]interface{})
				}
				action.Extra["end"] = coords[:2]
			}
		}
		return nil
	}

	// 简单数组格式: [500, 1000]
	elements := make([]int, 0)
	for _, elemStr := range strings.Split(arrayStr, ",") {
		elemStr = strings.TrimSpace(elemStr)
		if elem, err := strconv.Atoi(elemStr); err == nil {
			elements = append(elements, elem)
		}
	}

	switch key {
	case "element":
		action.Element = elements
	case "start":
		if len(elements) >= 2 {
			action.Element = elements[:2]
		}
	case "end":
		if action.Extra == nil {
			action.Extra = make(map[string]interface{})
		}
		if len(elements) >= 2 {
			action.Extra["end"] = elements[:2]
		}
	}

	return nil
}

// parseCoordinates 解析坐标数组
func (p *HarmonyOSParser) parseCoordinates(arrayStr string) ([]int, error) {
	coords := make([]int, 0)

	// 使用正则表达式提取所有数字对
	re := regexp.MustCompile(`\[\s*(\d+)\s*,\s*(\d+)\s*\]`)
	matches := re.FindAllStringSubmatch(arrayStr, -1)

	for _, match := range matches {
		if len(match) >= 3 {
			x, _ := strconv.Atoi(match[1])
			y, _ := strconv.Atoi(match[2])
			coords = append(coords, x, y)
		}
	}

	return coords, nil
}

// findMatchingParen 找到匹配的右括号
func (p *HarmonyOSParser) findMatchingParen(s string, start int) int {
	depth := 0
	for i := start; i < len(s); i++ {
		if s[i] == '(' {
			depth++
		} else if s[i] == ')' {
			depth--
			if depth == 0 {
				return i
			}
		}
	}
	return -1
}

// splitParameters 分割参数字符串（考虑引号和数组）
func (p *HarmonyOSParser) splitParameters(argsStr string) []string {
	var parts []string
	var current strings.Builder
	inString := false
	inArray := false
	depth := 0

	for i, r := range argsStr {
		switch r {
		case '"':
			if i == 0 || argsStr[i-1] != '\\' {
				inString = !inString
			}
			current.WriteRune(r)
		case '[':
			if !inString {
				inArray = true
				depth++
			}
			current.WriteRune(r)
		case ']':
			if !inString {
				depth--
				if depth == 0 {
					inArray = false
				}
			}
			current.WriteRune(r)
		case ',':
			if !inString && !inArray {
				parts = append(parts, current.String())
				current.Reset()
			} else {
				current.WriteRune(r)
			}
		default:
			current.WriteRune(r)
		}
	}

	if current.Len() > 0 {
		parts = append(parts, current.String())
	}

	return parts
}

// ParseThinking 解析思考过程
// 从<think>...</think>标签中提取思考内容
func (p *HarmonyOSParser) ParseThinking(thinkingStr string) (string, error) {
	// 移除<think>和</think>标签
	thinkingStr = strings.TrimSpace(thinkingStr)

	startTag := "<think>"
	endTag := "</think>"

	if strings.HasPrefix(thinkingStr, startTag) {
		startIdx := len(startTag)
		endIdx := strings.Index(thinkingStr, endTag)
		if endIdx != -1 {
			return strings.TrimSpace(thinkingStr[startIdx:endIdx]), nil
		}
	}

	return thinkingStr, nil
}

// ValidateAction 验证动作是否有效
func (p *HarmonyOSParser) ValidateAction(action *Action) error {
	if action == nil {
		return fmt.Errorf("action is nil")
	}

	if action.Metadata != string(ActionTypeFinish) && action.Metadata != string(ActionTypeDo) {
		return fmt.Errorf("invalid action metadata: %s", action.Metadata)
	}

	// 检查do类型的动作
	if action.Metadata == string(ActionTypeDo) {
		if action.Action == "" {
			return fmt.Errorf("do action missing action type")
		}

		if !p.supportedActions[action.Action] {
			return fmt.Errorf("unsupported action type: %s", action.Action)
		}

		// 检查特定动作的必需参数
		switch action.Action {
		case "Launch":
			if action.App == "" {
				return fmt.Errorf("Launch action missing app parameter")
			}
		case "Tap", "Long Press", "Double Tap":
			if len(action.Element) < 2 {
				return fmt.Errorf("%s action missing or invalid element parameter", action.Action)
			}
			// 检查坐标范围
			for _, coord := range action.Element {
				if coord < 0 || coord > 999 {
					return fmt.Errorf("coordinate out of range: %d (valid range: 0-999)", coord)
				}
			}
		case "Type", "Type_Name":
			if action.Text == "" {
				return fmt.Errorf("%s action missing text parameter", action.Action)
			}
		case "Swipe":
			if len(action.Element) < 2 {
				return fmt.Errorf("Swipe action missing start coordinates")
			}
			if action.Extra == nil {
				return fmt.Errorf("Swipe action missing end coordinates")
			}
			if end, ok := action.Extra["end"].([]int); !ok || len(end) < 2 {
				return fmt.Errorf("Swipe action missing valid end coordinates")
			}
		case "Wait":
			if action.Message == "" {
				return fmt.Errorf("Wait action missing duration parameter")
			}
		}
	}

	return nil
}
