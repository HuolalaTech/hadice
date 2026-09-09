package phoneAgent

// Prompts 提示词管理
// 注意: 实际的提示词已在 config_manager.go 中的 GetSystemPromptZH() 和 GetSystemPromptEN() 函数中定义
// 这个文件提供了对 AutoGLM-GUI prompts_zh.py 的参考和说明

/*
提示词来源于 AutoGLM-GUI/agents/glm/prompts_zh.py

该提示词包含以下核心内容:
1. 系统角色定义: 智能体分析专家
2. 输出格式要求: <think>{think}</think><answer>{action}</answer>
3. 操作指令定义: Launch, Tap, Type, Swipe, Back, Home, Wait, finish 等
4. 执行规则: 18条详细的执行规则，用于指导Agent行为

与原始 Open-AutoGLM 版本的主要差异:
- 日期格式: 使用 Go 的 time.Format 而不是 Python 的 strftime
- 内容基本一致，提供了完整的指令集和规则

为了支持多语言，提供了:
- GetSystemPromptZH(): 中文提示词
- GetSystemPromptEN(): 英文提示词

*/

// PromptConstants 提示词中的常量
type PromptConstants struct {
	CoordinateMin int
	CoordinateMax int
}

// GetPromptConstants 获取提示词中使用的坐标范围常量
func GetPromptConstants() PromptConstants {
	return PromptConstants{
		CoordinateMin: 0,
		CoordinateMax: 999,
	}
}
