import React, { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import {
  Clock,
  Copy,
  Eraser,
  ListFilter,
  PanelLeftClose,
  PanelRightClose,
  Play,
  Radio,
  Square,
  Star,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { WindowToggleButton } from '@/components/layout/WindowToggleButton'
import { HelpToggleButton } from '@/components/layout/HelpToggleButton'
import { NoDeviceState } from '@/components/layout/NoDeviceState'
import {
  CollapsibleSplitPane,
  type SplitPaneControls,
} from '@/components/network/CollapsibleSplitPane'
import { TrackLogJsonView } from '@/components/track-log/TrackLogJsonView'
import { useDeviceStore } from '@/store/deviceStore'
import { useThemeStore } from '@/store/themeStore'
import { useTrackLogFavoriteStore } from '@/store/trackLogFavoriteStore'
import { useTrackLogStore } from '@/store/trackLogStore'
import { cn } from '@/lib/utils'
import { captureEvent } from '@/lib/posthog'

const FILTER_TAGS_KEY = 'track-log-filter-tags'
const FILTER_HISTORY_KEY = 'track-log-filter-history'
const FILTER_HISTORY_MAX = 20
const FILTER_TAGS_MAX = 20
const AUTO_SCROLL_KEY = 'track-log-auto-scroll'
const PORT_KEY = 'track-log-port'
const DEFAULT_PORT = 8888

function loadPort(): number {
  try {
    const n = Number(localStorage.getItem(PORT_KEY))
    if (Number.isInteger(n) && n >= 1 && n <= 65535) return n
  } catch {
    /* ignore */
  }
  return DEFAULT_PORT
}

function savePort(port: number): void {
  try {
    localStorage.setItem(PORT_KEY, String(port))
  } catch {
    /* ignore */
  }
}

function normalizePortInput(raw: string): number | null {
  const n = Number(String(raw).trim())
  if (!Number.isInteger(n) || n < 1 || n > 65535) return null
  return n
}

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString('zh-CN', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return String(ts)
  }
}

function normalizeTagList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const tag = item.trim()
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    out.push(tag)
  }
  return out
}

function loadTags(): string[] {
  try {
    const raw = localStorage.getItem(FILTER_TAGS_KEY)
    if (!raw) return []
    return normalizeTagList(JSON.parse(raw)).slice(0, FILTER_TAGS_MAX)
  } catch {
    return []
  }
}

function saveTags(tags: string[]): void {
  try {
    localStorage.setItem(FILTER_TAGS_KEY, JSON.stringify(normalizeTagList(tags).slice(0, FILTER_TAGS_MAX)))
  } catch {
    /* ignore */
  }
}

function loadFilterHistory(): string[] {
  try {
    const raw = localStorage.getItem(FILTER_HISTORY_KEY)
    if (!raw) return []
    return normalizeTagList(JSON.parse(raw)).slice(0, FILTER_HISTORY_MAX)
  } catch {
    return []
  }
}

function saveFilterHistory(history: string[]): void {
  try {
    localStorage.setItem(
      FILTER_HISTORY_KEY,
      JSON.stringify(normalizeTagList(history).slice(0, FILTER_HISTORY_MAX))
    )
  } catch {
    /* ignore */
  }
}

function pushFilterHistory(history: string[], tag: string): string[] {
  const trimmed = tag.trim()
  if (!trimmed) return history
  return [trimmed, ...history.filter((item) => item !== trimmed)].slice(0, FILTER_HISTORY_MAX)
}

function loadBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key)
    if (v === '1') return true
    if (v === '0') return false
  } catch {
    /* ignore */
  }
  return fallback
}

function saveBool(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0')
  } catch {
    /* ignore */
  }
}

class TrackLogErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[TrackLogPage]', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="p-6 h-full flex flex-col items-center justify-center gap-3">
          <p className="text-sm text-destructive">数据埋点页出错：{this.state.error.message}</p>
          <Button
            size="sm"
            onClick={() => {
              this.setState({ error: null })
              window.location.reload()
            }}
          >
            重新加载
          </Button>
        </div>
      )
    }
    return this.props.children
  }
}

function TrackLogListPanel({
  controls,
}: {
  controls: SplitPaneControls
}): React.JSX.Element {
  const theme = useThemeStore((s) => s.theme)
  const isDark = theme === 'dark'
  const events = useTrackLogStore((s) => s.events)
  const selectedId = useTrackLogStore((s) => s.selectedId)
  const status = useTrackLogStore((s) => s.status)
  const clear = useTrackLogStore((s) => s.clear)
  const select = useTrackLogStore((s) => s.select)
  const favorites = useTrackLogFavoriteStore((s) => s.favorites)
  const favoritesFilterOn = useTrackLogFavoriteStore((s) => s.favoritesFilterOn)
  const setFavoritesFilterOn = useTrackLogFavoriteStore((s) => s.setFavoritesFilterOn)
  const toggleFavorite = useTrackLogFavoriteStore((s) => s.toggleFavorite)
  const isFavorite = useTrackLogFavoriteStore((s) => s.isFavorite)

  const [filterTags, setFilterTags] = useState(loadTags)
  // 历史独立于当前标签：清空过滤不丢记忆（对齐抓包 URL 正则）
  const [filterHistory, setFilterHistory] = useState(() => {
    const history = loadFilterHistory()
    const tags = loadTags()
    let next = history
    for (const tag of [...tags].reverse()) {
      next = pushFilterHistory(next, tag)
    }
    if (next.length !== history.length || next.some((item, i) => item !== history[i])) {
      saveFilterHistory(next)
    }
    return next
  })
  const [showFilterHistory, setShowFilterHistory] = useState(false)
  const [draft, setDraft] = useState('')
  const [autoScroll, setAutoScroll] = useState(() => loadBool(AUTO_SCROLL_KEY, true))
  const listRef = useRef<HTMLDivElement>(null)
  const draftRef = useRef<HTMLInputElement>(null)
  const filterContainerRef = useRef<HTMLDivElement>(null)
  const prevCountRef = useRef(0)

  const persistTags = useCallback((next: string[]) => {
    const normalized = normalizeTagList(next).slice(0, FILTER_TAGS_MAX)
    setFilterTags(normalized)
    saveTags(normalized)
  }, [])

  const commitFilterHistory = useCallback((tag: string) => {
    const trimmed = tag.trim()
    if (!trimmed) return
    setFilterHistory((prev) => {
      const next = pushFilterHistory(prev, trimmed)
      saveFilterHistory(next)
      return next
    })
  }, [])

  const addTag = useCallback(
    (raw: string): boolean => {
      const trimmed = raw.trim()
      if (!trimmed) return false
      commitFilterHistory(trimmed)
      if (filterTags.includes(trimmed)) {
        setDraft('')
        return true
      }
      persistTags([...filterTags, trimmed])
      setDraft('')
      return true
    },
    [commitFilterHistory, filterTags, persistTags]
  )

  const removeTag = useCallback(
    (tag: string) => {
      persistTags(filterTags.filter((item) => item !== tag))
    },
    [filterTags, persistTags]
  )

  const handleSelectFilterHistory = useCallback(
    (tag: string) => {
      addTag(tag)
      setShowFilterHistory(false)
      draftRef.current?.focus()
    },
    [addTag]
  )

  const handleRemoveFilterHistory = useCallback((tag: string) => {
    setFilterHistory((prev) => {
      const next = prev.filter((item) => item !== tag)
      saveFilterHistory(next)
      if (next.length === 0) setShowFilterHistory(false)
      return next
    })
  }, [])

  useEffect(() => {
    if (!showFilterHistory) return
    const onPointerDown = (event: MouseEvent) => {
      if (filterContainerRef.current?.contains(event.target as Node)) return
      setShowFilterHistory(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [showFilterHistory])

  const visible = useMemo(() => {
    let list = events
    if (favoritesFilterOn) {
      list = list.filter((row) => favorites.includes(row.event.trim()))
    }
    if (filterTags.length > 0) {
      list = list.filter((row) => {
        const event = row.event.toLowerCase()
        const json = row.json.toLowerCase()
        return filterTags.some((tag) => {
          const q = tag.toLowerCase()
          return event.includes(q) || json.includes(q)
        })
      })
    }
    return list
  }, [events, favoritesFilterOn, favorites, filterTags])

  useEffect(() => {
    if (autoScroll && visible.length > prevCountRef.current && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
    prevCountRef.current = visible.length
  }, [visible.length, autoScroll])

  const inputTextStyle = isDark
    ? { color: '#ffffff', caretColor: '#ffffff', WebkitTextFillColor: '#ffffff' }
    : undefined

  return (
    <Card className="h-full min-w-0 flex flex-col overflow-hidden">
      <div className="sticky top-0 z-10 bg-card border-b border-border shadow-sm flex-shrink-0">
        <div className="flex h-10 items-center gap-2 px-3 min-w-0">
          <span className="inline-flex shrink-0 items-center text-left font-medium text-muted-foreground text-xs whitespace-nowrap">
            事件
            {events.length > 0 && (
              <span className="ml-1 tabular-nums text-foreground">{events.length}</span>
            )}
          </span>

          <div ref={filterContainerRef} className="relative min-w-0 flex-1">
            <div
              className="flex h-7 w-full min-w-0 flex-nowrap items-center gap-1 overflow-hidden rounded-md border border-input bg-background px-1.5"
              onClick={() => {
                draftRef.current?.focus()
                if (filterHistory.length > 0) setShowFilterHistory(true)
              }}
            >
              {filterTags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex min-w-0 max-w-[40%] shrink items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-foreground dark:bg-white/10 dark:text-white"
                  style={isDark ? { color: '#ffffff', WebkitTextFillColor: '#ffffff' } : undefined}
                  title={tag}
                >
                  <span className="min-w-0 truncate whitespace-nowrap">{tag}</span>
                  <button
                    type="button"
                    className="inline-flex h-3 w-3 shrink-0 items-center justify-center rounded text-muted-foreground/60 hover:text-foreground hover:bg-muted dark:text-white/50 dark:hover:text-white dark:hover:bg-white/15"
                    title="删除此关键词"
                    aria-label={`删除 ${tag}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      removeTag(tag)
                    }}
                  >
                    <X className="h-2 w-2" />
                  </button>
                </span>
              ))}
              <input
                ref={draftRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onFocus={() => {
                  if (filterHistory.length > 0) setShowFilterHistory(true)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault()
                    if (addTag(draft)) setShowFilterHistory(false)
                  } else if (e.key === 'Backspace' && !draft && filterTags.length > 0) {
                    removeTag(filterTags[filterTags.length - 1])
                  } else if (e.key === 'Escape') {
                    setShowFilterHistory(false)
                  }
                }}
                placeholder={filterTags.length === 0 ? '关键词过滤 回车添加' : '添加…'}
                style={inputTextStyle}
                className="min-w-[4ch] flex-1 truncate border-0 bg-transparent py-0.5 text-[11px] font-mono text-foreground dark:text-white dark:caret-white outline-none placeholder:text-muted-foreground dark:placeholder:text-white/45"
                aria-label="埋点关键词过滤"
                aria-expanded={showFilterHistory}
                aria-autocomplete="list"
              />
              {(filterTags.length > 0 || draft.length > 0) && (
                <button
                  type="button"
                  className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground/50 hover:text-foreground hover:bg-muted dark:text-white/40 dark:hover:text-white"
                  title="清除全部关键词（历史保留）"
                  aria-label="清除全部关键词"
                  onClick={(e) => {
                    e.stopPropagation()
                    persistTags([])
                    setDraft('')
                    setShowFilterHistory(filterHistory.length > 0)
                  }}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </div>
            {showFilterHistory && filterHistory.length > 0 && (
              <div
                className="absolute top-full left-0 right-0 mt-1 z-50 max-h-52 overflow-y-auto rounded-md border border-border bg-popover shadow-lg"
                onMouseDown={(e) => e.preventDefault()}
              >
                <div className="p-1">
                  {filterHistory.map((item) => (
                    <div
                      key={item}
                      className="flex items-center gap-1.5 rounded-md px-2 py-1.5 cursor-pointer hover:bg-accent"
                      onClick={() => handleSelectFilterHistory(item)}
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
                          handleRemoveFilterHistory(item)
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

          <div className="flex items-center gap-2 shrink-0">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn('h-6 w-6', favoritesFilterOn && 'text-amber-500')}
              title="仅显示收藏（筛选，不会添加收藏）"
              aria-label="仅显示收藏"
              onClick={() => setFavoritesFilterOn(!favoritesFilterOn)}
            >
              <ListFilter className={cn('h-3.5 w-3.5', favoritesFilterOn && 'text-amber-500')} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              title="清空全部埋点"
              aria-label="清空全部埋点"
              disabled={events.length === 0}
              onClick={() => void clear()}
            >
              <Eraser className="h-3.5 w-3.5" />
            </Button>
            <div className="flex items-center gap-1">
              <Checkbox
                id="track-auto-scroll"
                checked={autoScroll}
                onCheckedChange={(c) => {
                  const next = c === true
                  setAutoScroll(next)
                  saveBool(AUTO_SCROLL_KEY, next)
                }}
                className="h-4 w-4"
              />
              <label
                htmlFor="track-auto-scroll"
                className="text-xs text-muted-foreground cursor-pointer select-none whitespace-nowrap"
              >
                自动滚动
              </label>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              title="折叠列表"
              aria-label="折叠列表"
              onClick={controls.collapseLeft}
            >
              <PanelLeftClose className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto">
        {visible.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground p-6">
            <div className="text-center">
              <p className="text-sm">
                {favoritesFilterOn
                  ? favorites.length === 0
                    ? '没有收藏的埋点'
                    : '当前列表无匹配收藏'
                  : filterTags.length > 0
                    ? '没有匹配的埋点'
                    : status.running
                      ? '还没有埋点'
                      : '暂无埋点'}
              </p>
              <p className="text-xs mt-1 text-muted-foreground/80">
                {favoritesFilterOn
                  ? favorites.length === 0
                    ? '在列表行点击星标即可收藏'
                    : '请尝试关闭「仅显示收藏」或调整关键词'
                  : filterTags.length > 0
                    ? '试试换关键词或清空标签'
                    : status.running
                      ? '确认 APP 已开镜像、host 指向 127.0.0.1:8888'
                      : '点「开始监听」后操作 APP'}
              </p>
            </div>
          </div>
        ) : (
          <div>
            {visible.map((row) => {
              const active = row.id === selectedId
              const fav = isFavorite(row.event)
              const eventName = row.event.trim() || row.event
              return (
                <ContextMenu key={row.id}>
                  <ContextMenuTrigger asChild>
                    <div
                      role="button"
                      tabIndex={0}
                      className={cn(
                        'group w-full text-left px-3 py-2 border-b border-border/40 cursor-pointer select-none',
                        active
                          ? 'bg-orange-500/15 dark:bg-orange-400/10'
                          : 'hover:bg-accent/50 dark:hover:bg-white/5'
                      )}
                      onClick={() => select(row.id)}
                      onContextMenu={() => select(row.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          select(row.id)
                        }
                      }}
                    >
                      <div className="flex items-start gap-1.5 min-w-0">
                        <div className="min-w-0 flex-1">
                          <div
                            className={cn(
                              'text-xs font-mono truncate font-medium',
                              active
                                ? 'text-orange-700 dark:text-orange-300'
                                : 'text-foreground dark:text-orange-300/90'
                            )}
                            title={row.event}
                          >
                            {row.event}
                          </div>
                          <div className="text-[10px] text-muted-foreground dark:text-white/45 mt-0.5 tabular-nums">
                            {formatTime(row.timestamp)}
                          </div>
                        </div>
                        <button
                          type="button"
                          className={cn(
                            'shrink-0 mt-0.5 p-0.5 transition-opacity hover:text-amber-500',
                            fav
                              ? 'text-amber-500 opacity-100'
                              : 'text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
                          )}
                          title={fav ? '取消收藏' : '收藏此埋点名'}
                          aria-label={fav ? '取消收藏' : '收藏'}
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            toggleFavorite(row.event)
                          }}
                        >
                          <Star className={cn('h-3.5 w-3.5', fav && 'fill-amber-500 text-amber-500')} />
                        </button>
                      </div>
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="w-40">
                    <ContextMenuItem
                      disabled={!eventName}
                      onSelect={() => {
                        if (!eventName) return
                        addTag(eventName)
                        toast.success(`已加入筛选：${eventName}`)
                      }}
                    >
                      <ListFilter className="mr-2 h-3.5 w-3.5" />
                      加入筛选
                    </ContextMenuItem>
                    <ContextMenuItem
                      disabled={!eventName}
                      onSelect={() => {
                        if (!eventName) return
                        void navigator.clipboard.writeText(eventName).then(
                          () => toast.success('已复制名称'),
                          () => toast.error('复制失败')
                        )
                      }}
                    >
                      <Copy className="mr-2 h-3.5 w-3.5" />
                      复制名称
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              )
            })}
          </div>
        )}
      </div>
    </Card>
  )
}

function TrackLogDetailPanel({
  controls,
}: {
  controls: SplitPaneControls
}): React.JSX.Element {
  const events = useTrackLogStore((s) => s.events)
  const selectedId = useTrackLogStore((s) => s.selectedId)
  const selected = events.find((row) => row.id === selectedId) || null
  const favorites = useTrackLogFavoriteStore((s) => s.favorites)
  const toggleFavorite = useTrackLogFavoriteStore((s) => s.toggleFavorite)
  const isFav = selected ? favorites.includes(selected.event.trim()) : false

  return (
    <Card className="h-full min-w-0 flex flex-col overflow-hidden">
      <div className="px-3 py-2 border-b flex items-center gap-2 shrink-0">
        <span
          className="text-xs font-mono font-medium text-foreground dark:text-orange-300/90 flex-1 truncate"
          title={selected?.event}
        >
          {selected ? selected.event : '埋点详情'}
        </span>
        {selected && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn('h-7 w-7', isFav && 'text-amber-500')}
            title={isFav ? '取消收藏' : '收藏此埋点名'}
            aria-label={isFav ? '取消收藏' : '收藏'}
            onClick={() => toggleFavorite(selected.event)}
          >
            <Star className={cn('h-3.5 w-3.5', isFav && 'fill-amber-500 text-amber-500')} />
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title="折叠详情"
          aria-label="折叠详情"
          onClick={controls.collapseRight}
        >
          <PanelRightClose className="h-3.5 w-3.5" />
        </Button>
      </div>
      <ScrollArea className="flex-1">
        {selected ? (
          <div className="p-3">
            <div className="text-xs text-muted-foreground font-mono mb-2">
              {formatTime(selected.timestamp)}
            </div>
            <TrackLogJsonView raw={selected.json} />
          </div>
        ) : (
          <div className="p-6 text-sm text-muted-foreground">左侧点一条埋点看 JSON</div>
        )}
      </ScrollArea>
    </Card>
  )
}

function TrackLogPageInner(): React.JSX.Element {
  const { selectedDevice } = useDeviceStore()
  const status = useTrackLogStore((s) => s.status)
  const events = useTrackLogStore((s) => s.events)
  const start = useTrackLogStore((s) => s.start)
  const stop = useTrackLogStore((s) => s.stop)
  const listen = useTrackLogStore((s) => s.listen)
  const [busy, setBusy] = useState(false)
  const [portDraft, setPortDraft] = useState(() => String(loadPort()))

  useEffect(() => {
    listen()
  }, [listen])

  // 已在监听时用服务端实际端口回填（改绑/热重载）
  useEffect(() => {
    if (status.running && status.port > 0) {
      setPortDraft(String(status.port))
    }
  }, [status.running, status.port])

  const boundDeviceId = status.deviceId || ''
  const deviceMismatch =
    status.running && !!boundDeviceId && !!selectedDevice?.connectKey && boundDeviceId !== selectedDevice.connectKey
  const appConnected = status.running && (status.clientCount || 0) > 0
  const prevDeviceKeyRef = useRef(selectedDevice?.connectKey)
  const resolvedPort = normalizePortInput(portDraft) ?? DEFAULT_PORT

  // 左侧切设备时明确提示：不会自动改绑，改绑后要重启 APP
  useEffect(() => {
    const next = selectedDevice?.connectKey
    const prev = prevDeviceKeyRef.current
    prevDeviceKeyRef.current = next
    if (!status.running || !prev || !next || prev === next) return
    toast.message('已切换设备', {
      description: '埋点仍独占旧设备。点「改绑到当前设备」后，请重启 APP（或开关埋点镜像）再连。',
      duration: 6000,
    })
  }, [selectedDevice?.connectKey, status.running])

  const handleToggle = async (): Promise<void> => {
    if (!selectedDevice) return
    setBusy(true)
    try {
      if (status.running) {
        // 停的是服务端已绑定设备，不跟 UI 当前选中走（避免切机后停错）
        await stop(boundDeviceId || selectedDevice.connectKey)
        captureEvent('track log stopped', { port: status.port })
        toast.success('已停止埋点监听')
      } else {
        const port = normalizePortInput(portDraft)
        if (port == null) {
          toast.error('端口须为 1–65535 的整数')
          return
        }
        savePort(port)
        setPortDraft(String(port))
        const next = await start(selectedDevice.connectKey, port)
        captureEvent('track log started', { port, has_warning: Boolean(next.error) })
        if (next.error) toast.warning(next.error)
        else
          toast.success(`已监听 ${next.hostHint || `127.0.0.1:${port}`}`, {
            description: '看上方「APP 连接」徽章：仍为 0 时请打开埋点镜像或重启 APP',
            duration: 6000,
          })
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }

  const handleRebind = async (): Promise<void> => {
    if (!selectedDevice || !status.running) return
    setBusy(true)
    try {
      // 已监听时后端忽略 port，沿用当前监听端口
      const next = await start(selectedDevice.connectKey, status.port || resolvedPort)
      captureEvent('track log rebound', {
        port: status.port || resolvedPort,
        has_warning: Boolean(next.error),
      })
      if (next.error) toast.warning(next.error)
      else
        toast.success(`已改绑到 ${selectedDevice.connectKey}`, {
          description: '请立即重启 APP（或开关埋点镜像），否则「APP 连接」会一直是 0',
          duration: 7000,
        })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '改绑失败')
    } finally {
      setBusy(false)
    }
  }

  if (!selectedDevice) {
    return (
      <div className="p-6 h-full flex flex-col">
        <div className="mb-6">
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <Radio className="h-6 w-6 text-primary" />
            数据埋点
            <WindowToggleButton />
            <HelpToggleButton />
          </h1>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <NoDeviceState icon={<Radio className="h-16 w-16 mx-auto mb-4 opacity-50" />} />
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 h-full flex flex-col overflow-hidden">
      <div className="mb-4 flex-shrink-0 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold flex items-center gap-3">
          <Radio className="h-6 w-6 text-primary" />
          数据埋点
          <WindowToggleButton />
          <HelpToggleButton />
        </h1>
        <div className="flex items-center gap-2">
          <div
            className={cn(
              'flex h-9 items-center gap-1.5 rounded-md border px-2 shadow-sm',
              status.running
                ? 'border-border bg-muted/60 text-muted-foreground'
                : 'border-orange-500/50 bg-orange-500/10 dark:border-orange-400/40 dark:bg-orange-400/10'
            )}
            title="本机 /ws/log 端口；开始监听后不可改，APP host 需填 127.0.0.1:该端口"
          >
            <span
              className={cn(
                'whitespace-nowrap text-xs font-semibold',
                status.running ? 'text-muted-foreground' : 'text-orange-700 dark:text-orange-300'
              )}
            >
              端口
            </span>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={65535}
              step={1}
              value={portDraft}
              disabled={busy || status.running}
              onChange={(e) => setPortDraft(e.target.value)}
              onBlur={() => {
                const port = normalizePortInput(portDraft)
                if (port == null) {
                  setPortDraft(String(loadPort()))
                  return
                }
                setPortDraft(String(port))
                savePort(port)
              }}
              className={cn(
                'h-7 w-[4.5rem] border-0 bg-background px-1.5 text-center font-mono text-sm font-semibold tabular-nums shadow-none focus-visible:ring-1',
                status.running && 'bg-transparent text-muted-foreground'
              )}
              aria-label="埋点监听端口"
            />
          </div>
          {deviceMismatch && (
            <Button size="sm" className="h-9" variant="outline" disabled={busy} onClick={() => void handleRebind()}>
              改绑到当前设备
            </Button>
          )}
          <Button
            size="sm"
            className="h-9 gap-1.5"
            variant={status.running ? 'destructive' : 'default'}
            disabled={busy}
            onClick={() => void handleToggle()}
          >
            {status.running ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {status.running ? '停止监听' : '开始监听'}
          </Button>
        </div>
      </div>

      {deviceMismatch && (
        <div className="mb-2 flex-shrink-0 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
          仍独占 <span className="font-mono font-medium">{boundDeviceId}</span>
          ，左侧已切到 <span className="font-mono font-medium">{selectedDevice.connectKey}</span>
          。点「改绑到当前设备」后请<strong>重启 APP</strong>（或开关埋点镜像）。
        </div>
      )}

      <div className="mb-3 flex flex-shrink-0 flex-wrap items-center gap-2 text-xs">
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-medium',
            !status.running && 'border-border bg-muted/50 text-muted-foreground',
            status.running &&
              appConnected &&
              'border-emerald-500/45 bg-emerald-500/12 text-emerald-800 dark:text-emerald-300',
            status.running &&
              !appConnected &&
              'border-amber-500/45 bg-amber-500/12 text-amber-900 dark:text-amber-200'
          )}
          title={
            status.running
              ? appConnected
                ? '手机 Debug 包已连上本机 /ws/log'
                : '本机已监听，但手机还未连上；改绑/重开后通常需重启 APP'
              : '尚未开始监听'
          }
        >
          <span
            className={cn(
              'h-2 w-2 shrink-0 rounded-full',
              !status.running && 'bg-muted-foreground/50',
              status.running && appConnected && 'bg-emerald-500',
              status.running && !appConnected && 'bg-amber-500 animate-pulse'
            )}
          />
          {!status.running
            ? 'APP 未监听'
            : appConnected
              ? `APP 已连接 · ${status.clientCount}`
              : '等待 APP 连接 · 0（请打开埋点镜像或重启 APP）'}
        </span>
        {status.running && (
          <>
            <span className="text-muted-foreground">
              ws://{status.hostHint}/ws/log
            </span>
            <span className="text-muted-foreground">
              独占 <span className="font-mono text-foreground">{boundDeviceId || selectedDevice.connectKey}</span>
            </span>
            <span className="text-muted-foreground">
              列表 {events.length} · 收包 {status.received || 0}/{status.parsed || 0}
            </span>
          </>
        )}
        {!status.running && (
          <span className="text-muted-foreground">
            Debug 包开「埋点镜像」，host 填 127.0.0.1:{resolvedPort}；该端口只绑开始时的那台设备。
          </span>
        )}
        {status.error ? <span className="text-destructive">{status.error}</span> : null}
      </div>

      <CollapsibleSplitPane
        className="flex-1"
        storageWidthKey="track-log-split-width"
        storageCollapsedKey="track-log-split-collapsed"
        defaultLeftPercent={42}
        left={(controls) => <TrackLogListPanel controls={controls} />}
        right={(controls) => <TrackLogDetailPanel controls={controls} />}
      />
    </div>
  )
}

export function TrackLogPage(): React.JSX.Element {
  return (
    <TrackLogErrorBoundary>
      <TrackLogPageInner />
    </TrackLogErrorBoundary>
  )
}
