import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Boxes,
  RefreshCw,
  RotateCcw,
  Search,
  Play,
  Crosshair,
  ChevronsDownUp,
  ChevronsUpDown,
  GripVertical,
  PanelLeftClose,
  PanelLeftOpen
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { WindowToggleButton } from '@/components/layout/WindowToggleButton'
import { HelpToggleButton } from '@/components/layout/HelpToggleButton'
import { NoDeviceState } from '@/components/layout/NoDeviceState'
import { useDeviceStore } from '@/store/deviceStore'
import { cn } from '@/lib/utils'
import {
  inspectLayout,
  listApps,
  listPages
} from '@/modules/appLayout/api'
import { hitTestNode } from '@/modules/appLayout/hitTest'
import { LayoutTree } from '@/modules/appLayout/LayoutTree'
import { ScreenshotPanel } from '@/modules/appLayout/ScreenshotPanel'
import type {
  LayoutAppRow,
  LayoutDumpResult,
  LayoutNode,
  LayoutPageInfo
} from '@/modules/appLayout/types'

/** 左栏宽：快起慢停 + 轻微过冲（阻尼感）；过冲别太大，避免 layout 抖 */
const LEFT_PANEL_W = 280
const LEFT_PANEL_COLLAPSED_W = 44
const LEFT_PANEL_MS = 420
const LEFT_PANEL_EASE = 'cubic-bezier(0.22, 1.15, 0.36, 1)'
const LEFT_PANEL_STORAGE = 'hadice-applayout-left-collapsed'
/** 布局树占 布局树+截图 区宽度 %；默认 flex 4:5 */
const DEFAULT_SPLIT = 44.4
const SPLIT_STORAGE = 'hadice-applayout-split'

/**
 * 应用布局（实验）：选应用/页面 → 启动 → dump 布局树 + 截图高亮
 * 逻辑集中在 modules/appLayout，可整体关闭或删除。
 */
export function AppLayoutPage(): React.JSX.Element {
  const { selectedDevice } = useDeviceStore()
  const platform = (selectedDevice?.platform as string) || 'harmonyos'

  const [leftCollapsed, setLeftCollapsed] = useState(() => {
    try {
      return localStorage.getItem(LEFT_PANEL_STORAGE) === '1'
    } catch {
      return false
    }
  })
  const [apps, setApps] = useState<LayoutAppRow[]>([])
  const [appFilter, setAppFilter] = useState<'thirdParty' | 'system' | 'all'>('thirdParty')
  const [appQuery, setAppQuery] = useState('')
  const [selectedPkg, setSelectedPkg] = useState('')
  const [pages, setPages] = useState<LayoutPageInfo[]>([])
  const [selectedPage, setSelectedPage] = useState('')
  const [treeFilter, setTreeFilter] = useState('')
  const [expandSignal, setExpandSignal] = useState(0)
  const [collapseSignal, setCollapseSignal] = useState(0)
  const [reveal, setReveal] = useState<{ id: string; seq: number } | null>(null)
  const [dump, setDump] = useState<LayoutDumpResult | null>(null)
  const [selectedNode, setSelectedNode] = useState<LayoutNode | null>(null)
  const [loadingApps, setLoadingApps] = useState(false)
  const [loadingPages, setLoadingPages] = useState(false)
  const [inspecting, setInspecting] = useState(false)
  const [splitPct, setSplitPct] = useState(() => {
    try {
      const v = Number(localStorage.getItem(SPLIT_STORAGE))
      return v >= 25 && v <= 75 ? v : DEFAULT_SPLIT
    } catch {
      return DEFAULT_SPLIT
    }
  })
  const [isSplitResizing, setIsSplitResizing] = useState(false)
  const splitContainerRef = useRef<HTMLDivElement>(null)

  // 同抓包页拖拽模式：document 级 mousemove/mouseup
  useEffect(() => {
    if (!isSplitResizing) return
    const onMove = (e: MouseEvent): void => {
      const el = splitContainerRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const pct = ((e.clientX - r.left) / r.width) * 100
      setSplitPct(Math.min(75, Math.max(25, pct)))
    }
    const onUp = (): void => {
      setIsSplitResizing(false)
      // 截图高亮框按容器尺寸重测
      requestAnimationFrame(() => window.dispatchEvent(new Event('resize')))
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.userSelect = 'none'
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = ''
    }
  }, [isSplitResizing])

  useEffect(() => {
    try {
      localStorage.setItem(SPLIT_STORAGE, String(splitPct))
    } catch {
      // ignore
    }
  }, [splitPct])

  function resetSplit(): void {
    setSplitPct(DEFAULT_SPLIT)
    try {
      localStorage.removeItem(SPLIT_STORAGE)
    } catch {
      // ignore
    }
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')))
  }

  const filteredApps = useMemo(() => {
    const q = appQuery.trim().toLowerCase()
    if (!q) return apps
    return apps.filter(
      (a) =>
        a.appName.toLowerCase().includes(q) || a.packageName.toLowerCase().includes(q)
    )
  }, [apps, appQuery])

  const refreshApps = useCallback(async () => {
    if (!selectedDevice) return
    setLoadingApps(true)
    try {
      const rows = await listApps(selectedDevice.connectKey, platform, appFilter)
      setApps(rows)
    } catch (e) {
      toast.error(`加载应用失败: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setLoadingApps(false)
    }
  }, [selectedDevice, platform, appFilter])

  useEffect(() => {
    setApps([])
    setPages([])
    setSelectedPkg('')
    setSelectedPage('')
    setDump(null)
    setSelectedNode(null)
    if (selectedDevice) void refreshApps()
  }, [selectedDevice?.connectKey, platform, appFilter, refreshApps])

  useEffect(() => {
    if (!selectedDevice || !selectedPkg) {
      setPages([])
      setSelectedPage('')
      return
    }
    let cancelled = false
    setLoadingPages(true)
    listPages(selectedDevice.connectKey, platform, selectedPkg)
      .then((p) => {
        if (cancelled) return
        setPages(p)
        setSelectedPage(p[0]?.name ?? '')
      })
      .catch((e) => {
        if (!cancelled) {
          setPages([])
          toast.error(`加载页面失败: ${e instanceof Error ? e.message : String(e)}`)
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingPages(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedDevice, selectedPkg, platform])

  async function runInspect(pageName: string): Promise<void> {
    if (!selectedDevice) return
    setInspecting(true)
    try {
      const result = await inspectLayout(
        selectedDevice.connectKey,
        platform,
        selectedPkg,
        pageName
      )
      setDump(result)
      setSelectedNode(result.root)
      toast.success(`已抓取 ${result.nodeCount} 个节点`)
    } catch (e) {
      toast.error(`抓取失败: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setInspecting(false)
    }
  }

  // 清掉此前实验残留的全局 cursor 样式
  useEffect(() => {
    document.documentElement.classList.remove(
      'hadice-applayout-cursor-default',
      'hadice-applayout-cursor-crosshair'
    )
    document.getElementById('hadice-applayout-cursor-style')?.remove()
    document.documentElement.style.removeProperty('cursor')
    document.body.style.removeProperty('cursor')
  }, [])

  const pageKind = platform === 'android' ? 'Activity' : 'Ability'

  function toggleLeftPanel(): void {
    setLeftCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem(LEFT_PANEL_STORAGE, next ? '1' : '0')
      } catch {
        // ignore
      }
      return next
    })
  }

  function handleScreenshotPick(imgX: number, imgY: number, imgW: number, imgH: number): void {
    const root = dump?.root ?? null
    if (!root) return
    // 截图像素 → 布局 bounds 坐标系
    let x = imgX
    let y = imgY
    const rw = root.bounds.right - root.bounds.left
    const rh = root.bounds.bottom - root.bounds.top
    if (rw > 0 && rh > 0 && imgW > 0 && imgH > 0) {
      x = Math.round((imgX / imgW) * rw) + root.bounds.left
      y = Math.round((imgY / imgH) * rh) + root.bounds.top
    }
    const hit = hitTestNode(root, x, y)
    if (!hit) return
    if (treeFilter) setTreeFilter('')
    setSelectedNode(hit)
    setReveal((prev) => ({ id: hit.id, seq: (prev?.seq ?? 0) + 1 }))
  }

  const titleBar = (
    <h1 className="text-2xl font-bold flex items-center gap-3">
      <Boxes className="h-6 w-6 text-primary" />
      应用布局
      <WindowToggleButton />
      <HelpToggleButton />
    </h1>
  )

  if (!selectedDevice) {
    return (
      <div className="p-6 h-full flex flex-col">
        <div className="mb-6">{titleBar}</div>
        <div className="flex-1 flex items-center justify-center">
          <NoDeviceState icon={<Boxes className="mx-auto mb-4 h-16 w-16 opacity-50" />} />
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 h-full flex flex-col gap-4">
      <div className="flex-shrink-0">{titleBar}</div>

      <div className="flex min-h-0 flex-1 gap-3">
        {/* 应用 + 页面：宽度动画折叠（快→慢 + 轻微阻尼过冲） */}
        <aside
          className="relative z-10 flex min-h-0 shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-card/40"
          style={{
            width: leftCollapsed ? LEFT_PANEL_COLLAPSED_W : LEFT_PANEL_W,
            transition: `width ${LEFT_PANEL_MS}ms ${LEFT_PANEL_EASE}`,
            willChange: 'width'
          }}
        >
          {/* 展开态内容：固定 280 宽，随父级裁剪 */}
          <div
            className="absolute inset-y-0 left-0 flex min-h-0 w-[280px] flex-col"
            style={{
              opacity: leftCollapsed ? 0 : 1,
              transform: leftCollapsed ? 'translateX(-8px)' : 'translateX(0)',
              transition: `opacity ${LEFT_PANEL_MS}ms ${LEFT_PANEL_EASE}, transform ${LEFT_PANEL_MS}ms ${LEFT_PANEL_EASE}`,
              pointerEvents: leftCollapsed ? 'none' : 'auto'
            }}
          >
            <div className="flex flex-col gap-1.5 border-b border-border p-2">
              <div className="flex items-center gap-1">
                <div className="relative min-w-0 flex-1">
                  <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="h-8 pl-7 text-xs"
                    placeholder="搜索应用"
                    value={appQuery}
                    onChange={(e) => setAppQuery(e.target.value)}
                  />
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 shrink-0"
                  disabled={loadingApps}
                  onClick={() => void refreshApps()}
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', loadingApps && 'animate-spin')} />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 shrink-0"
                  title="折叠应用面板"
                  onClick={toggleLeftPanel}
                >
                  <PanelLeftClose className="h-4 w-4" />
                </Button>
              </div>
              <Select
                value={appFilter}
                onValueChange={(v) => setAppFilter(v as 'thirdParty' | 'system' | 'all')}
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="thirdParty">第三方</SelectItem>
                  <SelectItem value="system">系统</SelectItem>
                  <SelectItem value="all">全部</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <ScrollArea className="h-[36%] min-h-[120px]">
              <div className="space-y-0.5 p-1">
                {filteredApps.map((app) => (
                  <button
                    key={app.packageName}
                    type="button"
                    className={cn(
                      'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted/70',
                      selectedPkg === app.packageName && 'bg-primary/10 text-primary'
                    )}
                    onClick={() => setSelectedPkg(app.packageName)}
                  >
                    {app.icon ? (
                      <img src={app.icon} alt="" className="h-5 w-5 rounded" />
                    ) : (
                      <div className="h-5 w-5 rounded bg-muted" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{app.appName}</div>
                      <div className="truncate text-[10px] text-muted-foreground">
                        {app.packageName}
                      </div>
                    </div>
                  </button>
                ))}
                {!loadingApps && filteredApps.length === 0 && (
                  <div className="p-3 text-xs text-muted-foreground">无应用</div>
                )}
              </div>
            </ScrollArea>

            <div className="border-t border-border px-2 py-1 text-[11px] font-medium text-muted-foreground">
              {pageKind} 列表 {loadingPages ? '…' : `(${pages.length})`}
            </div>
            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-0.5 p-1">
                {pages.map((p) => (
                  <button
                    key={p.name}
                    type="button"
                    className={cn(
                      'w-full rounded px-2 py-1.5 text-left text-xs hover:bg-muted/70',
                      selectedPage === p.name && 'bg-primary/10 text-primary'
                    )}
                    onClick={() => setSelectedPage(p.name)}
                  >
                    <div className="truncate font-medium">{p.label || p.name}</div>
                    {p.label && (
                      <div className="truncate font-mono text-[10px] text-muted-foreground">
                        {p.name}
                      </div>
                    )}
                  </button>
                ))}
                {selectedPkg && !loadingPages && pages.length === 0 && (
                  <div className="p-3 text-xs text-muted-foreground">
                    未解析到可启动页面，仍可「抓取当前页」
                  </div>
                )}
              </div>
            </ScrollArea>

            <div className="flex flex-col gap-1.5 border-t border-border p-2">
              <Button
                size="sm"
                className="h-8 w-full gap-1 text-xs"
                disabled={inspecting || !selectedPkg || !selectedPage}
                onClick={() => void runInspect(selectedPage)}
              >
                <Play className="h-3.5 w-3.5" />
                启动并抓取
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="h-8 w-full gap-1 text-xs"
                disabled={inspecting}
                onClick={() => void runInspect('')}
              >
                <Crosshair className="h-3.5 w-3.5" />
                抓取当前前台页
              </Button>
            </div>
          </div>

          {/* 折叠态：窄条快捷入口 */}
          <div
            className="absolute inset-0 flex flex-col items-center gap-2 py-2"
            style={{
              opacity: leftCollapsed ? 1 : 0,
              transform: leftCollapsed ? 'translateX(0)' : 'translateX(8px)',
              transition: `opacity ${LEFT_PANEL_MS}ms ${LEFT_PANEL_EASE}, transform ${LEFT_PANEL_MS}ms ${LEFT_PANEL_EASE}`,
              pointerEvents: leftCollapsed ? 'auto' : 'none'
            }}
          >
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              title="展开应用面板"
              onClick={toggleLeftPanel}
            >
              <PanelLeftOpen className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              title="抓取当前前台页"
              disabled={inspecting}
              onClick={() => void runInspect('')}
            >
              <Crosshair className="h-3.5 w-3.5" />
            </Button>
          </div>
        </aside>

        {/* 布局树 + 截图：可拖动分栏 */}
        <div ref={splitContainerRef} className="flex min-h-0 min-w-0 flex-1">
          {/* 面板1：布局树 */}
          <div
            className="relative z-10 flex min-h-0 min-w-0 shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-card/40"
            style={{ width: `${splitPct}%` }}
          >
            <div className="flex items-center gap-2 border-b border-border p-2">
              <span className="text-xs font-medium">布局树</span>
            {dump && (
              <span className="text-[10px] text-muted-foreground">{dump.nodeCount} 节点</span>
            )}
            <div className="ml-auto flex items-center gap-1">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                title="全部展开"
                disabled={!dump?.root}
                onClick={() => setExpandSignal((n) => n + 1)}
              >
                <ChevronsUpDown className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                title="全部折叠"
                disabled={!dump?.root}
                onClick={() => setCollapseSignal((n) => n + 1)}
              >
                <ChevronsDownUp className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                title="还原面板大小"
                onClick={resetSplit}
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
              <div className="relative w-36">
                <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-7 pl-6 text-[11px]"
                  placeholder="过滤节点"
                  value={treeFilter}
                  onChange={(e) => setTreeFilter(e.target.value)}
                />
              </div>
            </div>
            </div>
          <ScrollArea className="min-h-0 flex-1">
            <LayoutTree
              root={dump?.root ?? null}
              selectedId={selectedNode?.id ?? null}
              onSelect={setSelectedNode}
              filter={treeFilter}
              expandSignal={expandSignal}
              collapseSignal={collapseSignal}
              reveal={reveal}
            />
          </ScrollArea>
          {selectedNode && (
            <div className="border-t border-border p-2 font-mono text-[10px] text-muted-foreground">
              <div>type: {selectedNode.type}</div>
              {selectedNode.resourceId && <div>id: {selectedNode.resourceId}</div>}
              {selectedNode.text && <div>text: {selectedNode.text}</div>}
              <div>
                bounds: [{selectedNode.bounds.left},{selectedNode.bounds.top}][
                {selectedNode.bounds.right},{selectedNode.bounds.bottom}]
              </div>
            </div>
          )}
          </div>

          {/* 拖动分栏：常显提示条，双击还原 */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="拖动调整布局树与截图预览大小"
            className={cn(
              'group relative z-10 flex w-3 shrink-0 cursor-col-resize items-center justify-center transition-colors',
              isSplitResizing ? 'bg-primary/15' : 'hover:bg-primary/10'
            )}
            title="拖动调整大小，双击还原"
            onMouseDown={() => setIsSplitResizing(true)}
            onDoubleClick={resetSplit}
          >
            <div
              className={cn(
                'flex h-20 w-2.5 items-center justify-center rounded-full border shadow-sm transition-colors',
                isSplitResizing
                  ? 'border-primary/50 bg-primary/20 text-primary'
                  : 'border-border bg-muted text-muted-foreground group-hover:border-primary/40 group-hover:text-primary'
              )}
            >
              <GripVertical className="h-4 w-4 shrink-0" />
            </div>
          </div>

          {/* 面板2：截图预览 */}
          <div className="relative z-0 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card/40">
          <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
            <span className="text-xs font-medium">截图预览</span>
            <span className="text-[10px] text-muted-foreground">点击可定位布局</span>
            {inspecting && <span className="text-[10px] text-muted-foreground">抓取中…</span>}
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="ml-auto h-7 w-7"
              title="抓取当前前台页"
              disabled={inspecting}
              onClick={() => void runInspect('')}
            >
              <RefreshCw className={cn('h-3.5 w-3.5', inspecting && 'animate-spin')} />
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <ScreenshotPanel
              b64={dump?.screenshotB64}
              mime={dump?.screenshotMime}
              highlight={selectedNode?.bounds}
              naturalWidth={dump?.width}
              naturalHeight={dump?.height}
              onPick={handleScreenshotPick}
            />
          </div>
          </div>
        </div>
      </div>
    </div>
  )
}
