/**
 * PhoneAgent TypeScript核心类
 */

import { phoneAgentAPI } from '@/lib/phoneAgent-api/agent'
import { usePhoneAgentStore } from './store'
import type { AgentConfig, StepResult, StreamChunk, Action } from './types'
import { captureEvent, capturePostHogException } from '@/lib/posthog'

/**
 * 生成action的精简描述
 */
function generateActionSummary(action: Action): string {
  const actionType = action._metadata || action.action

  switch (actionType?.toLowerCase()) {
    case 'launch':
      return `Launch ${action.app || '应用'}`
    case 'tap':
    case 'click':
      if (action.element && Array.isArray(action.element)) {
        return `Tap (${action.element[0]}, ${action.element[1]})`
      }
      return 'Tap'
    case 'swipe':
      if (action.element && Array.isArray(action.element)) {
        return `Swipe (${action.element[0]}, ${action.element[1]})`
      }
      return 'Swipe'
    case 'type':
      return `Type ${action.text || ''}`
    case 'wait':
      return `Wait ${action.extra?.duration || ''}`
    case 'long press':
      if (action.element && Array.isArray(action.element)) {
        return `Long Press (${action.element[0]}, ${action.element[1]})`
      }
      return 'Long Press'
    case 'double tap':
      if (action.element && Array.isArray(action.element)) {
        return `Double Tap (${action.element[0]}, ${action.element[1]})`
      }
      return 'Double Tap'
    case 'back':
      return 'Back'
    case 'home':
      return 'Home'
    case 'finish':
      return `完成${action.message ? `: ${action.message.substring(0, 30)}` : ''}`
    default:
      return `${actionType} ${action.message || ''}`
  }
}

/**
 * PhoneAgent类
 * 管理AI自动化任务的执行
 */
export class PhoneAgent {
  private config: AgentConfig
  private sessionID: string | null = null
  private streamUnsubscribe: (() => void) | null = null
  private isExecuting = false
  private shouldStop = false

  constructor(config: AgentConfig) {
    this.config = config
  }

  /**
   * 启动Agent
   */
  async start(): Promise<void> {
    const store = usePhoneAgentStore.getState()

    if (store.isRunning) {
      throw new Error('Agent已经在运行中')
    }

    try {
      console.log('[PhoneAgent] 开始启动Agent，配置:', {
        deviceID: this.config.deviceID,
        maxSteps: this.config.maxSteps,
        model: this.config.llmConfig.model,
        provider: this.config.llmConfig.provider,
      })
      
      // 启动Agent
      const result = await phoneAgentAPI.start(this.config)
      console.log('[PhoneAgent] Agent启动成功，sessionID:', result.sessionID)
      this.sessionID = result.sessionID

      // 设置状态
      store.setSessionID(result.sessionID)
      store.setIsRunning(true)
      store.setStepCount(0)
      store.setError(null)

      // 监听流式响应
      this.setupStreamListener()
    } catch (error) {
      console.error('[PhoneAgent] 启动失败:', error)
      store.setError(error instanceof Error ? error.message : String(error))
      throw error
    }
  }

  /**
   * 执行任务
   */
  async run(task: string): Promise<void> {
    const store = usePhoneAgentStore.getState()

    // 如果sessionID不存在，尝试启动Agent
    if (!this.sessionID) {
      // 检查store中是否有sessionID（可能是从其他地方设置的）
      if (store.sessionID) {
        this.sessionID = store.sessionID
      } else {
        // 如果没有，先启动Agent
        await this.start()
      }
    }

    // 再次检查sessionID
    if (!this.sessionID) {
      throw new Error('Agent未启动，请先调用start()')
    }

    // 验证后端会话是否存在
    const status = await phoneAgentAPI.getStatus(this.sessionID)
    if (!status.exists) {
      // 会话不存在，重新启动
      this.sessionID = null
      await this.start()
      if (!this.sessionID) {
        throw new Error('Agent启动失败：未获取到会话ID')
      }
    }

    if (this.isExecuting) {
      throw new Error('任务正在执行中')
    }

    this.isExecuting = true
    this.shouldStop = false
    const taskStartTime = Date.now()
    store.setCurrentTask(task)
    captureEvent('ai task started', {
      model: this.config.llmConfig.model,
      provider: this.config.llmConfig.provider,
      max_steps: this.config.maxSteps,
      task_length: task.length,
    })

    // 添加用户消息
    store.addMessage({
      type: 'user',
      content: task,
    })

    // 创建助手消息并保存其ID
    let assistantMessageId: string | null = null

    try {
      // 执行第一步
      let isFirst = true
      let stepResult: StepResult | null = null

      console.log('[PhoneAgent] 开始执行任务，最大步数:', this.config.maxSteps)

      while (!stepResult?.finished && store.stepCount < this.config.maxSteps && !this.shouldStop) {
        console.log(`[PhoneAgent] 执行第 ${store.stepCount + 1} 步，isFirst: ${isFirst}`)
        
        // 第一步时创建助手消息
        if (isFirst && !assistantMessageId) {
          assistantMessageId = store.addMessage({
            type: 'assistant',
            content: '',
            steps: [],
            isStreaming: true,
            stepCount: 0,
            maxSteps: this.config.maxSteps,
          })
          console.log('[PhoneAgent] 创建助手消息:', assistantMessageId)
        }
        
        // 执行步骤
        stepResult = await phoneAgentAPI.executeStep(this.sessionID, task, isFirst)
        console.log('[PhoneAgent] executeStep 返回结果:', {
          success: stepResult.success,
          finished: stepResult.finished,
          stepCount: stepResult.stepCount,
          hasThinking: !!stepResult.thinking,
          hasAction: !!stepResult.action,
          message: stepResult.message,
        })

        // 更新状态
        store.setStepCount(stepResult.stepCount)

        // 更新助手消息中的步骤和内容
        if (assistantMessageId) {
          if (stepResult.thinking) {
            // 添加thinking步骤 - 完整内容
            store.addExecutionStep(assistantMessageId, {
              type: 'thinking',
              content: stepResult.thinking,
            })
          }

          if (stepResult.action) {
            // 生成action的精简描述
            const actionSummary = generateActionSummary(stepResult.action)
            
            // 添加action步骤 - 精简描述 + 完整JSON内容
            const actionStr = JSON.stringify(stepResult.action, null, 2)
            store.addExecutionStep(assistantMessageId, {
              type: 'action',
              content: actionStr,
              actionSummary,
              result: stepResult.message, // 使用stepResult.message作为执行结果
            })
          }

          // 更新消息内容、action、步骤数和时间戳
          store.updateLastMessage({
            content: stepResult.message || '',
            action: stepResult.action || undefined,
            stepCount: stepResult.stepCount,
            timestamp: Date.now(),
          })
          console.log('[PhoneAgent] 更新消息内容 (%d字符):', (stepResult.message || '').length)
          console.log('[PhoneAgent] Thinking内容 (%d字符):', (stepResult.thinking || '').length)
          if (stepResult.action) {
            console.log('[PhoneAgent] Action内容:', stepResult.action)
          }
        }

        // 检查是否完成
        if (stepResult.finished) {
          console.log('[PhoneAgent] 任务已完成')
          if (assistantMessageId) {
            store.updateLastMessage({
              isStreaming: false,
              isFinished: true,
              stepCount: stepResult.stepCount,
            })
          }
          break
        }

        // 检查是否需要停止
        if (this.shouldStop) {
          console.log('[PhoneAgent] 收到停止信号，终止任务执行')
          if (assistantMessageId) {
            store.updateLastMessage({
              isStreaming: false,
            })
          }
          store.addMessage({
            type: 'error',
            content: '任务已停止',
          })
          break
        }

        // 等待一小段时间再执行下一步
        console.log('[PhoneAgent] 等待500ms后执行下一步...')
        await new Promise((resolve) => setTimeout(resolve, 500))
        isFirst = false
      }

      // 检查是否达到最大步数或被停止
      if (this.shouldStop) {
        console.log('[PhoneAgent] 任务已停止')
      } else if (store.stepCount >= this.config.maxSteps && !stepResult?.finished) {
        store.addMessage({
          type: 'error',
          content: `达到最大步数限制: ${this.config.maxSteps}`,
        })
      }
    } catch (error) {
      capturePostHogException(error, { feature: 'ai_automation', action: 'run_task' })
      const errorMsg = error instanceof Error ? error.message : String(error)
      const errorType = error instanceof Error ? error.constructor.name : 'UnknownError'
      captureEvent('ai task failed', {
        error_message: errorMsg,
        error_type: errorType,
        model: this.config.llmConfig.model,
        provider: this.config.llmConfig.provider,
        step_count: store.stepCount,
        task_length: task.length,
      })
      store.setError(error instanceof Error ? error.message : String(error))
      store.addMessage({
        type: 'error',
        content: error instanceof Error ? error.message : String(error),
      })
      throw error
    } finally {
      const durationMs = Date.now() - taskStartTime
      captureEvent('ai task completed', {
        step_count: store.stepCount,
        stopped_early: this.shouldStop,
        model: this.config.llmConfig.model,
        provider: this.config.llmConfig.provider,
        duration_ms: durationMs,
      })
      this.isExecuting = false
      // 标记流式处理结束
      if (assistantMessageId) {
        store.updateLastMessage({
          isStreaming: false,
        })
      }
      // 重置运行状态，但不清除sessionID，允许继续执行新任务
      store.setIsRunning(false)
      store.setCurrentTask(null)
    }
  }

  /**
   * 停止Agent
   */
  async stop(clearSession: boolean = true): Promise<void> {
    const store = usePhoneAgentStore.getState()

    console.log('[PhoneAgent] 停止Agent，sessionID:', this.sessionID, 'isExecuting:', this.isExecuting, 'clearSession:', clearSession)

    // 设置停止标志
    this.shouldStop = true

    if (!this.sessionID) {
      console.log('[PhoneAgent] 没有sessionID，直接重置状态')
      store.setIsRunning(false)
      this.isExecuting = false
      return
    }

    try {
      console.log('[PhoneAgent] 调用stop API...')
      await phoneAgentAPI.stop(this.sessionID)
      console.log('[PhoneAgent] stop API调用成功')
    } catch (error) {
      console.error('[PhoneAgent] stop failed:', error)
    } finally {
      // 清理
      if (this.streamUnsubscribe) {
        console.log('[PhoneAgent] 取消流式响应监听')
        this.streamUnsubscribe()
        this.streamUnsubscribe = null
      }

      // 重置状态
      console.log('[PhoneAgent] 重置状态')
      store.setIsRunning(false)
      store.setCurrentTask(null)
      // 只有在明确要求清除会话时才清除sessionID
      if (clearSession) {
        this.sessionID = null
      }
      this.isExecuting = false
      this.shouldStop = false
    }
  }

  /**
   * 设置流式响应监听器（可选的实时更新）
   */
  private setupStreamListener(): void {
    if (!this.sessionID) {
      return
    }

    this.streamUnsubscribe = phoneAgentAPI.onStream(this.sessionID, (chunk: StreamChunk) => {

    })
  }

  /**
   * 获取当前会话ID
   */
  getSessionID(): string | null {
    return this.sessionID
  }

  /**
   * 检查是否正在执行
   */
  isExecutingTask(): boolean {
    return this.isExecuting
  }
}
