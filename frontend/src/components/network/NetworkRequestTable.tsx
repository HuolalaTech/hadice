import React, { useEffect, useRef, useMemo, useCallback, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Eraser, X, Clock } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { getNetworkRequestKey } from '@/lib/network-request-key'
import { buildNetworkRequestUrl } from '@/lib/network-url'
import { copyTextToClipboard } from '@/lib/clipboard'
import { toast } from 'sonner'
import { useThemeStore } from '@/store/themeStore'
import type { NetworkRequest } from '@/types/hdc'

// ======================================================================
// Types
// ======================================================================

interface SearchMatchInfo {
  urlMatch: boolean
  requestBodyMatch: boolean
  responseBodyMatch: boolean
  requestHeadersMatch: boolean
  requestParamsMatch: boolean
  matches: Array<{ start: number; end: number; text: string }>
}

interface NetworkRequestTableProps {
  requests: NetworkRequest[]
  selectedRequest: NetworkRequest | null
  onSelectRequest: (request: NetworkRequest) => void
  searchQuery: string
  searchMatches: Map<string, SearchMatchInfo>
  isFilterMode: boolean
  isRegexMode: boolean
  autoScrollEnabled: boolean
  setAutoScrollEnabled: (enabled: boolean) => void
  /** 一键清空当前抓包面板全部请求 */
  onClearAll?: () => void
  /** 是否显示导出勾选框（默认 false，仅 Android 页面开启） */
  showExportCheckboxes?: boolean
  /** 已选中的请求 ID 集合（用于导出勾选） */
  selectedIds?: Set<string>
  /** 切换单个请求的导出选中状态 */
  onToggleSelect?: (request: NetworkRequest) => void
  /** 全选/取消全选当前可见的请求 */
  onToggleSelectAll?: () => void
  /** 右键菜单：导出一组请求 */
  onExportRequests?: (requests: NetworkRequest[]) => void
  /** 右键菜单：删除一组请求 */
  onDeleteRequests?: (requests: NetworkRequest[]) => void
  /** 右键菜单：基于单条请求生成 mock */
  onMockRequest?: (request: NetworkRequest) => void
}

// ======================================================================
// Constants
// ======================================================================

const ROW_HEIGHT = 64
const BOUNDARY_HEIGHT = 40
const OVERSCAN = 12
const URL_EXTRACT_STORAGE_KEY = 'network-capture-url-extract-regex' // 旧单值，迁移用
const URL_EXTRACT_PATTERNS_KEY = 'network-capture-url-extract-regexes'
const URL_EXTRACT_HISTORY_KEY = 'network-capture-url-extract-history'
const URL_EXTRACT_HISTORY_MAX = 20
const URL_EXTRACT_ACTIVE_MAX = 10

function normalizePatternList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const list: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    list.push(trimmed)
  }
  return list
}

function loadUrlExtractPatterns(): string[] {
  try {
    const multi = localStorage.getItem(URL_EXTRACT_PATTERNS_KEY)
    if (multi) {
      return normalizePatternList(JSON.parse(multi)).slice(0, URL_EXTRACT_ACTIVE_MAX)
    }
    // 兼容旧版单字符串
    const legacy = localStorage.getItem(URL_EXTRACT_STORAGE_KEY)
    if (legacy?.trim()) return [legacy.trim()]
    return []
  } catch {
    return []
  }
}

function saveUrlExtractPatterns(patterns: string[]): void {
  try {
    const next = normalizePatternList(patterns).slice(0, URL_EXTRACT_ACTIVE_MAX)
    if (next.length === 0) {
      localStorage.removeItem(URL_EXTRACT_PATTERNS_KEY)
      localStorage.removeItem(URL_EXTRACT_STORAGE_KEY)
    } else {
      localStorage.setItem(URL_EXTRACT_PATTERNS_KEY, JSON.stringify(next))
      // 同步旧 key，便于回滚/兼容
      localStorage.setItem(URL_EXTRACT_STORAGE_KEY, next[0])
    }
  } catch (error) {
    console.error('[NetworkRequestTable] 保存 URL 提取正则失败:', error)
  }
}

function loadUrlExtractHistory(): string[] {
  try {
    const raw = localStorage.getItem(URL_EXTRACT_HISTORY_KEY)
    if (!raw) return []
    return normalizePatternList(JSON.parse(raw)).slice(0, URL_EXTRACT_HISTORY_MAX)
  } catch {
    return []
  }
}

function saveUrlExtractHistory(history: string[]): void {
  try {
    localStorage.setItem(
      URL_EXTRACT_HISTORY_KEY,
      JSON.stringify(normalizePatternList(history).slice(0, URL_EXTRACT_HISTORY_MAX))
    )
  } catch (error) {
    console.error('[NetworkRequestTable] 保存 URL 提取历史失败:', error)
  }
}

/** 把正则推到历史最前（去重） */
function pushUrlExtractHistory(history: string[], pattern: string): string[] {
  const trimmed = pattern.trim()
  if (!trimmed) return history
  return [trimmed, ...history.filter((item) => item !== trimmed)].slice(0, URL_EXTRACT_HISTORY_MAX)
}

function isValidRegexPattern(pattern: string): boolean {
  try {
    // eslint-disable-next-line no-new
    new RegExp(pattern)
    return true
  } catch {
    return false
  }
}

/**
 * 用正则从完整 URL 提取列表展示文案。
 * - patterns：按顺序尝试，命中即返回
 * - 有捕获组：取第一个非空捕获组；否则取整段匹配
 * - 全未命中 / 非法：回退完整 URL
 */
function extractUrlDisplayLabel(
  fullUrl: string,
  patterns: string | string[]
): { label: string; invalid: boolean; extracted: boolean } {
  const list = (Array.isArray(patterns) ? patterns : [patterns])
    .map((p) => p.trim())
    .filter(Boolean)
  if (list.length === 0) return { label: fullUrl, invalid: false, extracted: false }

  let anyInvalid = false
  for (const trimmed of list) {
    try {
      const re = new RegExp(trimmed)
      const match = fullUrl.match(re)
      if (!match) continue
      for (let i = 1; i < match.length; i++) {
        if (match[i] != null && match[i] !== '') {
          return { label: match[i], invalid: false, extracted: true }
        }
      }
      if (match[0]) return { label: match[0], invalid: false, extracted: true }
    } catch {
      anyInvalid = true
    }
  }
  return { label: fullUrl, invalid: anyInvalid, extracted: false }
}

/**
 * URL 旁滚动计数：增加时平滑滚动，≤0 不渲染（清空后自动隐藏）
 */
function RollingUrlCount({ value }: { value: number }): React.JSX.Element | null {
  const [display, setDisplay] = useState(value)
  const [bump, setBump] = useState(false)
  const fromRef = useRef(value)

  useEffect(() => {
    if (value <= 0) {
      fromRef.current = 0
      setDisplay(0)
      return
    }

    const from = fromRef.current
    if (from === value) {
      setDisplay(value)
      return
    }

    // 清空后重新开始 / 大幅回退：直接落到目标
    if (value < from) {
      fromRef.current = value
      setDisplay(value)
      return
    }

    setBump(true)
    const start = performance.now()
    const duration = Math.min(480, 120 + (value - from) * 24)
    let raf = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - (1 - t) ** 3
      setDisplay(Math.round(from + (value - from) * eased))
      if (t < 1) {
        raf = requestAnimationFrame(tick)
      } else {
        fromRef.current = value
      }
    }
    raf = requestAnimationFrame(tick)
    const bumpTimer = window.setTimeout(() => setBump(false), duration)
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(bumpTimer)
    }
  }, [value])

  if (value <= 0) return null

  return (
    <span
      className={`ml-1.5 inline-flex min-w-[1.25rem] items-center justify-center rounded px-1 py-0 text-[10px] font-semibold tabular-nums text-primary bg-primary/15 transition-transform duration-200 ${
        bump ? '-translate-y-0.5 scale-110' : 'translate-y-0 scale-100'
      }`}
      title={`已抓取 ${value} 条`}
    >
      {display}
    </span>
  )
}

// ======================================================================
// Pure helpers (no JSX, no hooks)
// ======================================================================

function getMethodColor(method: string): string {
  const colors: Record<string, string> = {
    GET: 'text-blue-500', POST: 'text-green-500', PUT: 'text-yellow-500',
    DELETE: 'text-red-500', PATCH: 'text-purple-500', HEAD: 'text-gray-500',
    OPTIONS: 'text-gray-500'
  }
  return colors[method.toUpperCase()] || 'text-muted-foreground'
}

function getStatusCodeColor(statusCode?: number): string {
  if (!statusCode) return 'text-muted-foreground'
  if (statusCode >= 200 && statusCode < 300) return 'text-green-500 border-green-500'
  if (statusCode >= 300 && statusCode < 400) return 'text-yellow-500 border-yellow-500'
  if (statusCode >= 400) return 'text-red-500 border-red-500'
  return 'text-muted-foreground border-muted-foreground'
}

function headerEqualsTrue(headers: Record<string, string> | undefined, name: string): boolean {
  if (!headers) return false
  const target = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target && String(value).toLowerCase() === 'true') return true
  }
  return false
}

function isMockRequest(request: NetworkRequest): boolean {
  // ponytail: 后端偶发把 mocked 序列化成字符串；header 大小写也不稳定
  const mocked = request.extra?.mocked as unknown
  return mocked === true
    || mocked === 'true'
    || headerEqualsTrue(request.requestHeaders, 'Sophon-Mock')
    || headerEqualsTrue(request.requestHeaders, 'Hadice-Mock')
    || headerEqualsTrue(request.responseHeaders, 'Hadice-Mock')
    || headerEqualsTrue(request.responseHeaders, 'Sophon-Mock')
}

function getRequestKey(request: NetworkRequest): string {
  return getNetworkRequestKey(request)
}

function formatTimestamp(timestamp: number): string {
  try {
    return new Date(timestamp).toLocaleTimeString('zh-CN', {
      hour12: false, hour: '2-digit', minute: '2-digit',
      second: '2-digit', fractionalSecondDigits: 3
    })
  } catch {
    const d = new Date(timestamp)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds())}`
  }
}

// ======================================================================
// Pre-computed row data (all primitives — cheap to compare)
// ======================================================================

interface BoundaryRowData {
  type: 'boundary'
  id: string
  boundaryMessage: string
}

interface RequestRowData {
  type: 'request'
  id: string
  request: NetworkRequest
  requestKey: string
  isSelected: boolean
  isChecked: boolean
  hasMatch: boolean
  urlMatch: boolean
  formattedTimestamp: string
  statusCode: number | undefined
  statusCodeClass: string
  captureSource: NonNullable<NetworkRequest['extra']>['captureSource']
  isMock: boolean
  method: string
  methodColor: string
  url: string
  fullUrl: string
}

type RowData = BoundaryRowData | RequestRowData

function buildRowData(
  item: NetworkRequest,
  selKey: string | null,
  selectedIds: Set<string> | undefined,
  searchMatches: Map<string, SearchMatchInfo>,
): RowData {
  if (item.isSessionBoundary) {
    return {
      type: 'boundary',
      id: item.id || `boundary-${item.timestamp}`,
      boundaryMessage: item.boundaryMessage || '',
    }
  }

  const reqKey = getRequestKey(item)
  const matchInfo = searchMatches.get(reqKey)
  const hasMatch = !!matchInfo
  const captureSource = item.extra?.captureSource

  return {
    type: 'request' as const,
    id: item.id || `req-${item.timestamp}-${item.url}`,
    request: item,
    requestKey: reqKey,
    isSelected: reqKey === selKey,
    isChecked: selectedIds?.has(reqKey) ?? false,
    hasMatch,
    urlMatch: matchInfo?.urlMatch ?? false,
    formattedTimestamp: formatTimestamp(item.timestamp),
    statusCode: item.statusCode,
    statusCodeClass: getStatusCodeColor(item.statusCode),
    captureSource: captureSource?.toLowerCase() === 'okhttp' ? 'OkHTTP' : captureSource,
    isMock: isMockRequest(item),
    method: item.method,
    methodColor: getMethodColor(item.method),
    url: item.url || '-',
    fullUrl: buildNetworkRequestUrl(item),
  }
}

// ======================================================================
// Memoized highlight text
// ======================================================================

interface HighlightTextProps {
  text: string
  searchQuery: string
  isRegexMode: boolean
}

const HighlightText = React.memo(function HighlightText({ text, searchQuery, isRegexMode }: HighlightTextProps): React.JSX.Element {
  if (!searchQuery.trim()) return <>{text}</>
  try {
    if (isRegexMode) {
      const regex = new RegExp(searchQuery, 'gi')
      const parts: Array<{ text: string; isMatch: boolean }> = []
      let lastIndex = 0; let match
      regex.lastIndex = 0
      while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) parts.push({ text: text.substring(lastIndex, match.index), isMatch: false })
        parts.push({ text: match[0], isMatch: true })
        lastIndex = match.index + match[0].length
      }
      if (lastIndex < text.length) parts.push({ text: text.substring(lastIndex), isMatch: false })
      if (parts.length === 0) return <>{text}</>
      return <>{parts.map((p, i) => p.isMatch ? <span key={i} className="bg-yellow-400 text-yellow-900 font-semibold">{p.text}</span> : <span key={i}>{p.text}</span>)}</>
    }
    const idx = text.toLowerCase().indexOf(searchQuery.toLowerCase())
    if (idx === -1) return <>{text}</>
    return <>{text.substring(0, idx)}<span className="bg-yellow-400 text-yellow-900 font-semibold">{text.substring(idx, idx + searchQuery.length)}</span>{text.substring(idx + searchQuery.length)}</>
  } catch { return <>{text}</> }
})

// ======================================================================
// Memoized row — only re-renders when visible data changes
// ======================================================================

interface RowProps {
  rowData: RowData
  rowHeight: number
  showExportCheckboxes: boolean
  searchQuery: string
  isRegexMode: boolean
  /** 列表 URL 展示提取正则列表（不影响右侧详情原始数据） */
  urlExtractPatterns: string[]
  onSelect: (req: NetworkRequest) => void
  onToggleCheck: ((req: NetworkRequest) => void) | undefined
  selectedRequestCount: number
  onExportRequest: ((req: NetworkRequest) => void) | undefined
  onDeleteRequest: ((req: NetworkRequest) => void) | undefined
  onMockRequest: ((req: NetworkRequest) => void) | undefined
}

const MemoizedRow = React.memo(function MemoizedRow({
  rowData, rowHeight, showExportCheckboxes, searchQuery, isRegexMode, urlExtractPatterns,
  onSelect, onToggleCheck, selectedRequestCount, onExportRequest, onDeleteRequest, onMockRequest,
}: RowProps): React.JSX.Element {
  if (rowData.type === 'boundary') {
    return (
      <div
        className="bg-muted/50 border-l-4 border-l-orange-400 px-4 flex items-center border-b border-border/30"
        style={{ height: rowHeight }}
      >
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground w-full">
          <div className="w-2 h-2 bg-orange-400 rounded-full flex-shrink-0" />
          <span className="font-medium">{rowData.boundaryMessage}</span>
        </div>
      </div>
    )
  }

  const trimmedQuery = searchQuery.trim()
  const fullUrl = rowData.fullUrl || rowData.url || '-'
  const extractResult = extractUrlDisplayLabel(fullUrl, urlExtractPatterns)
  const displayUrl = extractResult.label
  const extractedOk = extractResult.extracted
  const hasContextActions = !!(onExportRequest || onDeleteRequest || onMockRequest || extractedOk)

  // mock 行：左侧色条 + 淡底 + URL 着色，和普通请求一眼可分
  const rowTone = rowData.isMock
    ? rowData.isSelected
      ? 'bg-red-500/15 border-l-2 border-l-red-500 hover:bg-red-500/20'
      : 'bg-red-500/10 border-l-2 border-l-red-500/80 hover:bg-red-500/15'
    : rowData.isSelected
      ? 'bg-primary/10'
      : 'hover:bg-secondary/30'

  const rowContent = (
    <div
      className={`grid ${showExportCheckboxes ? 'grid-cols-[28px_1fr]' : 'grid-cols-[48px_1fr]'} gap-3 px-3 py-1 cursor-pointer select-none items-center border-b border-border/30 ${rowTone}`}
      style={{ height: rowHeight }}
      onClick={() => onSelect(rowData.request)}
      onContextMenu={() => onSelect(rowData.request)}
    >
      {showExportCheckboxes && (
        <div className="flex items-center justify-center p-1 -m-1" onClick={e => e.stopPropagation()}>
          <Checkbox checked={rowData.isChecked} onCheckedChange={() => onToggleCheck?.(rowData.request)} className="h-4 w-4" />
        </div>
      )}

      {showExportCheckboxes ? (
        /* Android export mode: URL only */
        <div className="min-w-0 flex flex-col justify-center leading-tight overflow-hidden">
          <div className="flex items-start gap-1.5 min-w-0">
            <div
              className={`min-w-0 flex-1 text-xs font-mono line-clamp-2 break-all ${rowData.isMock ? 'text-red-700 dark:text-red-300' : ''}`}
              title={fullUrl}
            >
              {trimmedQuery && rowData.urlMatch
                ? <HighlightText text={displayUrl} searchQuery={searchQuery} isRegexMode={isRegexMode} />
                : displayUrl}
            </div>
            {rowData.isMock && (
              <span className="shrink-0 mt-0.5 text-[10px] px-1 py-0 rounded border border-red-500 bg-red-500/15 text-red-600 dark:text-red-400 font-medium">
                mock
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
            {rowData.hasMatch && <span className="w-1.5 h-1.5 bg-red-500 rounded-full flex-shrink-0" />}
            <span className="text-[10px] text-muted-foreground">{rowData.formattedTimestamp}</span>
            {rowData.statusCode != null && (
              <span className={`text-[10px] px-1 py-0 rounded border ${rowData.statusCodeClass}`}>{rowData.statusCode}</span>
            )}
            {rowData.captureSource && (
              <span className="text-[10px] px-1 py-0 rounded border border-muted-foreground/50 text-muted-foreground">
                {rowData.captureSource}
              </span>
            )}
            {extractedOk && displayUrl !== fullUrl && (
              <span className="text-[10px] text-muted-foreground truncate" title={fullUrl}>
                {fullUrl}
              </span>
            )}
          </div>
        </div>
      ) : (
        /* Original mode: Method column + URL column */
        <>
          <div className="flex items-center gap-1">
            {rowData.hasMatch && <span className="w-1.5 h-1.5 bg-red-500 rounded-full flex-shrink-0" />}
            <span className={`text-xs font-mono font-semibold ${rowData.methodColor}`}>{rowData.method}</span>
          </div>
          <div className="min-w-0 flex flex-col justify-center leading-tight overflow-hidden">
            <div className="flex items-start gap-1.5 min-w-0">
              <div
                className={`min-w-0 flex-1 text-xs font-mono line-clamp-2 break-all ${rowData.isMock ? 'text-red-700 dark:text-red-300' : ''}`}
                title={fullUrl}
              >
                {trimmedQuery && rowData.urlMatch
                  ? <HighlightText text={displayUrl} searchQuery={searchQuery} isRegexMode={isRegexMode} />
                  : displayUrl}
              </div>
              {rowData.isMock && (
                <span className="shrink-0 mt-0.5 text-[10px] px-1 py-0 rounded border border-red-500 bg-red-500/15 text-red-600 dark:text-red-400 font-medium">
                  mock
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
              <span className="text-[10px] text-muted-foreground">{rowData.formattedTimestamp}</span>
              {rowData.statusCode != null && (
                <span className={`text-[10px] px-1 py-0 rounded border ${rowData.statusCodeClass}`}>{rowData.statusCode}</span>
              )}
              {rowData.captureSource && (
                <span className="text-[10px] px-1 py-0 rounded border border-muted-foreground/50 text-muted-foreground">
                  {rowData.captureSource}
                </span>
              )}
              {extractedOk && displayUrl !== fullUrl && (
                <span className="text-[10px] text-muted-foreground truncate" title={fullUrl}>
                  {fullUrl}
                </span>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )

  if (!hasContextActions) {
    return rowContent
  }

  const handleCopyExtracted = () => {
    void copyTextToClipboard(displayUrl).then((ok) => {
      if (ok) toast.success(`已复制接口: ${displayUrl}`)
      else toast.error('复制失败')
    })
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{rowContent}</ContextMenuTrigger>
      <ContextMenuContent className="w-40">
        {extractedOk && (
          <ContextMenuItem onSelect={handleCopyExtracted}>
            复制接口
          </ContextMenuItem>
        )}
        {extractedOk && (onExportRequest || onDeleteRequest || onMockRequest) && (
          <ContextMenuSeparator />
        )}
        {onExportRequest && (
          <ContextMenuItem onSelect={() => onExportRequest(rowData.request)}>
            {selectedRequestCount > 1 ? `导出${selectedRequestCount}个请求` : '导出此请求'}
          </ContextMenuItem>
        )}
        {onDeleteRequest && (
          <ContextMenuItem onSelect={() => onDeleteRequest(rowData.request)}>
            {selectedRequestCount > 1 ? `删除${selectedRequestCount}个请求` : '删除此请求'}
          </ContextMenuItem>
        )}
        {(onExportRequest || onDeleteRequest) && onMockRequest && <ContextMenuSeparator />}
        {/* Mock always targets the row that opened this menu, independent of checkbox selection. */}
        {onMockRequest && (
          <ContextMenuItem onSelect={() => onMockRequest(rowData.request)}>
            mock此请求
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}, (prev, next) => {
  // Quick bail-out: if global props changed, re-render
  if (prev.rowHeight !== next.rowHeight) return false
  if (prev.showExportCheckboxes !== next.showExportCheckboxes) return false
  if (prev.searchQuery !== next.searchQuery) return false
  if (prev.isRegexMode !== next.isRegexMode) return false
  if (prev.urlExtractPatterns !== next.urlExtractPatterns
    && prev.urlExtractPatterns.join('\0') !== next.urlExtractPatterns.join('\0')) {
    return false
  }
  if (prev.onExportRequest !== next.onExportRequest) return false
  if (prev.onDeleteRequest !== next.onDeleteRequest) return false
  if (prev.onMockRequest !== next.onMockRequest) return false
  if (prev.selectedRequestCount !== next.selectedRequestCount) return false

  // Compare only the fields that affect visual output
  const a = prev.rowData
  const b = next.rowData
  if (a.id !== b.id || a.type !== b.type) return false

  // Boundary: only boundaryMessage matters
  if (a.type === 'boundary') {
    return b.type === 'boundary' && a.boundaryMessage === b.boundaryMessage
  }

  // Request: compare visual fields
  if (b.type !== 'request') return false
  return a.isSelected === b.isSelected
    && a.isChecked === b.isChecked
    && a.hasMatch === b.hasMatch
    && a.urlMatch === b.urlMatch
    && a.statusCode === b.statusCode
    && a.captureSource === b.captureSource
    && a.isMock === b.isMock
    && a.fullUrl === b.fullUrl
    && a.url === b.url
    && a.method === b.method
    && a.formattedTimestamp === b.formattedTimestamp
})

// ======================================================================
// Main component
// ======================================================================

export function NetworkRequestTable({
  requests, selectedRequest, onSelectRequest,
  searchQuery, searchMatches, isFilterMode, isRegexMode,
  autoScrollEnabled, setAutoScrollEnabled, onClearAll,
  showExportCheckboxes = false, selectedIds,
  onToggleSelect, onToggleSelectAll,
  onExportRequests, onDeleteRequests, onMockRequest
}: NetworkRequestTableProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const prevCountRef = useRef(0)
  const urlExtractContainerRef = useRef<HTMLDivElement>(null)
  const urlExtractDraftRef = useRef<HTMLInputElement>(null)
  const theme = useThemeStore((s) => s.theme)
  const [urlExtractPatterns, setUrlExtractPatterns] = useState(loadUrlExtractPatterns)
  const [urlExtractDraft, setUrlExtractDraft] = useState('')
  // 启动时把已激活正则并入历史，避免「有标签却无下拉缓存」
  const [urlExtractHistory, setUrlExtractHistory] = useState(() => {
    const history = loadUrlExtractHistory()
    const patterns = loadUrlExtractPatterns()
    let next = history
    for (const pattern of [...patterns].reverse()) {
      next = pushUrlExtractHistory(next, pattern)
    }
    if (next.length !== history.length || next.some((item, i) => item !== history[i])) {
      saveUrlExtractHistory(next)
    }
    return next
  })
  const [showUrlExtractHistory, setShowUrlExtractHistory] = useState(false)

  const urlExtractDraftInvalid = useMemo(() => {
    const trimmed = urlExtractDraft.trim()
    if (!trimmed) return false
    return !isValidRegexPattern(trimmed)
  }, [urlExtractDraft])

  const persistUrlExtractPatterns = useCallback((next: string[]) => {
    const normalized = normalizePatternList(next).slice(0, URL_EXTRACT_ACTIVE_MAX)
    setUrlExtractPatterns(normalized)
    saveUrlExtractPatterns(normalized)
  }, [])

  const commitUrlExtractHistory = useCallback((pattern: string) => {
    const trimmed = pattern.trim()
    if (!trimmed || !isValidRegexPattern(trimmed)) return
    setUrlExtractHistory((prev) => {
      const next = pushUrlExtractHistory(prev, trimmed)
      saveUrlExtractHistory(next)
      return next
    })
  }, [])

  const addUrlExtractPattern = useCallback((pattern: string) => {
    const trimmed = pattern.trim()
    if (!trimmed || !isValidRegexPattern(trimmed)) return false
    persistUrlExtractPatterns([...urlExtractPatterns, trimmed])
    commitUrlExtractHistory(trimmed)
    setUrlExtractDraft('')
    return true
  }, [commitUrlExtractHistory, persistUrlExtractPatterns, urlExtractPatterns])

  const removeUrlExtractPattern = useCallback((pattern: string) => {
    persistUrlExtractPatterns(urlExtractPatterns.filter((item) => item !== pattern))
  }, [persistUrlExtractPatterns, urlExtractPatterns])

  const clearUrlExtractPatterns = useCallback(() => {
    persistUrlExtractPatterns([])
    setUrlExtractDraft('')
  }, [persistUrlExtractPatterns])

  const handleSelectUrlExtractHistory = useCallback((pattern: string) => {
    addUrlExtractPattern(pattern)
    setShowUrlExtractHistory(false)
    urlExtractDraftRef.current?.focus()
  }, [addUrlExtractPattern])

  const handleRemoveUrlExtractHistory = useCallback((pattern: string) => {
    setUrlExtractHistory((prev) => {
      const next = prev.filter((item) => item !== pattern)
      saveUrlExtractHistory(next)
      if (next.length === 0) setShowUrlExtractHistory(false)
      return next
    })
  }, [])

  useEffect(() => {
    if (!showUrlExtractHistory) return
    const onPointerDown = (event: MouseEvent) => {
      if (urlExtractContainerRef.current?.contains(event.target as Node)) return
      setShowUrlExtractHistory(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [showUrlExtractHistory])

  // ---- Memoize sorted + filtered items -----------------------------------
  const allItems = useMemo(() => {
    const boundaryMarkers = requests.filter(r => r.isSessionBoundary)
    const normalRequests = requests.filter(r => !r.isSessionBoundary)

    const effectiveFiltered = (isFilterMode && searchQuery.trim())
      ? normalRequests.filter(r => {
          const key = getNetworkRequestKey(r)
          return searchMatches.has(key)
        })
      : normalRequests

    return [...boundaryMarkers, ...effectiveFiltered].sort((a, b) => a.timestamp - b.timestamp)
  }, [requests, isFilterMode, searchQuery, searchMatches])

  // ---- Pre-compute row data (all render fields) ---------------------------
  const selKey = selectedRequest ? getRequestKey(selectedRequest) : null

  const rowsData = useMemo(() =>
    allItems.map(item => buildRowData(item, selKey, selectedIds, searchMatches)),
    [allItems, selKey, selectedIds, searchMatches]
  )

  const selectedRequests = useMemo(
    () => requests.filter(request => !request.isSessionBoundary && selectedIds?.has(getRequestKey(request))),
    [requests, selectedIds]
  )
  const handleExportRequest = useCallback((request: NetworkRequest) => {
    onExportRequests?.(selectedRequests.length > 1 ? selectedRequests : [request])
  }, [onExportRequests, selectedRequests])
  const handleDeleteRequest = useCallback((request: NetworkRequest) => {
    onDeleteRequests?.(selectedRequests.length > 1 ? selectedRequests : [request])
  }, [onDeleteRequests, selectedRequests])

  // ---- Virtualizer -------------------------------------------------------
  const rowVirtualizer = useVirtualizer({
    count: rowsData.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: useCallback(
      (index: number) => rowsData[index]?.type === 'boundary' ? BOUNDARY_HEIGHT : ROW_HEIGHT,
      [rowsData]
    ),
    overscan: OVERSCAN,
  })

  // ---- Auto-scroll to latest ---------------------------------------------
  useEffect(() => {
    if (autoScrollEnabled && rowsData.length > prevCountRef.current && rowsData.length > 0) {
      rowVirtualizer.scrollToIndex(rowsData.length - 1, { align: 'end' })
    }
    prevCountRef.current = rowsData.length
  }, [rowsData.length, autoScrollEnabled, rowVirtualizer])

  // ---- All-visible-selected for select-all checkbox -----------------------
  const visibleRequests = rowsData.filter(r => r.type === 'request')
  const allVisibleSelected = visibleRequests.length > 0 && visibleRequests.every(r => r.isChecked)

  // 抓包 URL 总数（不含会话分隔标记）；清空后为 0，计数隐藏
  const urlCount = useMemo(
    () => requests.reduce((n, r) => (r.isSessionBoundary ? n : n + 1), 0),
    [requests]
  )

  // ---- Stable callbacks for rows (avoid new refs each render) ------------
  const handleSelect = useCallback((req: NetworkRequest) => {
    onSelectRequest(req)
  }, [onSelectRequest])

  // 正则输入区：从「URL 计数」右侧一直铺到「一键清空(Eraser)」之前；单行不换行，超出省略
  // 注意：外层不要 overflow-hidden，否则会裁掉历史下拉
  const urlHeaderLeft = (
    <div className="flex items-center gap-2 min-w-0 flex-1">
      <span className="inline-flex shrink-0 items-center text-left font-medium text-muted-foreground text-xs whitespace-nowrap">
        URL
        <RollingUrlCount value={urlCount} />
      </span>
      <div
        ref={urlExtractContainerRef}
        className="relative min-w-0 flex-1"
      >
        <div
          className={`flex h-7 w-full min-w-0 flex-nowrap items-center gap-1 overflow-hidden rounded-md border bg-background px-1.5 ${
            urlExtractDraftInvalid ? 'border-red-500' : 'border-input'
          }`}
          onClick={() => {
            urlExtractDraftRef.current?.focus()
            if (urlExtractHistory.length > 0) setShowUrlExtractHistory(true)
          }}
        >
          {urlExtractPatterns.map((pattern) => (
            <span
              key={pattern}
              className="inline-flex min-w-0 max-w-[40%] shrink items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-foreground dark:bg-white/10 dark:text-white"
              style={theme === 'dark' ? { color: '#ffffff', WebkitTextFillColor: '#ffffff' } : undefined}
              title={pattern}
            >
              <span className="min-w-0 truncate whitespace-nowrap">{pattern}</span>
              <button
                type="button"
                className="inline-flex h-3 w-3 shrink-0 items-center justify-center rounded text-muted-foreground/60 hover:text-foreground hover:bg-muted dark:text-white/50 dark:hover:text-white dark:hover:bg-white/15"
                title="删除此正则"
                aria-label={`删除正则 ${pattern}`}
                onClick={(e) => {
                  e.stopPropagation()
                  removeUrlExtractPattern(pattern)
                }}
              >
                <X className="h-2 w-2" />
              </button>
            </span>
          ))}
          <input
            ref={urlExtractDraftRef}
            value={urlExtractDraft}
            onChange={(e) => setUrlExtractDraft(e.target.value)}
            onFocus={() => {
              if (urlExtractHistory.length > 0) setShowUrlExtractHistory(true)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault()
                if (addUrlExtractPattern(urlExtractDraft)) {
                  setShowUrlExtractHistory(false)
                }
              } else if (e.key === 'Backspace' && !urlExtractDraft && urlExtractPatterns.length > 0) {
                removeUrlExtractPattern(urlExtractPatterns[urlExtractPatterns.length - 1])
              } else if (e.key === 'Escape') {
                setShowUrlExtractHistory(false)
              }
            }}
            placeholder={urlExtractPatterns.length === 0 ? '正则提取 回车添加' : '添加…'}
            // WebView 下 input 字色常被系统样式盖掉；暗黑强制白色
            style={
              theme === 'dark'
                ? { color: '#ffffff', caretColor: '#ffffff', WebkitTextFillColor: '#ffffff' }
                : undefined
            }
            className="min-w-[4ch] flex-1 truncate border-0 bg-transparent py-0.5 text-[11px] font-mono text-foreground dark:text-white dark:caret-white outline-none placeholder:text-muted-foreground dark:placeholder:text-white/45 whitespace-nowrap"
            title="支持多个正则：回车/逗号添加；按序匹配；标签可单独删除。不影响右侧详情。"
            aria-label="URL 正则提取"
            aria-expanded={showUrlExtractHistory}
            aria-autocomplete="list"
          />
          {(urlExtractPatterns.length > 0 || urlExtractDraft.length > 0) && (
            <button
              type="button"
              className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground/50 hover:text-foreground hover:bg-muted"
              title="清除全部正则"
              aria-label="清除全部正则"
              onClick={(e) => {
                e.stopPropagation()
                clearUrlExtractPatterns()
                setShowUrlExtractHistory(urlExtractHistory.length > 0)
              }}
            >
              <X className="h-2.5 w-2.5" />
            </button>
          )}
        </div>
        {showUrlExtractHistory && urlExtractHistory.length > 0 && (
          <div
            className="absolute top-full left-0 right-0 mt-1 z-50 max-h-52 overflow-y-auto rounded-md border border-border bg-popover shadow-lg"
            onMouseDown={(e) => e.preventDefault()}
          >
            <div className="p-1">
              {urlExtractHistory.map((item) => (
                <div
                  key={item}
                  className="flex items-center gap-1.5 rounded-md px-2 py-1.5 cursor-pointer hover:bg-accent"
                  onClick={() => handleSelectUrlExtractHistory(item)}
                >
                  <Clock className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-popover-foreground">
                    {item}
                  </span>
                  <button
                    type="button"
                    className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded text-muted-foreground/40 hover:bg-destructive/10 hover:text-destructive"
                    title="删除此历史"
                    aria-label={`删除历史 ${item}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleRemoveUrlExtractHistory(item)
                    }}
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      {urlExtractDraftInvalid && (
        <span className="shrink-0 text-[10px] text-red-500 whitespace-nowrap">无效</span>
      )}
    </div>
  )

  const headerActions = (
    <div className="flex items-center gap-2 shrink-0 ml-auto">
      {onClearAll && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-foreground"
          title="清空全部请求"
          aria-label="清空全部请求"
          onClick={onClearAll}
          disabled={requests.length === 0}
        >
          <Eraser className="h-3.5 w-3.5" />
        </Button>
      )}
      <div className="flex items-center gap-1">
        <Checkbox id="auto-scroll" checked={autoScrollEnabled} onCheckedChange={(c) => setAutoScrollEnabled(c === true)} className="h-4 w-4" />
        <label htmlFor="auto-scroll" className="text-xs text-muted-foreground cursor-pointer select-none whitespace-nowrap">自动滚动</label>
      </div>
    </div>
  )

  // ---- Render ------------------------------------------------------------
  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Fixed header */}
      <div className="sticky top-0 z-10 bg-card border-b border-border shadow-sm flex-shrink-0">
        <div className={`grid ${showExportCheckboxes ? 'grid-cols-[28px_1fr]' : 'grid-cols-[48px_1fr]'} gap-3 h-10 px-3 items-center`}>
          {showExportCheckboxes ? (
            <>
              <div className="flex items-center justify-center p-1 -m-1">
                <Checkbox
                  id="select-all"
                  checked={allVisibleSelected}
                  onCheckedChange={() => onToggleSelectAll?.()}
                  className="h-4 w-4"
                  disabled={visibleRequests.length === 0}
                />
              </div>
              <div className="flex items-center gap-2 min-w-0">
                {urlHeaderLeft}
                {headerActions}
              </div>
            </>
          ) : (
            <>
              <div className="text-left font-medium text-muted-foreground text-xs">Method</div>
              <div className="flex items-center gap-2 min-w-0">
                {urlHeaderLeft}
                {headerActions}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Empty / virtualised body */}
      {allItems.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <div className="text-center">
            <p className="text-sm">{isFilterMode && searchQuery.trim() ? '没有匹配的请求' : '暂无网络请求'}</p>
            <p className="text-xs mt-1">{isFilterMode && searchQuery.trim() ? '请尝试其他搜索关键词' : '开始抓包后将显示网络请求列表'}</p>
          </div>
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="flex-1 min-h-0 overflow-y-scroll scrollbar-stable"
        >
          <div
            style={{
              height: rowVirtualizer.getTotalSize(),
              position: 'relative',
            }}
          >
            {rowVirtualizer.getVirtualItems().map(virtualRow => {
              const rowData = rowsData[virtualRow.index]
              if (!rowData) return null

              const rowHeight = rowData.type === 'boundary' ? BOUNDARY_HEIGHT : ROW_HEIGHT

              return (
                <div
                  key={virtualRow.key}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <MemoizedRow
                    rowData={rowData}
                    rowHeight={rowHeight}
                    showExportCheckboxes={showExportCheckboxes}
                    searchQuery={searchQuery}
                    isRegexMode={isRegexMode}
                    urlExtractPatterns={urlExtractPatterns}
                    onSelect={handleSelect}
                    onToggleCheck={onToggleSelect}
                    selectedRequestCount={selectedRequests.length}
                    onExportRequest={onExportRequests ? handleExportRequest : undefined}
                    onDeleteRequest={onDeleteRequests ? handleDeleteRequest : undefined}
                    onMockRequest={onMockRequest}
                  />
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
