import type { LLMConfig, LLMEffort, LLMProvider } from './types'

export interface LLMProviderPreset {
  id: LLMProvider
  label: string
  baseURL: string
  model: string
  hint: string
}

/** 默认厂商 / 智谱默认模型（配置成功后回落） */
export const DEFAULT_LLM_PROVIDER: LLMProvider = 'zhipu'
export const DEFAULT_ZHIPU_MODEL = 'autoglm-phone'

export const LLM_PROVIDER_PRESETS: LLMProviderPreset[] = [
  {
    id: 'zhipu',
    label: '智谱',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    model: DEFAULT_ZHIPU_MODEL,
    hint: '默认手机 Agent 视觉模型',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseURL: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash-vision-exp',
    hint: '必须用视觉模型，deepseek-chat 看不见截图',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    hint: '需要能看图的模型，如 gpt-4o',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4o',
    hint: '一个 key 换厂商，模型名填 openai/gpt-4o 这种',
  },
  {
    id: 'custom',
    label: '自定义（OpenAI 兼容）',
    baseURL: '',
    model: '',
    hint: '硅基流动 / Ollama / 火山等，填 BaseURL + 模型名',
  },
]

export function getProviderPreset(id: LLMProvider): LLMProviderPreset {
  return (
    LLM_PROVIDER_PRESETS.find((item) => item.id === id) ??
    LLM_PROVIDER_PRESETS.find((item) => item.id === DEFAULT_LLM_PROVIDER) ??
    LLM_PROVIDER_PRESETS[0]
  )
}

const PROVIDER_MODELS: Record<LLMProvider, string[]> = {
  zhipu: [DEFAULT_ZHIPU_MODEL, 'glm-4.6v', 'glm-4v-plus'],
  deepseek: ['deepseek-v4-flash-vision-exp'],
  openai: ['gpt-4o', 'gpt-4.1'],
  openrouter: ['openai/gpt-4o', 'google/gemini-2.5-flash'],
  custom: [],
}

/** 智谱配置可用时，优先回落 autoglm-phone */
export function preferZhipuDefaultModel(models: string[], current?: string): string {
  if (models.includes(DEFAULT_ZHIPU_MODEL)) return DEFAULT_ZHIPU_MODEL
  if (current && models.includes(current)) return current
  return models[0] || DEFAULT_ZHIPU_MODEL
}

export function getFallbackModels(provider: LLMProvider): string[] {
  return [...(PROVIDER_MODELS[provider] ?? [])]
}

export const LLM_EFFORTS: Array<{ id: LLMEffort; label: string; maxTokens: number }> = [
  { id: 'low', label: 'Low', maxTokens: 2048 },
  { id: 'medium', label: 'Medium', maxTokens: 4096 },
  { id: 'high', label: 'High', maxTokens: 8192 },
  { id: 'extra-high', label: 'Extra High', maxTokens: 16384 },
]

export function getEffortPreset(effort?: LLMEffort) {
  return LLM_EFFORTS.find((item) => item.id === effort) ?? LLM_EFFORTS[0]
}

export function withEffort(config: LLMConfig, effort: LLMEffort): LLMConfig {
  return {
    ...config,
    effort,
    maxTokens: getEffortPreset(effort).maxTokens,
  }
}

/** 当前厂商保底模型 + 拉取结果，不混别家 */
export function getProviderModels(provider: LLMProvider, fetched?: string[]): string[] {
  const seen = new Set<string>()
  const models: string[] = []
  for (const id of [...getFallbackModels(provider), ...(fetched ?? [])]) {
    const name = id.trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    models.push(name)
  }
  return models
}
