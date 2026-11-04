/**
 * PhoneAgent配置状态管理
 */

import { create } from 'zustand'
import {
  DEFAULT_LLM_PROVIDER,
  DEFAULT_ZHIPU_MODEL,
  getProviderPreset,
} from '@/modules/phoneAgent/providers'
import type { LLMConfig, LLMProvider } from '@/modules/phoneAgent/types'

interface PhoneAgentConfigState {
  llmConfig: LLMConfig
  maxSteps: number
  language: string
  providerModels: Partial<Record<LLMProvider, string[]>>
  providerKeys: Partial<Record<LLMProvider, string>>
  providerLastModel: Partial<Record<LLMProvider, string>>
  providerBaseURLs: Partial<Record<LLMProvider, string>>

  // Actions
  setLLMConfig: (config: LLMConfig) => void
  setProviderModels: (provider: LLMProvider, models: string[]) => void
  setProviderKey: (provider: LLMProvider, apiKey: string) => void
  setMaxSteps: (steps: number) => void
  setLanguage: (lang: string) => void
  resetToDefault: () => void
  loadFromStorage: () => void
  saveToStorage: () => void
}

export function providerKeyOf(
  provider: LLMProvider,
  keys: Partial<Record<LLMProvider, string>>,
): string {
  return (keys[provider] ?? '').trim()
}

// 默认配置：智谱优先，模型 autoglm-phone
const zhipuPreset = getProviderPreset(DEFAULT_LLM_PROVIDER)
const defaultLLMConfig: LLMConfig = {
  provider: DEFAULT_LLM_PROVIDER,
  apiKey: '',
  baseURL: zhipuPreset.baseURL,
  model: DEFAULT_ZHIPU_MODEL,
  maxTokens: 2048,
  effort: 'low',
}

const STORAGE_KEY = 'phoneAgent-config'

function migrateProviderKeys(config: {
  providerKeys?: Partial<Record<LLMProvider, string>>
  llmConfig?: LLMConfig
}): Partial<Record<LLMProvider, string>> {
  const keys = { ...(config.providerKeys || {}) }
  const provider = config.llmConfig?.provider
  const current = config.llmConfig?.apiKey?.trim()
  if (provider && current && !keys[provider]) {
    keys[provider] = current
  }
  return keys
}

/**
 * PhoneAgent配置Store
 */
export const usePhoneAgentConfigStore = create<PhoneAgentConfigState>((set, get) => ({
  llmConfig: { ...defaultLLMConfig },
  maxSteps: 100,
  language: 'cn',
  providerModels: {},
  providerKeys: {},
  providerLastModel: {},
  providerBaseURLs: {},

  setLLMConfig: (config) => {
    const provider = config.provider || get().llmConfig.provider
    set({
      llmConfig: config,
      providerKeys: {
        ...get().providerKeys,
        [provider]: config.apiKey.trim(),
      },
      providerLastModel: {
        ...get().providerLastModel,
        [provider]: config.model,
      },
      providerBaseURLs: {
        ...get().providerBaseURLs,
        [provider]: config.baseURL || '',
      },
    })
    get().saveToStorage()
  },

  setProviderModels: (provider, models) => {
    set({
      providerModels: {
        ...get().providerModels,
        [provider]: models,
      },
    })
    get().saveToStorage()
  },

  setProviderKey: (provider, apiKey) => {
    set({
      providerKeys: {
        ...get().providerKeys,
        [provider]: apiKey.trim(),
      },
    })
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
      providerModels: {},
      providerKeys: {},
      providerLastModel: {},
      providerBaseURLs: {},
    })
    get().saveToStorage()
  },

  loadFromStorage: () => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const config = JSON.parse(stored)
        const providerKeys = migrateProviderKeys(config)
        let llmConfig: LLMConfig = { ...defaultLLMConfig, ...(config.llmConfig || {}) }
        const zhipuKey = (providerKeys.zhipu || '').trim()
        // 智谱已配置 Key：若当前厂商无 Key，切回智谱；智谱且无模型时用 autoglm-phone
        if (zhipuKey) {
          const currentKey = providerKeyOf(llmConfig.provider || DEFAULT_LLM_PROVIDER, providerKeys)
          if (!currentKey) {
            llmConfig = {
              ...llmConfig,
              provider: 'zhipu',
              apiKey: zhipuKey,
              baseURL: llmConfig.baseURL || zhipuPreset.baseURL,
              model: llmConfig.model?.trim() || DEFAULT_ZHIPU_MODEL,
            }
          } else if (llmConfig.provider === 'zhipu') {
            llmConfig = {
              ...llmConfig,
              apiKey: llmConfig.apiKey?.trim() || zhipuKey,
              model: llmConfig.model?.trim() || DEFAULT_ZHIPU_MODEL,
            }
          }
        }
        const providerLastModel: Partial<Record<LLMProvider, string>> = {
          ...(config.providerLastModel || {}),
        }
        if (llmConfig.provider && llmConfig.model) {
          providerLastModel[llmConfig.provider] = llmConfig.model
        }
        if (zhipuKey && !providerLastModel.zhipu) {
          providerLastModel.zhipu = DEFAULT_ZHIPU_MODEL
        }
        set({
          llmConfig,
          maxSteps: config.maxSteps || 100,
          language: config.language || 'cn',
          providerModels: config.providerModels || {},
          providerKeys,
          providerLastModel,
          providerBaseURLs: {
            ...(config.providerBaseURLs || {}),
            ...(zhipuKey
              ? { zhipu: config.providerBaseURLs?.zhipu || zhipuPreset.baseURL }
              : {}),
          },
        })
      }
    } catch (error) {
      console.error('[PhoneAgentConfigStore] 加载配置失败:', error)
    }
  },

  saveToStorage: () => {
    try {
      const {
        llmConfig,
        maxSteps,
        language,
        providerModels,
        providerKeys,
        providerLastModel,
        providerBaseURLs,
      } = get()
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          llmConfig,
          maxSteps,
          language,
          providerModels,
          providerKeys,
          providerLastModel,
          providerBaseURLs,
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
