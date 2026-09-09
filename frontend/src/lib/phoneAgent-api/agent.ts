/**
 * PhoneAgent API 封装
 */

import * as App from '../../../bindings/Hadice/backend/appservice'
import { phoneAgent } from '../../../wailsjs/go/models'
import { EventsOn, EventsOff } from '../../../wailsjs/runtime/runtime'
import type { AgentConfig, StepResult, StreamChunk } from '@/modules/phoneAgent/types'

/**
 * PhoneAgent API
 */
export const phoneAgentAPI = {
  /**
   * 启动PhoneAgent
   */
  start: async (config: AgentConfig): Promise<{ sessionID: string; success: boolean }> => {
    try {
      // 使用Wails生成的类型创建配置对象
      const agentConfig = phoneAgent.AgentConfig.createFrom({
        maxSteps: config.maxSteps,
        deviceID: config.deviceID,
        platform: config.platform || 'harmonyos',
        llmConfig: phoneAgent.LLMConfig.createFrom({
          provider: config.llmConfig.provider,
          apiKey: config.llmConfig.apiKey,
          baseURL: config.llmConfig.baseURL || '',
          model: config.llmConfig.model,
          maxTokens: config.llmConfig.maxTokens,
          temperature: config.llmConfig.temperature !== undefined ? config.llmConfig.temperature : 0.0,
          topP: config.llmConfig.topP !== undefined ? config.llmConfig.topP : 0.85,
        }),
        language: config.language || 'cn',
        systemPrompt: config.systemPrompt || '',
      })
      
      const result = await App.StartPhoneAgent(agentConfig)
      return {
        sessionID: result.sessionID as string,
        success: result.success === true,
      }
    } catch (error) {
      console.error('[PhoneAgent API] start failed:', error)
      throw error
    }
  },

  /**
   * 执行Agent单步操作
   */
  executeStep: async (
    sessionID: string,
    task: string,
    isFirst: boolean,
  ): Promise<StepResult> => {
    try {
      const result = await App.ExecutePhoneAgentStep(sessionID, task, isFirst)
      return {
        success: result.success === true,
        finished: result.finished === true,
        action: result.action as StepResult['action'],
        thinking: (result.thinking as string) || '',
        message: result.message as string | undefined,
        stepCount: (result.stepCount as number) || 0,
      }
    } catch (error) {
      console.error('[PhoneAgent API] executeStep failed:', error)
      throw error
    }
  },

  /**
   * 停止PhoneAgent
   */
  stop: async (sessionID: string): Promise<{ success: boolean; message?: string }> => {
    try {
      const result = await App.StopPhoneAgent(sessionID)
      return {
        success: result.success === true,
        message: result.message as string | undefined,
      }
    } catch (error) {
      console.error('[PhoneAgent API] stop failed:', error)
      throw error
    }
  },

  /**
   * 获取Agent状态
   */
  getStatus: async (sessionID: string): Promise<{ exists: boolean; running?: boolean }> => {
    try {
      const result = await App.GetPhoneAgentStatus(sessionID)
      return {
        exists: result.exists === true,
        running: result.running as boolean | undefined,
      }
    } catch (error) {
      console.error('[PhoneAgent API] getStatus failed:', error)
      throw error
    }
  },

  /**
   * 监听流式响应事件
   */
  onStream: (
    sessionID: string,
    callback: (chunk: StreamChunk) => void,
  ): (() => void) => {
    const eventName = `phoneAgent:stream:${sessionID}`
    // EventsOn的回调函数接收可变参数，需要适配
    return EventsOn(eventName, (...data: any[]) => {
      if (data.length > 0 && data[0]) {
        callback(data[0] as StreamChunk)
      }
    })
  },

  /**
   * 取消监听流式响应事件
   */
  offStream: (sessionID: string, callback: (chunk: StreamChunk) => void): void => {
    const eventName = `phoneAgent:stream:${sessionID}`
    // EventsOff需要传入相同的回调函数引用
    // 由于我们包装了回调，这里简化处理：取消所有监听
    // 实际使用中应该保存回调引用
    EventsOff(eventName)
  },
}
