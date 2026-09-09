/**
 * PhoneAgent 历史会话存储管理
 * 使用 localStorage 持久化历史对话记录
 */

import { create } from 'zustand'
import type { ChatHistorySession, ChatHistoryStorage, Message } from './types'

const STORAGE_KEY = 'phone-agent-chat-history'
const MAX_SESSIONS = 50 // 最大历史记录数量

/**
 * 格式化耗时显示
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}秒`
  }
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (remainingSeconds === 0) {
    return `${minutes}分`
  }
  return `${minutes}分${remainingSeconds}秒`
}

/**
 * 生成会话标题
 */
export function generateSessionTitle(messages: Message[]): string {
  const userMessage = messages.find((msg) => msg.type === 'user')
  if (!userMessage) {
    return '未命名会话'
  }
  return userMessage.content.trim()
}

/**
 * 序列化消息（移除不可序列化的属性）
 */
function serializeMessages(messages: Message[]): Message[] {
  return messages.map((msg) => ({
    id: msg.id,
    type: msg.type,
    content: msg.content,
    steps: msg.steps,
    action: msg.action,
    timestamp: msg.timestamp,
    isStreaming: false, // 序列化时取消流式状态
    stepCount: msg.stepCount,
    maxSteps: msg.maxSteps,
    isFinished: msg.isFinished,
  }))
}

interface ChatHistoryStore extends ChatHistoryStorage {
  // Actions
  loadFromStorage: () => void
  saveToStorage: () => void
  addSession: (session: Omit<ChatHistorySession, 'id' | 'createdAt' | 'updatedAt'>) => string
  deleteSession: (sessionId: string) => void
  getSession: (sessionId: string) => ChatHistorySession | null
  clearAll: () => void
  setCurrentSessionId: (sessionId: string | null) => void
}

const initialState: ChatHistoryStorage = {
  sessions: [],
  currentSessionId: null,
}

export const useChatHistoryStore = create<ChatHistoryStore>((set, get) => ({
  ...initialState,

  /**
   * 从 localStorage 加载历史记录
   */
  loadFromStorage: () => {
    try {
      const data = localStorage.getItem(STORAGE_KEY)
      if (data) {
        const parsed: ChatHistoryStorage = JSON.parse(data)
        set({
          sessions: parsed.sessions || [],
          currentSessionId: parsed.currentSessionId || null,
        })
      }
    } catch (error) {
      console.error('[ChatHistoryStore] Failed to load from storage:', error)
    }
  },

  /**
   * 保存到 localStorage
   */
  saveToStorage: () => {
    try {
      const state = get()
      const data: ChatHistoryStorage = {
        sessions: state.sessions,
        currentSessionId: state.currentSessionId,
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch (error) {
      console.error('[ChatHistoryStore] Failed to save to storage:', error)
    }
  },

  /**
   * 添加新的历史会话
   */
  addSession: (sessionData) => {
    const now = Date.now()
    const newSession: ChatHistorySession = {
      ...sessionData,
      id: `session_${now}_${Math.random().toString(36).substr(2, 9)}`,
      createdAt: now,
      updatedAt: now,
    }

    set((state) => {
      // 限制最大记录数量，删除最旧的
      let sessions = [...state.sessions, newSession]
      if (sessions.length > MAX_SESSIONS) {
        sessions = sessions.slice(-MAX_SESSIONS)
      }

      return { sessions }
    })

    get().saveToStorage()
    return newSession.id
  },

  /**
   * 删除指定的历史会话
   */
  deleteSession: (sessionId) => {
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== sessionId),
    }))
    get().saveToStorage()
  },

  /**
   * 获取指定的历史会话
   */
  getSession: (sessionId) => {
    const state = get()
    return state.sessions.find((s) => s.id === sessionId) || null
  },

  /**
   * 清空所有历史记录
   */
  clearAll: () => {
    set(initialState)
    get().saveToStorage()
  },

  /**
   * 设置当前选中的会话ID
   */
  setCurrentSessionId: (sessionId) => {
    set({ currentSessionId: sessionId })
    get().saveToStorage()
  },
}))

// 初始化时从 localStorage 加载数据
if (typeof window !== 'undefined') {
  useChatHistoryStore.getState().loadFromStorage()
}
