package backend

import (
	"fmt"
	"sync"

	"Hadice/backend/phoneAgent"
)

var (
	// phoneAgentSessions 存储所有Agent会话
	phoneAgentSessions = make(map[string]*phoneAgent.Agent)
	phoneAgentMutex    sync.RWMutex
)

// StartPhoneAgent 启动PhoneAgent
// config: Agent配置
// 返回会话ID和错误
func (a *App) StartPhoneAgent(config phoneAgent.AgentConfig) (map[string]interface{}, error) {
	phoneAgentMutex.Lock()
	defer phoneAgentMutex.Unlock()

	// 检查设备连接
	if config.DeviceID == "" {
		return nil, fmt.Errorf("设备ID不能为空")
	}

	// 检查是否已有运行中的会话
	for _, agent := range phoneAgentSessions {
		if agent.IsRunning() && agent.GetSessionID() != "" {
			return nil, fmt.Errorf("设备 %s 已有运行中的任务，请等待完成或取消", config.DeviceID)
		}
	}

	// 创建Agent实例
	agent, err := phoneAgent.NewAgent(a.ctx, config)
	if err != nil {
		return nil, fmt.Errorf("创建Agent失败: %v", err)
	}

	sessionID := agent.GetSessionID()
	phoneAgentSessions[sessionID] = agent

	return map[string]interface{}{
		"sessionID": sessionID,
		"success":   true,
	}, nil
}

// ExecutePhoneAgentStep 执行Agent单步操作
// sessionID: 会话ID
// task: 任务描述（仅在第一步需要）
// isFirst: 是否是第一步
// 返回执行结果
func (a *App) ExecutePhoneAgentStep(sessionID string, task string, isFirst bool) (map[string]interface{}, error) {
	phoneAgentMutex.RLock()
	agent, exists := phoneAgentSessions[sessionID]
	phoneAgentMutex.RUnlock()

	if !exists {
		return nil, fmt.Errorf("会话不存在: %s", sessionID)
	}

	// 执行步骤
	result, err := agent.ExecuteStep(task, isFirst)
	if err != nil {
		return map[string]interface{}{
			"success":   false,
			"error":     err.Error(),
			"finished":  result != nil && result.Finished,
			"stepCount": result.StepCount,
		}, err
	}

	// 转换结果
	resultMap := map[string]interface{}{
		"success":   result.Success,
		"finished":  result.Finished,
		"thinking":  result.Thinking,
		"message":   result.Message,
		"stepCount": result.StepCount,
	}

	if result.Action != nil {
		resultMap["action"] = map[string]interface{}{
			"metadata": result.Action.Metadata,
			"action":   result.Action.Action,
			"element":  result.Action.Element,
			"text":     result.Action.Text,
			"app":      result.Action.App,
			"message":  result.Action.Message,
		}
	}

	return resultMap, nil
}

// StopPhoneAgent 停止PhoneAgent
// sessionID: 会话ID
func (a *App) StopPhoneAgent(sessionID string) (map[string]interface{}, error) {
	phoneAgentMutex.Lock()
	defer phoneAgentMutex.Unlock()

	agent, exists := phoneAgentSessions[sessionID]
	if !exists {
		return map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("会话不存在: %s", sessionID),
		}, nil
	}

	agent.SetRunning(false)
	delete(phoneAgentSessions, sessionID)

	return map[string]interface{}{
		"success": true,
		"message": "Agent已停止",
	}, nil
}

// GetPhoneAgentStatus 获取Agent状态
// sessionID: 会话ID
func (a *App) GetPhoneAgentStatus(sessionID string) (map[string]interface{}, error) {
	phoneAgentMutex.RLock()
	defer phoneAgentMutex.RUnlock()

	agent, exists := phoneAgentSessions[sessionID]
	if !exists {
		return map[string]interface{}{
			"exists": false,
		}, nil
	}

	return map[string]interface{}{
		"exists":   true,
		"running":  agent.IsRunning(),
		"sessionID": agent.GetSessionID(),
	}, nil
}
