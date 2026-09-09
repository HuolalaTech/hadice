/**
 * PhoneAgent配置状态管理
 */

import { create } from 'zustand'
import type { LLMConfig, LLMProvider } from '@/modules/phoneAgent/types'

interface PhoneAgentConfigState {
  llmConfig: LLMConfig
  maxSteps: number
  language: string

  // Actions
  setLLMConfig: (config: LLMConfig) => void
  setMaxSteps: (steps: number) => void
  setLanguage: (lang: string) => void
  resetToDefault: () => void
  loadFromStorage: () => void
  saveToStorage: () => void
}

// 默认配置（OpenAI格式）
const defaultLLMConfig: LLMConfig = {
  provider: 'openai',
  apiKey: '',
  baseURL: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
  model: 'autoglm-phone',
  maxTokens: 4096,
}

const STORAGE_KEY = 'phoneAgent-config'

/**
 * PhoneAgent配置Store
 */
export const usePhoneAgentConfigStore = create<PhoneAgentConfigState>((set, get) => ({
  llmConfig: { ...defaultLLMConfig },
  maxSteps: 100,
  language: 'cn',

  setLLMConfig: (config) => {
    set({ llmConfig: config })
    get().saveToStorage()
  },

  setMaxSteps: (steps) => {
    set({ maxSteps: steps })
    get().saveToStorage()
  },

  setLanguage: (lang) => {
    set({ language: lang })
    get().saveToStorage()
  },

  resetToDefault: () => {
    set({
      llmConfig: { ...defaultLLMConfig },
      maxSteps: 100,
      language: 'cn',
    })
    get().saveToStorage()
  },

  loadFromStorage: () => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const config = JSON.parse(stored)
        set({
          llmConfig: config.llmConfig || { ...defaultLLMConfig },
          maxSteps: config.maxSteps || 100,
          language: config.language || 'cn',
        })
      }
    } catch (error) {
      console.error('[PhoneAgentConfigStore] 加载配置失败:', error)
    }
  },

  saveToStorage: () => {
    try {
      const { llmConfig, maxSteps, language } = get()
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          llmConfig,
          maxSteps,
          language,
        }),
      )
    } catch (error) {
      console.error('[PhoneAgentConfigStore] 保存配置失败:', error)
    }
  },
}))

// 初始化时加载配置
if (typeof window !== 'undefined') {
  usePhoneAgentConfigStore.getState().loadFromStorage()
}
