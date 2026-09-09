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
import { usePhoneAgentConfigStore } from '@/store/phoneAgentConfigStore'

interface LLMConfigDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * LLM配置对话框组件
 */
export function LLMConfigDialog({
  open,
  onOpenChange
}: LLMConfigDialogProps): React.JSX.Element {
  const { llmConfig, maxSteps, setLLMConfig, setMaxSteps, resetToDefault } =
    usePhoneAgentConfigStore()

  const [localConfig, setLocalConfig] = useState({
    baseURL: llmConfig.baseURL || '',
    apiKey: llmConfig.apiKey,
    model: llmConfig.model,
    maxTokens: llmConfig.maxTokens,
    maxSteps
  })

  // 当对话框打开时，同步配置
  useEffect(() => {
    if (open) {
      setLocalConfig({
        baseURL: llmConfig.baseURL || '',
        apiKey: llmConfig.apiKey,
        model: llmConfig.model,
        maxTokens: llmConfig.maxTokens,
        maxSteps
      })
    }
  }, [open, llmConfig, maxSteps])

  const handleSave = () => {
    setLLMConfig({
      provider: 'openai',
      apiKey: localConfig.apiKey,
      baseURL: localConfig.baseURL || undefined,
      model: localConfig.model,
      maxTokens: localConfig.maxTokens
    })
    setMaxSteps(localConfig.maxSteps)
    onOpenChange(false)
  }

  const handleReset = () => {
    resetToDefault()
    setLocalConfig({
      baseURL: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
      apiKey: '',
      model: 'autoglm-phone',
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
            配置AI自动化使用的LLM服务参数（OpenAI格式）
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* LLM BaseUrl */}
          <div className="space-y-2">
            <label htmlFor="baseURL" className="text-sm font-medium">
              LLM BaseUrl
            </label>
            <Input
              id="baseURL"
              value={localConfig.baseURL}
              onChange={(e) => setLocalConfig({ ...localConfig, baseURL: e.target.value })}
              placeholder="例如: https://api.openai.com/v1"
            />
            <p className="text-xs text-muted-foreground">
            </p>
          </div>

          {/* API密钥 */}
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
              API密钥将加密存储在本地，不会上传到服务器
            </p>
          </div>

          {/* 模型名称 */}
          <div className="space-y-2">
            <label htmlFor="model" className="text-sm font-medium">
              模型名称
            </label>
            <Input
              id="model"
              value={localConfig.model}
              onChange={(e) => setLocalConfig({ ...localConfig, model: e.target.value })}
              placeholder="例如: gpt-4o, gpt-4-turbo, gpt-4"
            />
            <p className="text-xs text-muted-foreground">
            </p>
          </div>

          {/* 最大Token数 */}
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

          {/* 最大执行步数 */}
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
          <Button onClick={handleSave}>保存配置</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
