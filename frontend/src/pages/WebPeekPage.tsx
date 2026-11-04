import React, { useCallback, useEffect, useState } from 'react'
import { ExternalLink, Loader2, PanelRightOpen, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { WindowToggleButton } from '@/components/layout/WindowToggleButton'
import { HelpToggleButton } from '@/components/layout/HelpToggleButton'
import { normalizeWebPeekUrl } from '@/lib/web-peek-url'
import { openSystemBrowser, openWebPeek } from '@/lib/open-web-peek'
import {
  WEB_PEEK_HISTORY_EVENT,
  WEB_PEEK_HISTORY_MAX,
  loadWebPeekHistory,
  saveWebPeekHistory
} from '@/lib/web-peek-history'

/**
 * 网页看看主面板：与其它主面板同款标题栏（独立窗口 / 帮助）。
 * 历史由 openWebPeek / openSystemBrowser 统一写入，任意入口可见。
 */
export function WebPeekPage(): React.JSX.Element {
  const [urlInput, setUrlInput] = useState('')
  const [history, setHistory] = useState(loadWebPeekHistory)
  const [opening, setOpening] = useState(false)
  const [openingExternal, setOpeningExternal] = useState(false)

  useEffect(() => {
    const onChanged = (): void => setHistory(loadWebPeekHistory())
    window.addEventListener(WEB_PEEK_HISTORY_EVENT, onChanged)
    return () => window.removeEventListener(WEB_PEEK_HISTORY_EVENT, onChanged)
  }, [])

  const openInAppWindow = useCallback(async (raw: string): Promise<void> => {
    const url = normalizeWebPeekUrl(raw)
    if (!url) {
      toast.error('请输入有效的 http/https 地址')
      return
    }
    setOpening(true)
    try {
      const ok = await openWebPeek(url)
      if (ok) {
        setUrlInput(url)
        setHistory(loadWebPeekHistory())
        toast.success('已在应用内网页窗口打开')
      }
    } finally {
      setOpening(false)
    }
  }, [])

  const openInSystemBrowser = useCallback(async (raw?: string): Promise<void> => {
    const url = normalizeWebPeekUrl(raw ?? urlInput)
    if (!url) {
      toast.error('请输入有效的 http/https 地址')
      return
    }
    setOpeningExternal(true)
    try {
      const ok = await openSystemBrowser(url)
      if (ok) {
        setUrlInput(url)
        setHistory(loadWebPeekHistory())
        toast.success('已在系统浏览器中打开')
      }
    } finally {
      setOpeningExternal(false)
    }
  }, [urlInput])

  const removeHistoryAt = useCallback((index: number): void => {
    setHistory((prev) => {
      const next = prev.filter((_, i) => i !== index)
      saveWebPeekHistory(next)
      return next
    })
  }, [])

  const clearHistory = useCallback((): void => {
    setHistory([])
    saveWebPeekHistory([])
    toast.message('已清空历史')
  }, [])

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-6">
      <h1 className="flex flex-shrink-0 items-center gap-3 text-2xl font-bold">
        <ExternalLink className="h-6 w-6 text-primary" />
        网页看看
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
          Beta
        </span>
        <WindowToggleButton />
        <HelpToggleButton />
      </h1>

      <form
        className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center"
        onSubmit={(e) => {
          e.preventDefault()
          void openInAppWindow(urlInput)
        }}
      >
        <div className="relative min-w-0 flex-1">
          <Input
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="输入网址，如 www.163.com 或 https://…"
            className="w-full pr-8 font-mono text-sm"
            autoComplete="off"
            spellCheck={false}
          />
          {urlInput.length > 0 && (
            <button
              type="button"
              title="清除"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground opacity-40 transition-opacity hover:opacity-100"
              onClick={() => setUrlInput('')}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <Button type="submit" disabled={opening || !urlInput.trim()} className="gap-2">
            {opening ? <Loader2 className="h-4 w-4 animate-spin" /> : <PanelRightOpen className="h-4 w-4" />}
            应用内打开
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={openingExternal || !urlInput.trim()}
            className="gap-2"
            title="用系统默认浏览器打开"
            onClick={() => void openInSystemBrowser()}
          >
            <ExternalLink className="h-4 w-4" />
            {openingExternal ? '打开中…' : '系统浏览器'}
          </Button>
        </div>
      </form>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card/40">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <span className="text-sm font-medium">最近打开</span>
          <span className="text-xs text-muted-foreground">
            {history.length}/{WEB_PEEK_HISTORY_MAX}
          </span>
          {history.length > 0 && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="ml-auto h-7 gap-1 text-xs text-muted-foreground"
              onClick={clearHistory}
            >
              <Trash2 className="h-3 w-3" />
              清空
            </Button>
          )}
        </div>
        {history.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
            <PanelRightOpen className="h-10 w-10 opacity-40" />
            <p>输入地址后点「应用内打开」，弹出内容窗（默认桌面）+ 右上角悬浮工具条</p>
            <p className="text-xs">抓包详情 / 右键 / WebView 列表打开的链接也会记入历史</p>
          </div>
        ) : (
          <ul className="min-h-0 flex-1 space-y-1 overflow-auto p-2">
            {history.map((item, i) => (
              <li
                key={`${item}-${i}`}
                className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-1.5 hover:bg-secondary/40"
              >
                <button
                  type="button"
                  title="应用内再次打开"
                  className="min-w-0 flex-1 truncate text-left font-mono text-xs hover:text-primary"
                  onClick={() => void openInAppWindow(item)}
                >
                  {item}
                </button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 shrink-0"
                  title="系统浏览器"
                  onClick={() => void openInSystemBrowser(item)}
                >
                  <ExternalLink className="h-3 w-3" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 shrink-0"
                  title="删除"
                  onClick={() => removeHistoryAt(i)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
