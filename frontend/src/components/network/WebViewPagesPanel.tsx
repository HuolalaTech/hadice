import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Copy, ExternalLink, Globe, Loader2, Pause, Play, RefreshCw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { copyTextToClipboard } from '@/lib/clipboard'
import { formatDateTime } from '@/lib/format'
import { openSystemBrowser, openWebPeek } from '@/lib/open-web-peek'
import {
  WEBVIEW_PAGES_ABS_MAX,
  WEBVIEW_PAGES_ABS_MIN,
  WEBVIEW_PAGES_DEFAULT_MAX,
  clampWebViewPagesMax,
  clearWebViewPagesHistory,
  displayWebViewTitle,
  loadWebViewPagesHistory,
  loadWebViewPagesMax,
  mergeWebViewHistory,
  saveWebViewPagesHistory,
  saveWebViewPagesMax,
  webViewHistoryUnchanged,
  webViewPageKey,
  type WebViewPageRow
} from '@/lib/webview-pages-history'
import type { HarmonyWebViewPage } from '@/types/hdc'

export interface WebViewPagesTarget {
  pid: number
  packageName: string
}

interface WebViewPagesPanelProps {
  deviceId: string
  deviceLabel?: string
  app: WebViewPagesTarget | null
  listPages: (deviceId: string, pid: number, packageName: string) => Promise<HarmonyWebViewPage[]>
}

const POLL_MS = 2000

export function WebViewPagesPanel({
  deviceId,
  deviceLabel,
  app,
  listPages
}: WebViewPagesPanelProps): React.JSX.Element {
  const [pages, setPages] = useState<WebViewPageRow[]>([])
  const [filter, setFilter] = useState('')
  /** 按网址 key 选中，避免 CDP id 轮询变化导致跳动 */
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [maxRecords, setMaxRecords] = useState(() => loadWebViewPagesMax())
  const [maxInput, setMaxInput] = useState(() => String(loadWebViewPagesMax()))

  const packageName = app?.packageName || ''
  const pid = app?.pid || 0
  const sourceDevice = deviceLabel || deviceId

  const maxRecordsRef = useRef(maxRecords)
  maxRecordsRef.current = maxRecords
  const listPagesRef = useRef(listPages)
  listPagesRef.current = listPages

  useEffect(() => {
    setPages((prev) => {
      if (prev.length <= maxRecords) return prev
      const trimmed = prev.slice(0, maxRecords)
      if (deviceId && packageName) {
        saveWebViewPagesHistory(deviceId, packageName, trimmed, maxRecords)
      }
      return trimmed
    })
  }, [deviceId, maxRecords, packageName])

  // 切设备/包名：从本地缓存恢复（pid 变不丢；仅用户清空才删）
  useEffect(() => {
    if (!deviceId || !packageName) {
      setPages([])
      setSelectedKey(null)
      setError('')
      return
    }
    const cached = loadWebViewPagesHistory(deviceId, packageName, maxRecordsRef.current)
    setPages(cached)
    setSelectedKey(cached[0] ? webViewPageKey(cached[0]) : null)
    setError('')
  }, [deviceId, packageName])

  function persistAndSetPages(
    updater: (prev: WebViewPageRow[]) => WebViewPageRow[],
    onMerged?: (merged: WebViewPageRow[], prev: WebViewPageRow[]) => void
  ): void {
    setPages((prev) => {
      const merged = updater(prev)
      if (webViewHistoryUnchanged(prev, merged)) return prev
      onMerged?.(merged, prev)
      if (deviceId && packageName) {
        saveWebViewPagesHistory(deviceId, packageName, merged, maxRecordsRef.current)
      }
      return merged
    })
  }

  // 单一轮询：依赖原始字段 + autoRefresh；listPages/max 走 ref，避免无谓重启
  useEffect(() => {
    if (!deviceId || pid <= 0 || !packageName) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    async function poll(showLoading: boolean): Promise<void> {
      if (showLoading) setLoading(true)
      try {
        const next = await listPagesRef.current(deviceId, pid, packageName)
        if (cancelled) return
        const now = Date.now()
        persistAndSetPages(
          (prev) => mergeWebViewHistory(prev, next, now, maxRecordsRef.current),
          (merged) => {
            setSelectedKey((current) => {
              if (current && merged.some((page) => webViewPageKey(page) === current)) {
                return current
              }
              const firstLive = next[0] ? webViewPageKey(next[0]) : null
              return firstLive || (merged[0] ? webViewPageKey(merged[0]) : null)
            })
          }
        )
        setError('')
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
        }
      } finally {
        if (!cancelled) setLoading(false)
        if (!cancelled && autoRefresh) {
          timer = setTimeout(() => {
            void poll(false)
          }, POLL_MS)
        }
      }
    }

    void poll(true)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [autoRefresh, deviceId, packageName, pid])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return pages
    return pages.filter((page) =>
      [page.title, page.url, page.type, sourceDevice].some((value) =>
        value.toLowerCase().includes(q)
      )
    )
  }, [filter, pages, sourceDevice])

  const selected =
    filtered.find((page) => webViewPageKey(page) === selectedKey) || null

  function commitMaxRecords(raw: string): void {
    const parsed = Number(raw)
    const next = saveWebViewPagesMax(
      Number.isFinite(parsed) ? parsed : WEBVIEW_PAGES_DEFAULT_MAX
    )
    setMaxRecords(next)
    setMaxInput(String(next))
  }

  async function handleCopy(): Promise<void> {
    if (!selected?.url) return
    const ok = await copyTextToClipboard(selected.url)
    if (ok) toast.success('已复制 URL')
    else toast.error('复制失败')
  }

  async function handleOpenPeek(): Promise<void> {
    if (!selected?.url) return
    await openWebPeek(selected.url)
  }

  async function handleOpenBrowser(): Promise<void> {
    if (!selected?.url) return
    await openSystemBrowser(selected.url)
  }

  function handleClear(): void {
    clearWebViewPagesHistory(deviceId, packageName)
    setPages([])
    setSelectedKey(null)
    setError('')
    toast.success('已清空网页记录')
  }

  function applyScan(next: HarmonyWebViewPage[]): void {
    const now = Date.now()
    persistAndSetPages(
      (prev) => mergeWebViewHistory(prev, next, now, maxRecordsRef.current),
      (merged) => {
        setSelectedKey((current) => {
          if (current && merged.some((page) => webViewPageKey(page) === current)) return current
          const firstLive = next[0] ? webViewPageKey(next[0]) : null
          return firstLive || (merged[0] ? webViewPageKey(merged[0]) : null)
        })
      }
    )
    setError('')
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
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="过滤"
          className="h-8 max-w-xs"
        />
        <span className="truncate text-xs text-muted-foreground font-mono">{packageName}</span>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span>保留</span>
          <Input
            type="number"
            min={WEBVIEW_PAGES_ABS_MIN}
            max={WEBVIEW_PAGES_ABS_MAX}
            value={maxInput}
            onChange={(event) => setMaxInput(event.target.value)}
            onBlur={() => commitMaxRecords(maxInput)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.currentTarget.blur()
              }
            }}
            className="h-8 w-16 px-2 text-center font-mono"
            title={`最近网址条数，默认 ${WEBVIEW_PAGES_DEFAULT_MAX}，最大 ${WEBVIEW_PAGES_ABS_MAX}`}
          />
          <span>条</span>
        </div>
        <div className="ml-auto flex items-center gap-1">
          {loading && pages.length === 0 && (
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
            title="一键清空记录"
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
            onClick={() => void handleOpenPeek()}
            title="网页看看（应用内打开）"
          >
            <Globe className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1"
            disabled={!selected?.url}
            onClick={() => void handleOpenBrowser()}
            title="用系统浏览器打开"
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
                .then((next) => applyScan(next))
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
                const key = webViewPageKey(page)
                const active = key === selectedKey
                return (
                  <tr
                    key={key}
                    className={`border-b cursor-pointer hover:bg-muted/50 ${active ? 'bg-primary/10' : ''}`}
                    onClick={() => setSelectedKey(key)}
                  >
                    <td className="px-3 py-2 align-top">
                      <div className="min-w-0">
                        <div className="break-all">{displayWebViewTitle(page.title, page.url)}</div>
                        <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                          {formatDateTime(page.seenAt)}
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
        记录 {pages.length}/{clampWebViewPagesMax(maxRecords)} 条 ·{' '}
        {autoRefresh ? `每 ${POLL_MS / 1000}s 自动刷新` : '已停止自动刷新'}
        {filter.trim() ? ` · 过滤后 ${filtered.length}` : ''}
      </div>
    </div>
  )
}
