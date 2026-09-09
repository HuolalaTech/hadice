/**
 * PhoneAgent Zustand状态管理
 */

import { create } from 'zustand'
import type { AgentState, Message, Action, ExecutionStep } from './types'

interface PhoneAgentStore extends AgentState {
  // Actions
  setSessionID: (sessionID: string | null) => void
  setIsRunning: (isRunning: boolean) => void
  setStepCount: (stepCount: number) => void
  setCurrentTask: (task: string | null) => void
  setMessages: (messages: Message[]) => void
  addMessage: (message: Omit<Message, 'id' | 'timestamp'>) => string
  updateLastMessage: (updates: Partial<Message>) => void
  addExecutionStep: (messageId: string, step: Omit<ExecutionStep, 'id' | 'timestamp'>) => void
  updateLastExecutionStep: (messageId: string, updates: Partial<ExecutionStep>) => void
  setError: (error: string | null) => void
  reset: () => void
}

const initialState: AgentState = {
  sessionID: null,
  isRunning: false,
  stepCount: 0,
  currentTask: null,
  messages: [],
  error: null,
}

export const usePhoneAgentStore = create<PhoneAgentStore>((set, get) => ({
  ...initialState,

  setSessionID: (sessionID) => set({ sessionID }),

  setIsRunning: (isRunning) => set({ isRunning }),

  setStepCount: (stepCount) => set({ stepCount }),

  setCurrentTask: (task) => set({ currentTask: task }),

  setMessages: (messages) => set({ messages }),

  addMessage: (message) => {
    const newMessage: Message = {
      ...message,
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
    }
    set((state) => ({
      messages: [...state.messages, newMessage],
    }))
    return newMessage.id
  },

  updateLastMessage: (updates) => {
    set((state) => {
      const messages = [...state.messages]
      if (messages.length > 0) {
        const lastMsg = messages[messages.length - 1]
        // 只有当最后一条消息是assistant消息时才更新
        if (lastMsg.type === 'assistant') {
          messages[messages.length - 1] = {
            ...lastMsg,
            ...updates,
          }
        }
      }
      return { messages }
    })
  },

  addExecutionStep: (messageId, step) => {
    set((state) => {
      const messages = state.messages.map((msg) => {
        if (msg.id === messageId && msg.type === 'assistant') {
          const newStep: ExecutionStep = {
            ...step,
            id: `step_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            timestamp: Date.now(),
          }
          return {
            ...msg,
            steps: [...(msg.steps || []), newStep],
          }
        }
        return msg
      })
      return { messages }
    })
  },

  updateLastExecutionStep: (messageId, updates) => {
    set((state) => {
      const messages = state.messages.map((msg) => {
        if (msg.id === messageId && msg.type === 'assistant' && msg.steps && msg.steps.length > 0) {
          const steps = [...msg.steps]
          steps[steps.length - 1] = {
            ...steps[steps.length - 1],
            ...updates,
          }
          return {
            ...msg,
            steps,
          }
        }
        return msg
      })
      return { messages }
    })
  },

  setError: (error) => set({ error }),

  reset: () => set(initialState),
}))
