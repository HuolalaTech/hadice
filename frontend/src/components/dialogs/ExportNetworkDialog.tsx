import React, { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { Download, FolderOpen } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  loadExportConfig,
  saveExportConfig,
  exportNetworkRequests,
  openFileInSystem,
  type ExportFormat,
  type ExportContentConfig
} from '@/lib/networkExport'
import * as App from '../../../bindings/Hadice/backend/appservice'
import type { NetworkRequest } from '@/types/hdc'

interface ExportNetworkDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedRequests: NetworkRequest[]
  platform: 'android' | 'harmony'
  processName: string
}

const FORMAT_OPTIONS: Array<{ value: ExportFormat; label: string; desc: string }> = [
  { value: 'csv', label: 'CSV', desc: '表格格式，可用 Excel / Numbers 打开' },
  { value: 'json', label: 'JSON', desc: '结构化数据，方便程序处理' },
  { value: 'har', label: 'HAR', desc: 'HTTP Archive 标准格式' }
]

const CONTENT_OPTIONS: Array<{ key: keyof ExportContentConfig; label: string; desc: string }> = [
  { key: 'requestUrl', label: '请求 URL', desc: '请求的完整 URL 地址' },
  { key: 'requestHeaders', label: '请求 Headers', desc: 'Content-Type, Authorization, Accept 等' },
  { key: 'requestBody', label: '请求 Body', desc: 'POST / PUT / PATCH 的请求体' },
  { key: 'responseHeaders', label: '响应 Headers', desc: 'Content-Type, Set-Cookie, Cache-Control 等' },
  { key: 'responseBody', label: '响应 Body', desc: 'API 返回的响应数据' }
]

export function ExportNetworkDialog({
  open,
  onOpenChange,
  selectedRequests,
  platform,
  processName
}: ExportNetworkDialogProps): React.JSX.Element {
  const [format, setFormat] = useState<ExportFormat>('csv')
  const [content, setContent] = useState<ExportContentConfig>({
    requestUrl: true,
    requestHeaders: false,
    requestBody: false,
    responseHeaders: false,
    responseBody: true
  })
  const [exporting, setExporting] = useState(false)
  const [exportDir, setExportDir] = useState('')

  useEffect(() => {
    if (open) {
      const saved = loadExportConfig()
      setFormat(saved.format)
      setContent(saved.content)
      App.GetHadiceOutputDirectory('network').then(setExportDir).catch(() => setExportDir(''))
    }
  }, [open])

  const handleContentChange = useCallback(
    (key: keyof ExportContentConfig, checked: boolean) => {
      setContent((prev) => ({ ...prev, [key]: checked }))
    },
    []
  )

  const handleExport = useCallback(async () => {
    if (exporting) return

    if (selectedRequests.length === 0) {
      toast.warning('请先在列表中勾选需要导出的请求')
      return
    }

    const config = { format, content }
    saveExportConfig(config)

    setExporting(true)
    try {
      const result = await exportNetworkRequests(selectedRequests, config, platform, processName)
      if (result.success && result.filePath) {
        const dirPath = result.filePath.replace(/[\\/][^\\/]+$/, '')
        toast.success(`已导出 ${selectedRequests.length} 个网络请求`, {
          description: result.filePath,
          action: {
            label: '打开文件夹',
            onClick: () => openFileInSystem(dirPath)
          },
          duration: 8000
        })
        onOpenChange(false)
      } else {
        toast.error(result.error || '导出失败')
      }
    } catch (error) {
      toast.error(`导出失败: ${error instanceof Error ? error.message : '未知错误'}`)
    } finally {
      setExporting(false)
    }
  }, [selectedRequests, format, content, exporting, onOpenChange, platform, processName])

  const handleCancel = useCallback(() => {
    saveExportConfig({ format, content })
    onOpenChange(false)
  }, [format, content, onOpenChange])

  const hasValidContent =
    content.requestUrl ||
    content.requestHeaders ||
    content.requestBody ||
    content.responseHeaders ||
    content.responseBody

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            导出网络请求
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* 导出格式 */}
          <fieldset>
            <legend className="text-sm font-medium mb-2.5">导出格式</legend>
            <div className="grid grid-cols-3 gap-2">
              {FORMAT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setFormat(opt.value)}
                  className={`flex flex-col items-center gap-1 rounded-md border px-3 py-2.5 text-center transition-colors ${
                    format === opt.value
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border hover:bg-secondary/50'
                  }`}
                  title={opt.desc}
                >
                  <span className="text-sm font-semibold">{opt.label}</span>
                  <span className="text-[10px] text-muted-foreground leading-tight">{opt.desc}</span>
                </button>
              ))}
            </div>
          </fieldset>

          {/* 导出内容 */}
          <fieldset>
            <legend className="text-sm font-medium mb-2.5">导出内容</legend>
            <div className="space-y-2.5">
              {CONTENT_OPTIONS.map((opt) => (
                <label
                  key={opt.key}
                  htmlFor={`export-${opt.key}`}
                  className="flex items-start gap-3 rounded-md border border-border px-3 py-2.5 cursor-pointer hover:bg-secondary/30 transition-colors has-[:checked]:border-primary/40 has-[:checked]:bg-primary/5"
                >
                  <Checkbox
                    id={`export-${opt.key}`}
                    checked={content[opt.key]}
                    onCheckedChange={(checked) => handleContentChange(opt.key, checked === true)}
                    className="mt-0.5 h-4 w-4"
                  />
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{opt.label}</div>
                    <div className="text-xs text-muted-foreground">{opt.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </fieldset>

          {/* 导出路径提示 */}
          <div className="flex items-center gap-2 rounded-md bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
            <FolderOpen className="h-3.5 w-3.5 flex-shrink-0" />
            <span>
              文件将保存至：
              {exportDir ? (
                <button
                  type="button"
                  className="font-mono text-primary hover:underline cursor-pointer"
                  onClick={() => App.OpenFolder(exportDir).catch(console.error)}
                >
                  {exportDir}{exportDir.endsWith('/') || exportDir.endsWith('\\') ? '' : '/'}
                </button>
              ) : (
                <span className="font-mono">~/Documents/Hadice/network/</span>
              )}
            </span>
          </div>

          {!hasValidContent && (
            <p className="text-xs text-destructive">请至少选择一项导出内容</p>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={handleCancel}>
            取消
          </Button>
          <Button onClick={handleExport} disabled={!hasValidContent || exporting} className="gap-2">
            {exporting ? (
              <>导出中...</>
            ) : (
              <>
                <Download className="h-4 w-4" />
                导出 {selectedRequests.length} 个请求
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
