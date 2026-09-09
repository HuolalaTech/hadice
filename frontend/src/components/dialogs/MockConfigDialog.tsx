import React, { useState, useEffect, useCallback, useRef } from 'react'
import CodeMirror, { EditorView } from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import { syntaxTree } from '@codemirror/language'
import { linter, type Diagnostic, type LintSource } from '@codemirror/lint'
import { Plus, Trash2, TestTube, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type { MockConfig, MockRule, MockResponseMode, MockReplaceRule } from '@/types/hdc'

interface MockConfigDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  config: MockConfig
  onConfigChange: (config: MockConfig) => void
  initialTestUrl?: string
}

/**
 * Mock 配置弹窗组件
 */
export function MockConfigDialog({
  open,
  onOpenChange,
  config,
  onConfigChange,
  initialTestUrl
}: MockConfigDialogProps): React.JSX.Element {
  const [localConfig, setLocalConfig] = useState<MockConfig>(config)
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null)
  const [isAdding, setIsAdding] = useState(false)
  const [testUrl, setTestUrl] = useState('')

  // 当弹窗打开时，同步配置（只在打开时同步，避免循环更新）
  useEffect(() => {
    if (open) {
      setLocalConfig(config)
      setSelectedRuleId(initialTestUrl && config.rules.length > 0 ? config.rules[config.rules.length - 1].id : null)
      setIsAdding(false)
      setTestUrl(initialTestUrl || '')
    }
  }, [open, initialTestUrl]) // 只在打开时同步，避免编辑中被外部配置覆盖

  // 当弹窗关闭时，重置状态
  useEffect(() => {
    if (!open) {
      setLocalConfig(config) // 关闭时同步一次，确保下次打开时是最新的配置
    }
  }, [open, config])

  // 生成下一个规则名称
  const getNextRuleName = useCallback((rules: MockRule[]): string => {
    const maxNum = rules.reduce((max, rule) => {
      const match = rule.name.match(/^规则(\d+)$/)
      if (match) {
        const num = parseInt(match[1], 10)
        return Math.max(max, num)
      }
      return max
    }, 0)
    return `规则${maxNum + 1}`
  }, [])

  // 生成规则ID
  const generateRuleId = (): string => {
    return `mock-rule-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }

  // 获取选中的规则
  const selectedRule = selectedRuleId
    ? localConfig.rules.find((r) => r.id === selectedRuleId)
    : null

  // 更新规则
  const updateRule = useCallback((ruleId: string, updates: Partial<MockRule>): void => {
    setLocalConfig((prev) => ({
      ...prev,
      rules: prev.rules.map((r) => (r.id === ruleId ? { ...r, ...updates } : r))
    }))
  }, [])

  // 添加新规则
  const handleAddRule = (): void => {
    const newRule: MockRule = {
      id: generateRuleId(),
      name: getNextRuleName(localConfig.rules),
      enabled: false,
      matchCondition: {
        urlPattern: '',
        urlRegex: false
      },
      responseMode: 'replace',
      responseConfig: {
        replaceRules: []
      }
    }
    setLocalConfig((prev) => ({
      ...prev,
      rules: [...prev.rules, newRule]
    }))
    setSelectedRuleId(newRule.id)
    setIsAdding(true)
  }

  // 删除规则
  const handleDeleteRule = (ruleId: string): void => {
    setLocalConfig((prev) => ({
      ...prev,
      rules: prev.rules.filter((r) => r.id !== ruleId)
    }))
    if (selectedRuleId === ruleId) {
      setSelectedRuleId(null)
      setIsAdding(false)
    }
  }

  // 切换规则启用状态
  const handleToggleRuleEnabled = (ruleId: string, enabled: boolean): void => {
    updateRule(ruleId, { enabled })
  }

  // 选择规则
  const handleSelectRule = (ruleId: string): void => {
    setSelectedRuleId(ruleId)
    setIsAdding(false)
  }

  // 测试 URL 匹配
  const handleTestUrlMatch = (urlPattern: string, urlRegex: boolean): void => {
    if (!testUrl.trim()) {
      toast.error('请输入测试 URL')
      return
    }
    if (!urlPattern.trim()) {
      toast.error('请输入 URL 匹配规则')
      return
    }

    try {
      const matches = urlRegex
        ? new RegExp(urlPattern).test(testUrl)
        : testUrl.includes(urlPattern)
      if (matches) {
        toast.success('URL 匹配成功')
      } else {
        toast.error('URL 不匹配')
      }
    } catch (error) {
      toast.error('正则表达式格式错误')
    }
  }

  // 保存配置
  const handleSave = (): void => {
    // 验证配置
    for (const rule of localConfig.rules) {
      if (!rule.matchCondition.urlPattern.trim()) {
        toast.error(`规则 "${rule.name}" 的 URL 匹配规则不能为空`)
        return
      }
      if (rule.responseMode === 'replace' && !rule.responseConfig.body) {
        toast.warning(`规则 "${rule.name}" 的响应体为空，将返回空响应`)
      }
    }

    // 计算 enabled 状态（至少有一个规则启用）
    const hasEnabledRule = localConfig.rules.some((r) => r.enabled)
    const finalConfig: MockConfig = {
      ...localConfig,
      enabled: hasEnabledRule,
      rules: localConfig.rules.map((rule) => ({
        ...rule,
        matchCondition: {
          ...rule.matchCondition,
          urlRegex: rule.matchCondition.urlRegex ?? false
        }
      }))
    }

    onConfigChange(finalConfig)
    toast.success('Mock 配置已保存')
    onOpenChange(false)
  }

  // 取消
  const handleCancel = (): void => {
    setLocalConfig(config)
    setSelectedRuleId(null)
    setIsAdding(false)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-[95vw] h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>HTTP Mock 配置</DialogTitle>
        </DialogHeader>

        <div className="flex-1 flex gap-3 min-h-0">
          {/* 左侧：规则列表 */}
          <div className="w-[32%] flex flex-col border-r pr-3">
            <ScrollArea className="flex-1">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[90px] whitespace-nowrap">启用</TableHead>
                    <TableHead className="w-[30%]">规则名</TableHead>
                    <TableHead className="w-[70%]">规则</TableHead>
                    <TableHead className="w-[60px] whitespace-nowrap">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {localConfig.rules.map((rule) => (
                    <TableRow
                      key={rule.id}
                      className={`cursor-pointer ${
                        selectedRuleId === rule.id ? 'bg-primary/10' : ''
                      }`}
                      onClick={() => handleSelectRule(rule.id)}
                    >
                      <TableCell className="w-[90px]" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={rule.enabled}
                          onCheckedChange={(checked) =>
                            handleToggleRuleEnabled(rule.id, checked === true)
                          }
                        />
                      </TableCell>
                      <TableCell className="w-[30%] font-mono text-xs break-words max-w-0" style={{ wordBreak: 'break-word', overflowWrap: 'break-word' }}>
                        <div className="break-words">{rule.name}</div>
                      </TableCell>
                      <TableCell className="w-[70%] font-mono text-xs break-words max-w-0" style={{ wordBreak: 'break-word', overflowWrap: 'break-word' }}>
                        <div className="break-words">{rule.matchCondition.urlPattern || '(空)'}</div>
                      </TableCell>
                      <TableCell className="w-[60px]" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => handleDeleteRule(rule.id)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow
                    className="cursor-pointer hover:bg-secondary/50"
                    onClick={handleAddRule}
                  >
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      <div className="flex items-center justify-center gap-2">
                        <Plus className="h-4 w-4" />
                        <span>增加 mock 规则</span>
                      </div>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </ScrollArea>
          </div>

          {/* 右侧：规则详情 */}
          <div className="flex-1 flex flex-col min-w-0">
            {selectedRule ? (
              <MockRuleDetail
                rule={selectedRule}
                isAdding={isAdding}
                testUrl={testUrl}
                onRuleChange={(updates) => updateRule(selectedRule.id, updates)}
                onTestUrlChange={setTestUrl}
                onTestUrlMatch={handleTestUrlMatch}
              />
            ) : (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <p className="text-sm">请选择一个规则查看详情</p>
                  <p className="text-xs mt-2">或点击左侧 "+ 增加 mock 规则" 添加新规则</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 底部按钮 */}
        <div className="flex justify-end gap-2 pt-3 border-t">
          <Button variant="outline" onClick={handleCancel}>
            取消
          </Button>
          <Button onClick={handleSave}>保存配置</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Mock 规则详情组件
 */
interface MockRuleDetailProps {
  rule: MockRule
  isAdding: boolean
  testUrl: string
  onRuleChange: (updates: Partial<MockRule>) => void
  onTestUrlChange: (url: string) => void
  onTestUrlMatch: (urlPattern: string, urlRegex: boolean) => void
}

function MockRuleDetail({
  rule,
  isAdding,
  testUrl,
  onRuleChange,
  onTestUrlChange,
  onTestUrlMatch
}: MockRuleDetailProps): React.JSX.Element {
  // 更新规则名称
  const handleNameChange = (name: string): void => {
    onRuleChange({ name })
  }

  // 更新 URL 匹配规则
  const handleUrlPatternChange = (urlPattern: string): void => {
    onRuleChange({
      matchCondition: {
        ...rule.matchCondition,
        urlPattern
      }
    })
  }

  const handleUrlRegexChange = (urlRegex: boolean): void => {
    onRuleChange({
      matchCondition: {
        ...rule.matchCondition,
        urlRegex
      }
    })
  }

  // 更新响应模式
  const handleResponseModeChange = (mode: MockResponseMode): void => {
    onRuleChange({ responseMode: mode })
  }

  // 更新替换模式配置
  const handleReplaceConfigChange = (updates: Partial<MockRule['responseConfig']>): void => {
    onRuleChange({
      responseConfig: {
        ...rule.responseConfig,
        ...updates
      }
    })
  }

  // 更新覆盖模式配置
  const handleOverrideConfigChange = (replaceRules: MockReplaceRule[]): void => {
    onRuleChange({
      responseConfig: {
        ...rule.responseConfig,
        replaceRules
      }
    })
  }

  // 添加替换规则
  const handleAddReplaceRule = (): void => {
    const newRule: MockReplaceRule = {
      id: `replace-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      pattern: '',
      replacement: ''
    }
    const currentRules = rule.responseConfig.replaceRules || []
    handleOverrideConfigChange([...currentRules, newRule])
  }

  // 删除替换规则
  const handleDeleteReplaceRule = (id: string): void => {
    const currentRules = rule.responseConfig.replaceRules || []
    handleOverrideConfigChange(currentRules.filter((r) => r.id !== id))
  }

  // 更新替换规则
  const handleUpdateReplaceRule = (id: string, updates: Partial<MockReplaceRule>): void => {
    const currentRules = rule.responseConfig.replaceRules || []
    handleOverrideConfigChange(
      currentRules.map((r) => (r.id === id ? { ...r, ...updates } : r))
    )
  }

  // 格式化 JSON
  const handleFormatJson = (): void => {
    try {
      const parsed = JSON.parse(rule.responseConfig.body || '{}')
      handleReplaceConfigChange({ body: JSON.stringify(parsed, null, 2) })
      toast.success('JSON 格式化成功')
    } catch {
      toast.error('JSON 格式错误，无法格式化')
    }
  }

  const isRegexMode = rule.matchCondition.urlRegex ?? false

  return (
    <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden">
      <div className="w-full max-w-full min-w-0 space-y-3 pr-3 overflow-x-hidden">
        <div className="flex items-center gap-2 min-w-0">
          <label className="text-sm font-medium whitespace-nowrap w-[130px]">规则名称:</label>
          <Input
            value={rule.name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="规则1"
            className="flex-1 min-w-0"
          />
        </div>

        <div className="border rounded-md p-3 bg-secondary/30 min-w-0 overflow-hidden">
          <div className="mb-2">
            <div className="flex items-center gap-2 min-w-0">
              <label className="text-sm font-medium whitespace-nowrap w-[160px]">URL匹配规则:</label>
              <div className="relative flex-1 min-w-0">
                <Input
                  value={rule.matchCondition.urlPattern}
                  onChange={(e) => handleUrlPatternChange(e.target.value)}
                  placeholder="https://test.api.com/path"
                  className="font-mono pr-20 min-w-0"
                />
                <label className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 text-xs text-muted-foreground cursor-pointer select-none whitespace-nowrap">
                  <Checkbox
                    id="url-regex-mode"
                    checked={isRegexMode}
                    onCheckedChange={(checked) => handleUrlRegexChange(checked === true)}
                    className="h-4 w-4"
                  />
                  正则
                </label>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <label className="text-sm font-medium whitespace-nowrap w-[160px]">测试URL:</label>
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <Input
                value={testUrl}
                onChange={(e) => onTestUrlChange(e.target.value)}
                placeholder="输入测试 URL"
                className="flex-1 min-w-0"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => onTestUrlMatch(rule.matchCondition.urlPattern, isRegexMode)}
                className="h-10 gap-2"
              >
                <TestTube className="h-4 w-4" />
                <span>测试</span>
              </Button>
            </div>
          </div>
        </div>

        <div className="border rounded-md p-3 bg-secondary/30 min-w-0 overflow-hidden">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-medium">响应配置</div>
          </div>
        {/* 暂时隐藏修改模式下拉菜单，默认使用替换模式
            <Select
              value={rule.responseMode}
              onValueChange={(value) => handleResponseModeChange(value as MockResponseMode)}
            >
              <SelectTrigger className="w-auto">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="replace">替换模式: 直接返回预设响应，不发送真实请求</SelectItem>
                <SelectItem value="override">覆盖模式: 发送真实请求，修改响应内容后返回</SelectItem>
              </SelectContent>
            </Select>
            */}
          {rule.responseMode === 'replace' ? (
            <ReplaceModeConfig
              config={rule.responseConfig}
              onConfigChange={handleReplaceConfigChange}
              onFormatJson={handleFormatJson}
            />
          ) : (
            <OverrideModeConfig
              replaceRules={rule.responseConfig.replaceRules || []}
              onReplaceRulesChange={handleOverrideConfigChange}
              onAddRule={handleAddReplaceRule}
              onDeleteRule={handleDeleteReplaceRule}
              onUpdateRule={handleUpdateReplaceRule}
            />
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * 替换模式配置组件
 */
interface ReplaceModeConfigProps {
  config: MockRule['responseConfig']
  onConfigChange: (updates: Partial<MockRule['responseConfig']>) => void
  onFormatJson: () => void
}

function ReplaceModeConfig({
  config,
  onConfigChange,
  onFormatJson
}: ReplaceModeConfigProps): React.JSX.Element {
  // 将 config.headers 转换为数组格式
  const headersFromConfig = React.useMemo(() => {
    if (!config.headers || Object.keys(config.headers).length === 0) {
      return [{ key: '', value: '' }]
    }
    return Object.entries(config.headers).map(([key, value]) => ({ key, value }))
  }, [config.headers])

  const [headers, setHeaders] = useState<Array<{ key: string; value: string }>>(headersFromConfig)
  const isInternalUpdateRef = useRef(false)

  // 当 config.headers 从外部变化时，同步到本地状态（排除内部更新）
  useEffect(() => {
    if (isInternalUpdateRef.current) {
      isInternalUpdateRef.current = false
      return
    }
    const configHeadersStr = JSON.stringify(headersFromConfig)
    const currentHeadersStr = JSON.stringify(headers)
    if (configHeadersStr !== currentHeadersStr) {
      setHeaders(headersFromConfig)
    }
  }, [headersFromConfig]) // 只依赖 headersFromConfig

  // 将 headers 数组转换为对象并更新 config（只在用户操作时调用）
  const updateHeadersConfig = useCallback((newHeaders: Array<{ key: string; value: string }>) => {
    isInternalUpdateRef.current = true
    const headersObj: Record<string, string> = {}
    newHeaders.forEach((h) => {
      if (h.key.trim()) {
        headersObj[h.key] = h.value
      }
    })
    onConfigChange({ headers: headersObj })
  }, [onConfigChange])

  const handleAddHeader = (): void => {
    const newHeaders = [...headers, { key: '', value: '' }]
    setHeaders(newHeaders)
    updateHeadersConfig(newHeaders)
  }

  const handleRemoveHeader = (index: number): void => {
    const newHeaders = headers.filter((_, i) => i !== index)
    setHeaders(newHeaders)
    updateHeadersConfig(newHeaders)
  }

  const handleHeaderChange = (index: number, field: 'key' | 'value', value: string): void => {
    const newHeaders = [...headers]
    newHeaders[index][field] = value
    setHeaders(newHeaders)
    updateHeadersConfig(newHeaders)
  }

  return (
    <div className="space-y-4 min-w-0">
      <div className="min-w-0">
        <label className="text-sm font-medium mb-2 block">Status Code (状态码):</label>
        <Input
          type="number"
          value={config.statusCode || 200}
          onChange={(e) =>
            onConfigChange({ statusCode: parseInt(e.target.value, 10) || 200 })
          }
          min={100}
          max={599}
        />
      </div>

      {/* 响应头 */}
      <div className="min-w-0">
        <label className="text-sm font-medium mb-2 block">Header (响应头):</label>
        <div className="space-y-2">
          <div className="max-h-[144px] overflow-y-auto pr-1 space-y-2 min-w-0">
            {headers.map((header, index) => (
              <div key={index} className="flex gap-2 min-w-0">
                <Input
                  value={header.key}
                  onChange={(e) => handleHeaderChange(index, 'key', e.target.value)}
                  placeholder="Header 名称"
                  className="flex-1 h-10 min-w-0"
                />
                <Input
                  value={header.value}
                  onChange={(e) => handleHeaderChange(index, 'value', e.target.value)}
                  placeholder="Header 值"
                  className="flex-1 h-10 min-w-0"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRemoveHeader(index)}
                  className="h-10 w-10 p-0"
                >
                  <XCircle className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={handleAddHeader}>
            <Plus className="h-4 w-4 mr-2" />
            添加响应头
          </Button>
        </div>
      </div>

      {/* 响应体 */}
      <div className="min-w-0 overflow-hidden">
        <label className="text-sm font-medium mb-2 block">Body (响应体):</label>
        <JsonBodyEditor
          value={config.body || ''}
          onChange={(e) => onConfigChange({ body: e.target.value })}
          className="h-[520px]"
        />
        <div className="flex gap-2 mt-2">
          <Button variant="outline" size="sm" onClick={onFormatJson}>
            格式化 JSON
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onConfigChange({ body: '' })}
          >
            清空
          </Button>
        </div>
      </div>
    </div>
  )
}

interface JsonBodyEditorProps {
  value: string
  onChange: (event: { target: { value: string } }) => void
  className?: string
}

function JsonBodyEditor({ value, onChange, className }: JsonBodyEditorProps): React.JSX.Element {
  const extensions = React.useMemo(() => [
    json(),
    linter(preciseJsonLinter()),
    jsonEditorOverflowTheme
  ], [])

  return (
    <div
      className={`min-w-0 overflow-hidden rounded-md border bg-[#1e1e1e] ${className || ''}`}
      style={{ width: '98%', maxWidth: '98%' }}
    >
      <CodeMirror
        value={value}
        height="100%"
        width="100%"
        maxWidth="100%"
        theme="dark"
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          highlightActiveLine: true,
          bracketMatching: true,
          closeBrackets: true,
          autocompletion: true
        }}
        extensions={extensions}
        onChange={(nextValue) => onChange({ target: { value: nextValue } })}
        placeholder='{"code": 200, "message": "Mock Response", "data": {}}'
        className="h-full w-full max-w-full min-w-0 text-xs"
      />
    </div>
  )
}

const jsonEditorOverflowTheme = EditorView.theme({
  '&': {
    width: '100%',
    maxWidth: '100%',
    minWidth: '0',
    overflow: 'hidden'
  },
  '.cm-editor': {
    width: '100%',
    maxWidth: '100%',
    minWidth: '0'
  },
  '& .cm-scroller': {
    maxWidth: '100%',
    overflowX: 'auto',
    overflowY: 'auto'
  },
  '& .cm-content': {
    width: 'fit-content',
    minWidth: '100%'
  },
  '& .cm-line': {
    whiteSpace: 'pre'
  }
})

function preciseJsonLinter(): LintSource {
  return (view): Diagnostic[] => {
    const text = view.state.doc.toString()
    if (!text.trim()) {
      return []
    }

    try {
      JSON.parse(text)
      return []
    } catch (error) {
      if (!(error instanceof SyntaxError)) {
        throw error
      }

      const nativePosition = getJsonParseErrorPosition(error.message, view.state.doc)
      const syntaxPosition = nativePosition ?? getJsonSyntaxErrorPosition(view.state)
      const from = Math.max(0, Math.min(syntaxPosition ?? 0, view.state.doc.length))
      const to = Math.min(Math.max(from + 1, from), view.state.doc.length)

      return [{
        from,
        to,
        message: error.message,
        severity: 'error'
      }]
    }
  }
}

function getJsonParseErrorPosition(message: string, doc: { length: number; line: (lineNumber: number) => { from: number } }): number | null {
  let match = message.match(/at position (\d+)/)
  if (match) {
    return Math.min(Number(match[1]), doc.length)
  }

  match = message.match(/at line (\d+) column (\d+)/)
  if (match) {
    const line = doc.line(Number(match[1]))
    return Math.min(line.from + Number(match[2]) - 1, doc.length)
  }

  return null
}

function getJsonSyntaxErrorPosition(state: Parameters<typeof syntaxTree>[0]): number | null {
  const cursor = syntaxTree(state).cursor()

  do {
    if (cursor.type.isError) {
      if (cursor.from !== cursor.to) {
        return cursor.from
      }
      return Math.max(0, Math.min(cursor.from, state.doc.length))
    }
  } while (cursor.next())

  return null
}

/**
 * 覆盖模式配置组件
 */
interface OverrideModeConfigProps {
  replaceRules: MockReplaceRule[]
  onReplaceRulesChange: (rules: MockReplaceRule[]) => void
  onAddRule: () => void
  onDeleteRule: (id: string) => void
  onUpdateRule: (id: string, updates: Partial<MockReplaceRule>) => void
}

function OverrideModeConfig({
  replaceRules,
  onAddRule,
  onDeleteRule,
  onUpdateRule
}: OverrideModeConfigProps): React.JSX.Element {
  const [testTexts, setTestTexts] = useState<Record<string, string>>({})

  const handleTestReplace = (rule: MockReplaceRule, testText: string): void => {
    if (!testText.trim()) {
      toast.error('请输入测试文本')
      return
    }
    if (!rule.pattern.trim()) {
      toast.error('请输入查找规则')
      return
    }

    try {
      const regex = new RegExp(rule.pattern, 'g')
      const result = testText.replace(regex, rule.replacement)
      toast.success('替换成功，请查看结果')
      // 可以显示结果，这里简化处理
    } catch {
      toast.error('正则表达式格式错误')
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-4">
        {replaceRules.map((rule, index) => (
          <div key={rule.id} className="border rounded-md p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">规则 #{index + 1}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onDeleteRule(rule.id)}
                className="h-8 w-8 p-0"
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-sm font-medium whitespace-nowrap w-[65px]">查找:</label>
              <Input
                value={rule.pattern}
                onChange={(e) => onUpdateRule(rule.id, { pattern: e.target.value })}
                placeholder='"status":\s*"success"'
                className="font-mono text-xs flex-1"
              />
            </div>

            <div className="flex items-center gap-2">
              <label className="text-sm font-medium whitespace-nowrap w-[65px]">替换:</label>
              <Input
                value={rule.replacement}
                onChange={(e) => onUpdateRule(rule.id, { replacement: e.target.value })}
                placeholder='"status": "mocked"'
                className="font-mono text-xs flex-1"
              />
            </div>

            <div className="flex items-start gap-2">
              <label className="text-sm font-medium whitespace-nowrap w-[65px] pt-2">测试文本:</label>
              <div className="flex-1 space-y-2">
                <Textarea
                  value={testTexts[rule.id] || ''}
                  onChange={(e) => setTestTexts({ ...testTexts, [rule.id]: e.target.value })}
                  placeholder='{"status": "success", "data": {}}'
                  className="font-mono text-xs min-h-[60px]"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleTestReplace(rule, testTexts[rule.id] || '')}
                >
                  <TestTube className="h-4 w-4 mr-2" />
                  测试替换
                </Button>
              </div>
            </div>
          </div>
        ))}

        <Button variant="outline" size="sm" onClick={onAddRule}>
          <Plus className="h-4 w-4 mr-2" />
          添加替换规则
        </Button>
      </div>

      <div className="text-xs text-muted-foreground mt-4">
        说明: 将按顺序执行所有替换规则
      </div>
    </div>
  )
}
