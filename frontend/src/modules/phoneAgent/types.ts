/**
 * PhoneAgent 类型定义
 */

/**
 * LLM服务提供商
 */
export type LLMProvider = 'zhipu' | 'openai'

/**
 * LLM配置
 */
export interface LLMConfig {
  provider: LLMProvider
  apiKey: string
  baseURL?: string
  model: string
  maxTokens: number
  temperature?: number
  topP?: number
}

/**
 * Agent配置
 */
export interface AgentConfig {
  maxSteps: number
  deviceID: string
  platform?: string
  llmConfig: LLMConfig
  language?: string
  systemPrompt?: string
}

/**
 * 操作类型
 */
export type ActionType = 'finish' | 'do'

/**
 * 操作指令
 */
export interface Action {
  _metadata: ActionType
  action?: string
  element?: number[]
  text?: string
  app?: string
  message?: string
  extra?: Record<string, unknown>
}

/**
 * 操作执行结果
 */
export interface ActionResult {
  success: boolean
  shouldFinish: boolean
  message?: string
}

/**
 * 单步执行结果
 */
export interface StepResult {
  success: boolean
  finished: boolean
  action: Action | null
  thinking: string
  message?: string
  stepCount: number
}

/**
 * 截图数据
 */
export interface ScreenshotData {
  base64Data: string
  width: number
  height: number
}

/**
 * 设备状态
 */
export interface DeviceState {
  screenshot: ScreenshotData | null
  appInfo: AppInfo | null
}

/**
 * 应用信息
 */
export interface AppInfo {
  packageName: string
  appName: string
  activity?: string
}

/**
 * LLM响应
 */
export interface LLMResponse {
  thinking: string
  action: string
}

/**
 * 流式响应数据块
 */
export interface StreamChunk {
  type: 'thinking' | 'action'
  content: string
  isComplete: boolean
}

/**
 * Agent状态
 */
export interface AgentState {
  sessionID: string | null
  isRunning: boolean
  stepCount: number
  currentTask: string | null
  messages: Message[]
  error: string | null
}

/**
 * 消息类型
 */
export type MessageType = 'user' | 'assistant' | 'system' | 'error'

/**
 * 执行步骤类型
 */
export interface ExecutionStep {
  id: string
  type: 'thinking' | 'action'
  content: string
  timestamp: number
  /** 执行动作的精简描述（仅用于action类型），如：Launch 美团、Tap (145, 608)、Type 古茗 */
  actionSummary?: string
  /** 执行结果描述（仅用于action类型） */
  result?: string
}

/**
 * 消息
 */
export interface Message {
  id: string
  type: MessageType
  content: string
  steps?: ExecutionStep[]
  action?: Action
  timestamp: number
  isStreaming?: boolean
  /** 当前步数 */
  stepCount?: number
  /** 最大步数 */
  maxSteps?: number
  /** 任务是否已完成 */
  isFinished?: boolean
}

/**
 * 历史会话状态
 */
export type ChatSessionStatus = 'completed' | 'interrupted' | 'error'

/**
 * 历史会话记录
 */
export interface ChatHistorySession {
  /** 会话唯一ID */
  id: string
  /** 会话标题（取第一条用户消息，最多两行显示） */
  title: string
  /** 会话中的所有消息 */
  messages: Message[]
  /** 创建时间戳 */
  createdAt: number
  /** 更新时间戳 */
  updatedAt: number
  /** 会话状态 */
  status: ChatSessionStatus
  /** 步数统计 */
  stepCount: number
  /** 耗时（秒） */
  duration: number
}

/**
 * 历史会话存储格式
 */
export interface ChatHistoryStorage {
  /** 所有历史会话 */
  sessions: ChatHistorySession[]
  /** 当前选中的会话ID */
  currentSessionId: string | null
}
