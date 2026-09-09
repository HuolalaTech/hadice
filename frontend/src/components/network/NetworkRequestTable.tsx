import React, { useEffect, useRef, useMemo, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Checkbox } from '@/components/ui/checkbox'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { getNetworkRequestKey } from '@/lib/network-request-key'
import { buildNetworkRequestUrl } from '@/lib/network-url'
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
  /** 是否显示导出勾选框（默认 false，仅 Android 页面开启） */
  showExportCheckboxes?: boolean
  /** 已选中的请求 ID 集合（用于导出勾选） */
  selectedIds?: Set<string>
  /** 切换单个请求的导出选中状态 */
  onToggleSelect?: (request: NetworkRequest) => void
  /** 全选/取消全选当前可见的请求 */
  onToggleSelectAll?: () => void
  /** 右键菜单：导出单条请求 */
  onExportRequest?: (request: NetworkRequest) => void
  /** 右键菜单：删除单条请求 */
  onDeleteRequest?: (request: NetworkRequest) => void
  /** 右键菜单：基于单条请求生成 mock */
  onMockRequest?: (request: NetworkRequest) => void
}

// ======================================================================
// Constants
// ======================================================================

const ROW_HEIGHT = 64
const BOUNDARY_HEIGHT = 40
const OVERSCAN = 12

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

function isMockRequest(request: NetworkRequest): boolean {
  return request.requestHeaders?.['Sophon-Mock'] === 'true'
    || request.requestHeaders?.['Hadice-Mock'] === 'true'
    || request.responseHeaders?.['Hadice-Mock'] === 'true'
    || request.extra?.mocked === true
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
  onSelect: (req: NetworkRequest) => void
  onToggleCheck: ((req: NetworkRequest) => void) | undefined
  onExportRequest: ((req: NetworkRequest) => void) | undefined
  onDeleteRequest: ((req: NetworkRequest) => void) | undefined
  onMockRequest: ((req: NetworkRequest) => void) | undefined
}

const MemoizedRow = React.memo(function MemoizedRow({
  rowData, rowHeight, showExportCheckboxes, searchQuery, isRegexMode,
  onSelect, onToggleCheck, onExportRequest, onDeleteRequest, onMockRequest,
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
  const displayUrl = rowData.fullUrl || rowData.url || '-'
  const hasContextActions = !!(onExportRequest || onDeleteRequest || onMockRequest)

  const rowContent = (
    <div
      className={`grid ${showExportCheckboxes ? 'grid-cols-[28px_1fr]' : 'grid-cols-[48px_1fr]'} gap-3 px-3 py-1 cursor-pointer select-none items-center border-b border-border/30 ${
        rowData.isSelected ? 'bg-primary/10' : 'hover:bg-secondary/30'
      }`}
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
        <div className="min-w-0 flex flex-col justify-center leading-tight">
          <div className="text-xs font-mono line-clamp-2 break-all" title={displayUrl}>
            {trimmedQuery && rowData.urlMatch
              ? <HighlightText text={displayUrl} searchQuery={searchQuery} isRegexMode={isRegexMode} />
              : displayUrl}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
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
            {rowData.isMock && <span className="text-[10px] px-1 py-0 rounded border border-red-500 text-red-500">mock</span>}
          </div>
        </div>
      ) : (
        /* Original mode: Method column + URL column */
        <>
          <div className="flex items-center gap-1">
            {rowData.hasMatch && <span className="w-1.5 h-1.5 bg-red-500 rounded-full flex-shrink-0" />}
            <span className={`text-xs font-mono font-semibold ${rowData.methodColor}`}>{rowData.method}</span>
          </div>
          <div className="min-w-0 flex flex-col justify-center leading-tight">
            <div className="text-xs font-mono line-clamp-2 break-all" title={displayUrl}>
              {trimmedQuery && rowData.urlMatch
                ? <HighlightText text={displayUrl} searchQuery={searchQuery} isRegexMode={isRegexMode} />
                : displayUrl}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[10px] text-muted-foreground">{rowData.formattedTimestamp}</span>
              {rowData.statusCode != null && (
                <span className={`text-[10px] px-1 py-0 rounded border ${rowData.statusCodeClass}`}>{rowData.statusCode}</span>
              )}
              {rowData.captureSource && (
                <span className="text-[10px] px-1 py-0 rounded border border-muted-foreground/50 text-muted-foreground">
                  {rowData.captureSource}
                </span>
              )}
              {rowData.isMock && <span className="text-[10px] px-1 py-0 rounded border border-red-500 text-red-500">mock</span>}
            </div>
          </div>
        </>
      )}
    </div>
  )

  if (!hasContextActions) {
    return rowContent
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{rowContent}</ContextMenuTrigger>
      <ContextMenuContent className="w-40">
        {onExportRequest && (
          <ContextMenuItem onSelect={() => onExportRequest(rowData.request)}>
            导出此请求
          </ContextMenuItem>
        )}
        {onDeleteRequest && (
          <ContextMenuItem onSelect={() => onDeleteRequest(rowData.request)}>
            删除此请求
          </ContextMenuItem>
        )}
        {(onExportRequest || onDeleteRequest) && onMockRequest && <ContextMenuSeparator />}
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
  if (prev.onExportRequest !== next.onExportRequest) return false
  if (prev.onDeleteRequest !== next.onDeleteRequest) return false
  if (prev.onMockRequest !== next.onMockRequest) return false

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
    && a.formattedTimestamp === b.formattedTimestamp
})

// ======================================================================
// Main component
// ======================================================================

export function NetworkRequestTable({
  requests, selectedRequest, onSelectRequest,
  searchQuery, searchMatches, isFilterMode, isRegexMode,
  autoScrollEnabled, setAutoScrollEnabled,
  showExportCheckboxes = false, selectedIds,
  onToggleSelect, onToggleSelectAll,
  onExportRequest, onDeleteRequest, onMockRequest
}: NetworkRequestTableProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const prevCountRef = useRef(0)

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

  // ---- Stable callbacks for rows (avoid new refs each render) ------------
  const handleSelect = useCallback((req: NetworkRequest) => {
    onSelectRequest(req)
  }, [onSelectRequest])

  // ---- Empty state -------------------------------------------------------
  if (allItems.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <div className="text-center">
          <p className="text-sm">{isFilterMode && searchQuery.trim() ? '没有匹配的请求' : '暂无网络请求'}</p>
          <p className="text-xs mt-1">{isFilterMode && searchQuery.trim() ? '请尝试其他搜索关键词' : '开始抓包后将显示网络请求列表'}</p>
        </div>
      </div>
    )
  }

  // ---- Render ------------------------------------------------------------
  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Fixed header */}
      <div className="sticky top-0 z-10 bg-card border-b border-border shadow-sm flex-shrink-0">
        <div className={`grid ${showExportCheckboxes ? 'grid-cols-[28px_1fr]' : 'grid-cols-[48px_1fr]'} gap-3 h-10 px-3 items-center`}>
          {showExportCheckboxes ? (
            <>
              <div className="flex items-center justify-center p-1 -m-1">
                <Checkbox id="select-all" checked={allVisibleSelected} onCheckedChange={() => onToggleSelectAll?.()} className="h-4 w-4" />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-left font-medium text-muted-foreground text-xs">URL</span>
                <div className="flex items-center gap-1">
                  <Checkbox id="auto-scroll" checked={autoScrollEnabled} onCheckedChange={(c) => setAutoScrollEnabled(c === true)} className="h-4 w-4" />
                  <label htmlFor="auto-scroll" className="text-xs text-muted-foreground cursor-pointer select-none whitespace-nowrap">自动滚动</label>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="text-left font-medium text-muted-foreground text-xs">Method</div>
              <div className="text-left font-medium text-muted-foreground text-xs">
                <div className="flex items-center justify-between">
                  <span>URL</span>
                  <div className="flex items-center gap-1">
                    <Checkbox id="auto-scroll" checked={autoScrollEnabled} onCheckedChange={(c) => setAutoScrollEnabled(c === true)} className="h-4 w-4" />
                    <label htmlFor="auto-scroll" className="text-xs text-muted-foreground cursor-pointer select-none whitespace-nowrap">自动滚动</label>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Virtualised scrollable body */}
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
                  onSelect={handleSelect}
                  onToggleCheck={onToggleSelect}
                  onExportRequest={onExportRequest}
                  onDeleteRequest={onDeleteRequest}
                  onMockRequest={onMockRequest}
                />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
