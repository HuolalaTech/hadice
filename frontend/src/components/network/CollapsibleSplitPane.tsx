import React, { useCallback, useEffect, useRef, useState } from 'react'
import { GripVertical, PanelLeftOpen, PanelRightOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type CollapsedSide = 'none' | 'left' | 'right'

export interface SplitPaneControls {
  collapsedSide: CollapsedSide
  collapseLeft: () => void
  collapseRight: () => void
  expandAll: () => void
}

export interface CollapsibleSplitPaneProps {
  left: (controls: SplitPaneControls) => React.ReactNode
  right: (controls: SplitPaneControls) => React.ReactNode
  defaultLeftPercent?: number
  storageWidthKey?: string
  storageCollapsedKey?: string
  className?: string
}

const COLLAPSED_W = 36
const DEFAULT_LEFT = 45
const WIDTH_KEY = 'network-capture-split-width'
const COLLAPSED_KEY = 'network-capture-split-collapsed'
/** 快起慢停 + 轻微过冲（与 AppLayoutPage 同款阻尼） */
const PANEL_MS = 420
const PANEL_EASE = 'cubic-bezier(0.22, 1.15, 0.36, 1)'
const PANEL_TRANSITION = `width ${PANEL_MS}ms ${PANEL_EASE}`
const FADE_TRANSITION = `opacity ${PANEL_MS}ms ${PANEL_EASE}, transform ${PANEL_MS}ms ${PANEL_EASE}`

function loadWidth(key: string, fallback: number): number {
  try {
    const v = Number(localStorage.getItem(key))
    if (Number.isFinite(v) && v >= 20 && v <= 80) return v
  } catch { /* ignore */ }
  return fallback
}

function loadCollapsed(key: string): CollapsedSide {
  try {
    const v = localStorage.getItem(key)
    if (v === 'left' || v === 'right' || v === 'none') return v
  } catch { /* ignore */ }
  return 'none'
}

export function CollapsibleSplitPane({
  left,
  right,
  defaultLeftPercent = DEFAULT_LEFT,
  storageWidthKey = WIDTH_KEY,
  storageCollapsedKey = COLLAPSED_KEY,
  className,
}: CollapsibleSplitPaneProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const [leftPercent, setLeftPercent] = useState(() => loadWidth(storageWidthKey, defaultLeftPercent))
  const leftPercentRef = useRef(leftPercent)
  leftPercentRef.current = leftPercent
  const [collapsedSide, setCollapsedSide] = useState<CollapsedSide>(() => loadCollapsed(storageCollapsedKey))
  const [isResizing, setIsResizing] = useState(false)

  const persistWidth = useCallback((w: number) => {
    try { localStorage.setItem(storageWidthKey, String(w)) } catch { /* ignore */ }
  }, [storageWidthKey])

  const persistCollapsed = useCallback((side: CollapsedSide) => {
    try { localStorage.setItem(storageCollapsedKey, side) } catch { /* ignore */ }
  }, [storageCollapsedKey])

  const expandAll = useCallback(() => {
    setIsResizing(false)
    setCollapsedSide('none')
    persistCollapsed('none')
  }, [persistCollapsed])

  const collapseLeft = useCallback(() => {
    setIsResizing(false)
    setCollapsedSide('left')
    persistCollapsed('left')
  }, [persistCollapsed])

  const collapseRight = useCallback(() => {
    setIsResizing(false)
    setCollapsedSide('right')
    persistCollapsed('right')
  }, [persistCollapsed])

  const resetSplit = useCallback(() => {
    setLeftPercent(defaultLeftPercent)
    persistWidth(defaultLeftPercent)
    expandAll()
  }, [defaultLeftPercent, persistWidth, expandAll])

  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      if (!isResizing || !containerRef.current || collapsedSide !== 'none') return
      const rect = containerRef.current.getBoundingClientRect()
      const pct = ((e.clientX - rect.left) / rect.width) * 100
      const clamped = Math.max(20, Math.min(80, pct))
      leftPercentRef.current = clamped
      setLeftPercent(clamped)
    }
    const onUp = (): void => {
      if (!isResizing) return
      setIsResizing(false)
      persistWidth(leftPercentRef.current)
    }
    if (isResizing) {
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    }
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizing, collapsedSide, persistWidth])

  const controls: SplitPaneControls = {
    collapsedSide,
    collapseLeft,
    collapseRight,
    expandAll,
  }

  const leftCollapsed = collapsedSide === 'left'
  const rightCollapsed = collapsedSide === 'right'
  const bothExpanded = !leftCollapsed && !rightCollapsed
  // 拖拽时关掉 transition，避免跟手滞后
  const widthTransition = isResizing ? undefined : PANEL_TRANSITION

  // 一侧折叠时，对侧 = 100% − 窄条；避免 100%+36 撑破容器
  const leftWidth = leftCollapsed
    ? COLLAPSED_W
    : rightCollapsed
      ? `calc(100% - ${COLLAPSED_W}px)`
      : `${leftPercent}%`

  const rightWidth = rightCollapsed
    ? COLLAPSED_W
    : leftCollapsed
      ? `calc(100% - ${COLLAPSED_W}px)`
      : undefined // flex-1

  return (
    <div ref={containerRef} className={cn('flex flex-1 min-h-0 relative gap-0', className)}>
      {/* 左：始终挂载，宽动画折叠 */}
      <div
        className="relative z-0 min-h-0 shrink-0 overflow-hidden"
        style={{
          width: leftWidth,
          transition: widthTransition,
          willChange: 'width',
        }}
      >
        <div
          className="absolute inset-0 flex min-h-0 min-w-0 flex-col"
          style={{
            opacity: leftCollapsed ? 0 : 1,
            transform: leftCollapsed ? 'translateX(-8px)' : 'translateX(0)',
            transition: FADE_TRANSITION,
            pointerEvents: leftCollapsed ? 'none' : 'auto',
          }}
        >
          {left(controls)}
        </div>
        <div
          className="absolute inset-0 flex flex-col items-center border border-border rounded-lg bg-card/40 py-2"
          style={{
            opacity: leftCollapsed ? 1 : 0,
            transform: leftCollapsed ? 'translateX(0)' : 'translateX(8px)',
            transition: FADE_TRANSITION,
            pointerEvents: leftCollapsed ? 'auto' : 'none',
          }}
        >
          <Button type="button" size="icon" variant="ghost" className="h-7 w-7" title="展开 URL 列表" onClick={expandAll}>
            <PanelLeftOpen className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* 指示条：仅两侧都展开时显示；折叠过程用 opacity 淡出 */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="拖动调整 URL 列表与响应详情大小"
        title="拖动调整大小，双击还原"
        aria-hidden={!bothExpanded}
        className={cn(
          'group relative z-10 flex w-3 shrink-0 items-center justify-center transition-colors',
          bothExpanded ? 'cursor-col-resize' : 'pointer-events-none',
          isResizing ? 'bg-primary/15' : bothExpanded ? 'hover:bg-primary/10' : undefined
        )}
        style={{
          width: bothExpanded ? 12 : 0,
          opacity: bothExpanded ? 1 : 0,
          transition: isResizing
            ? undefined
            : `width ${PANEL_MS}ms ${PANEL_EASE}, opacity ${PANEL_MS}ms ${PANEL_EASE}`,
          overflow: 'hidden',
        }}
        onMouseDown={() => {
          if (bothExpanded) setIsResizing(true)
        }}
        onDoubleClick={resetSplit}
      >
        <div
          className={cn(
            'flex h-20 w-2.5 items-center justify-center rounded-full border shadow-sm transition-colors',
            isResizing
              ? 'border-primary/50 bg-primary/20 text-primary'
              : 'border-border bg-muted text-muted-foreground group-hover:border-primary/40 group-hover:text-primary'
          )}
        >
          <GripVertical className="h-4 w-4 shrink-0" />
        </div>
      </div>

      {/* 右：始终挂载，宽动画折叠 */}
      <div
        className={cn('relative z-0 min-h-0 min-w-0 overflow-hidden', !rightCollapsed && !leftCollapsed && 'flex-1')}
        style={{
          width: rightWidth,
          flex: bothExpanded ? 1 : undefined,
          transition: widthTransition,
          willChange: 'width',
        }}
      >
        <div
          className="absolute inset-0 flex min-h-0 min-w-0 flex-col"
          style={{
            opacity: rightCollapsed ? 0 : 1,
            transform: rightCollapsed ? 'translateX(8px)' : 'translateX(0)',
            transition: FADE_TRANSITION,
            pointerEvents: rightCollapsed ? 'none' : 'auto',
          }}
        >
          {right(controls)}
        </div>
        <div
          className="absolute inset-0 flex flex-col items-center border border-border rounded-lg bg-card/40 py-2"
          style={{
            opacity: rightCollapsed ? 1 : 0,
            transform: rightCollapsed ? 'translateX(0)' : 'translateX(-8px)',
            transition: FADE_TRANSITION,
            pointerEvents: rightCollapsed ? 'auto' : 'none',
          }}
        >
          <Button type="button" size="icon" variant="ghost" className="h-7 w-7" title="展开响应详情" onClick={expandAll}>
            <PanelRightOpen className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
