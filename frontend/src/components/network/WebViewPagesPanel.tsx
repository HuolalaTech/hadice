import React, { useEffect, useMemo, useState } from 'react'
import { Copy, ExternalLink, Loader2, Pause, Play, RefreshCw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { copyTextToClipboard } from '@/lib/clipboard'
import { formatDateTime } from '@/lib/format'
import type { HarmonyWebViewPage } from '@/types/hdc'
import * as App from '../../../bindings/Hadice/backend/appservice.js'

export interface WebViewPagesTarget {
  pid: number
  packageName: string
}

interface WebViewPageRow extends HarmonyWebViewPage {
  seenAt: number
}

interface WebViewPagesPanelProps {
  deviceId: string
  deviceLabel?: string
  app: WebViewPagesTarget | null
  listPages: (deviceId: string, pid: number, packageName: string) => Promise<HarmonyWebViewPage[]>
}

const POLL_MS = 2000

function mergePages(prev: WebViewPageRow[], next: HarmonyWebViewPage[], now: number): WebViewPageRow[] {
  const prevById = new Map(prev.map((page) => [page.id, page]))
  return next.map((page) => {
    const old = prevById.get(page.id)
    return {
      ...page,
      seenAt: old?.seenAt ?? now
    }
  })
}

export function WebViewPagesPanel({
  deviceId,
  deviceLabel,
  app,
  listPages
}: WebViewPagesPanelProps): React.JSX.Element {
  const [pages, setPages] = useState<WebViewPageRow[]>([])
  const [filter, setFilter] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(true)

  const packageName = app?.packageName || ''
  const pid = app?.pid || 0
  const sourceDevice = deviceLabel || deviceId

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    async function poll(): Promise<void> {
      if (!deviceId || !app || pid <= 0) {
        if (!cancelled) {
          setPages([])
          setSelectedId(null)
          setError('')
          setLoading(false)
        }
        return
      }

      if (!cancelled) setLoading(true)
      try {
        const next = await listPages(deviceId, pid, packageName)
        if (cancelled) return
        const now = Date.now()
        setPages((prev) => mergePages(prev, next, now))
        setError('')
        setSelectedId((current) => {
          if (current && next.some((page) => page.id === current)) return current
          return next[0]?.id || null
        })
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
        }
      } finally {
        if (!cancelled) setLoading(false)
        if (!cancelled && autoRefresh) timer = setTimeout(poll, POLL_MS)
      }
    }

    void poll()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [app, autoRefresh, deviceId, listPages, packageName, pid])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return pages
    return pages.filter((page) =>
      [page.title, page.url, page.type, sourceDevice].some((value) =>
        value.toLowerCase().includes(q)
      )
    )
  }, [filter, pages, sourceDevice])

  const selected = filtered.find((page) => page.id === selectedId) || null

  async function handleCopy(): Promise<void> {
    if (!selected?.url) return
    const ok = await copyTextToClipboard(selected.url)
    if (ok) toast.success('已复制 URL')
    else toast.error('复制失败')
  }

  async function handleOpenBrowser(): Promise<void> {
    if (!selected?.url) return
    try {
      await App.OpenBrowser(selected.url)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '打开浏览器失败')
    }
  }

  function handleClear(): void {
    setPages([])
    setSelectedId(null)
    setError('')
    toast.success('已清空网页列表')
  }

  if (!app) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        请先选择进程
      </div>
    )
  }

  if (pid <= 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-amber-600">
        进程未运行，无法枚举网页
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-3">
      <div className="flex items-center gap-2">
        <Input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="过滤"
          className="h-8 max-w-xs"
        />
        <span className="truncate text-xs text-muted-foreground font-mono">{packageName}</span>
        <div className="ml-auto flex items-center gap-1">
          {loading && autoRefresh && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1"
            disabled={!selected?.url}
            onClick={() => void handleCopy()}
            title="复制 URL"
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-8 p-0"
            disabled={pages.length === 0}
            onClick={handleClear}
            title="一键清空"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1"
            onClick={() => setAutoRefresh((on) => !on)}
            title={autoRefresh ? '停止自动刷新' : '开始自动刷新'}
          >
            {autoRefresh ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            <span className="text-xs">{autoRefresh ? '停止刷新' : '开始刷新'}</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1"
            disabled={!selected?.url}
            onClick={() => void handleOpenBrowser()}
            title="用浏览器打开"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            title="手动刷新"
            onClick={() => {
              setLoading(true)
              void listPages(deviceId, pid, packageName)
                .then((next) => {
                  const now = Date.now()
                  setPages((prev) => mergePages(prev, next, now))
                  setError('')
                })
                .catch((err) => setError(err instanceof Error ? err.message : String(err)))
                .finally(() => setLoading(false))
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded border border-destructive/30 bg-destructive/5 px-2 py-1 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto rounded border">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur">
            <tr className="border-b text-muted-foreground">
              <th className="px-3 py-2 font-medium w-[28%]">标题</th>
              <th className="px-3 py-2 font-medium">URL</th>
              <th className="px-3 py-2 font-medium w-20">类型</th>
              <th className="px-3 py-2 font-medium w-[18%]">来源设备</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">
                  {loading ? '扫描中…' : '暂无 WebView 页面（需开启网页调试）'}
                </td>
              </tr>
            ) : (
              filtered.map((page) => {
                const active = page.id === selectedId
                return (
                  <tr
                    key={page.id}
                    className={`border-b cursor-pointer hover:bg-muted/50 ${active ? 'bg-primary/10' : ''}`}
                    onClick={() => setSelectedId(page.id)}
                  >
                    <td className="px-3 py-2 align-top">
                      <div className="flex items-start gap-2 min-w-0">
                        {page.faviconUrl ? (
                          <img src={page.faviconUrl} alt="" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        ) : null}
                        <div className="min-w-0">
                          <div className="break-all">{page.title || '(无标题)'}</div>
                          <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                            {formatDateTime(page.seenAt)}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top break-all font-mono text-[11px] text-muted-foreground">
                      {page.url}
                    </td>
                    <td className="px-3 py-2 align-top text-muted-foreground">{page.type || '-'}</td>
                    <td className="px-3 py-2 align-top break-all text-muted-foreground">
                      {sourceDevice}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="text-[11px] text-muted-foreground">
        {filtered.length} 个页面 ·{' '}
        {autoRefresh ? `每 ${POLL_MS / 1000}s 自动刷新` : '已停止自动刷新'}
      </div>
    </div>
  )
}
