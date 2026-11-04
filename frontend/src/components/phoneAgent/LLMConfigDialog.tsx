import React, { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { providerKeyOf, usePhoneAgentConfigStore } from '@/store/phoneAgentConfigStore'
import { ModelPicker } from './ModelPicker'
import {
  DEFAULT_LLM_PROVIDER,
  DEFAULT_ZHIPU_MODEL,
  getProviderModels,
  getProviderPreset,
  LLM_PROVIDER_PRESETS,
  preferZhipuDefaultModel,
} from '@/modules/phoneAgent/providers'
import { phoneAgentAPI } from '@/lib/phoneAgent-api/agent'
import type { LLMConfig, LLMProvider } from '@/modules/phoneAgent/types'

interface LLMConfigDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface LocalLLMForm {
  provider: LLMProvider
  baseURL: string
  apiKey: string
  model: string
  maxTokens: number
  maxSteps: number
}

function toLocalForm(
  llmConfig: LLMConfig,
  maxSteps: number,
  providerKeys: Partial<Record<LLMProvider, string>>
): LocalLLMForm {
  const provider = llmConfig.provider || DEFAULT_LLM_PROVIDER
  return {
    provider,
    baseURL: llmConfig.baseURL || '',
    apiKey: providerKeyOf(provider, providerKeys) || llmConfig.apiKey || '',
    model: llmConfig.model,
    maxTokens: llmConfig.maxTokens,
    maxSteps
  }
}

export function LLMConfigDialog({
  open,
  onOpenChange
}: LLMConfigDialogProps): React.JSX.Element {
  const {
    llmConfig,
    maxSteps,
    providerModels,
    providerKeys,
    setLLMConfig,
    setProviderKey,
    setProviderModels,
    setMaxSteps,
    resetToDefault
  } = usePhoneAgentConfigStore()

  const [localConfig, setLocalConfig] = useState<LocalLLMForm>(() =>
    toLocalForm(llmConfig, maxSteps, providerKeys)
  )
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    if (open) {
      setLocalConfig(toLocalForm(llmConfig, maxSteps, providerKeys))
    }
    // 只在打开时灌一次，避免换厂商写回 providerKeys 时把表单打回旧厂商
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const preset = getProviderPreset(localConfig.provider)
  const modelOptions = getProviderModels(
    localConfig.provider,
    providerModels[localConfig.provider]
  )
  const canSave = localConfig.apiKey.trim() !== '' && localConfig.model.trim() !== ''
  const canTest = localConfig.apiKey.trim() !== ''

  const handleProviderChange = (provider: LLMProvider) => {
    setProviderKey(localConfig.provider, localConfig.apiKey)
    const next = getProviderPreset(provider)
    const models = getProviderModels(provider, providerModels[provider])
    const nextKeys = {
      ...providerKeys,
      [localConfig.provider]: localConfig.apiKey.trim()
    }
    const nextModel =
      provider === 'zhipu'
        ? preferZhipuDefaultModel(models, next.model)
        : models.includes(next.model)
          ? next.model
          : models[0] || ''
    setLocalConfig({
      provider,
      baseURL: next.baseURL,
      apiKey: providerKeyOf(provider, nextKeys),
      model: nextModel,
      maxTokens: localConfig.maxTokens,
      maxSteps: localConfig.maxSteps
    })
  }

  const handleSave = () => {
    if (!canSave) return
    const model =
      localConfig.provider === 'zhipu'
        ? localConfig.model.trim() || DEFAULT_ZHIPU_MODEL
        : localConfig.model.trim()
    setLLMConfig({
      provider: localConfig.provider,
      apiKey: localConfig.apiKey.trim(),
      baseURL: localConfig.baseURL.trim() || undefined,
      model,
      maxTokens: localConfig.maxTokens
    })
    setMaxSteps(localConfig.maxSteps)
    onOpenChange(false)
  }

  const handleTest = async () => {
    if (!canTest || testing) return
    setTesting(true)
    try {
      const pingModel =
        localConfig.provider === 'zhipu'
          ? localConfig.model.trim() || DEFAULT_ZHIPU_MODEL
          : localConfig.model.trim() || preset.model
      const result = await phoneAgentAPI.testConnection({
        provider: localConfig.provider,
        apiKey: localConfig.apiKey.trim(),
        baseURL: localConfig.baseURL.trim() || undefined,
        model: pingModel,
        maxTokens: localConfig.maxTokens
      })
      if (result.success) {
        if (result.models.length > 0) {
          setProviderModels(localConfig.provider, result.models)
        }
        const merged = getProviderModels(localConfig.provider, result.models)
        if (localConfig.provider === 'zhipu') {
          // 智谱配置成功：默认模型固定为 autoglm-phone
          setLocalConfig((prev) => ({
            ...prev,
            model: preferZhipuDefaultModel(merged, DEFAULT_ZHIPU_MODEL),
          }))
        } else if (localConfig.model && !merged.includes(localConfig.model)) {
          setLocalConfig((prev) => ({ ...prev, model: merged[0] || prev.model }))
        }
        toast.success(result.message)
      } else {
        toast.error(result.message)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setTesting(false)
    }
  }

  const handleReset = () => {
    resetToDefault()
    const next = getProviderPreset(DEFAULT_LLM_PROVIDER)
    setLocalConfig({
      provider: next.id,
      baseURL: next.baseURL,
      apiKey: '',
      model: DEFAULT_ZHIPU_MODEL,
      maxTokens: 4096,
      maxSteps: 100
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>LLM服务配置</DialogTitle>
          <DialogDescription>
            选厂商，填 Key。手机 Agent 必须用能看截图的视觉模型。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <label htmlFor="provider" className="text-sm font-medium">
              厂商
            </label>
            <Select
              value={localConfig.provider}
              onValueChange={(value) => handleProviderChange(value as LLMProvider)}
            >
              <SelectTrigger id="provider" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LLM_PROVIDER_PRESETS.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{preset.hint}</p>
          </div>

          <div className="space-y-2">
            <label htmlFor="baseURL" className="text-sm font-medium">
              LLM BaseUrl
            </label>
            <Input
              id="baseURL"
              value={localConfig.baseURL}
              onChange={(e) => setLocalConfig({ ...localConfig, baseURL: e.target.value })}
              placeholder={preset.baseURL || 'https://api.example.com/v1'}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="apiKey" className="text-sm font-medium">
              API密钥
            </label>
            <Input
              id="apiKey"
              type="password"
              value={localConfig.apiKey}
              onChange={(e) => setLocalConfig({ ...localConfig, apiKey: e.target.value })}
              placeholder="请输入API密钥"
            />
            <p className="text-xs text-muted-foreground">
              只存在本机 localStorage。空 Key 无法启动 Agent。
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">模型</label>
            <ModelPicker
              value={localConfig.model}
              models={modelOptions}
              onChange={(model) => setLocalConfig({ ...localConfig, model })}
              placeholder="搜索或选择模型"
              placement="down"
            />
            <p className="text-xs text-muted-foreground">
              点测试连接拉取该厂商模型。列表只显示当前厂商。
            </p>
          </div>

          <div className="space-y-2">
            <label htmlFor="maxTokens" className="text-sm font-medium">
              最大Token数
            </label>
            <Input
              id="maxTokens"
              type="number"
              value={localConfig.maxTokens}
              onChange={(e) =>
                setLocalConfig({ ...localConfig, maxTokens: parseInt(e.target.value) || 4096 })
              }
              min={100}
              max={32000}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="maxSteps" className="text-sm font-medium">
              最大执行步数
            </label>
            <Input
              id="maxSteps"
              type="number"
              value={localConfig.maxSteps}
              onChange={(e) =>
                setLocalConfig({ ...localConfig, maxSteps: parseInt(e.target.value) || 100 })
              }
              min={1}
              max={1000}
            />
            <p className="text-xs text-muted-foreground">
              限制AI执行任务的最大步数，防止无限循环
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleReset}>
            重置为默认
          </Button>
          <Button variant="outline" onClick={handleTest} disabled={!canTest || testing}>
            {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            测试连接
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            保存配置
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
