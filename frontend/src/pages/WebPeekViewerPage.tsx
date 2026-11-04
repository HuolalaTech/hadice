import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, ExternalLink, Loader2, PanelRightOpen, Smartphone, Wrench, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { normalizeWebPeekUrl } from '@/lib/web-peek-url'
import { openSystemBrowser } from '@/lib/open-web-peek'
import { rememberWebPeekUrl } from '@/lib/web-peek-history'
import * as App from '../../bindings/Hadice/backend/appservice'

interface DevicePreset {
  id: string
  label: string
  width: number
  height: number
}

/**
 * width/height<=0 = 桌面 1280×900（由后端恢复）。
 * 宽高为 CSS 逻辑像素（≈ Chrome DevTools / YesViz / 物理分辨率÷DPR，非面板物理分辨率）。
 * 安卓「显示大小」可改 viewport，以下取默认常见值。
 */
const DEVICE_PRESETS: DevicePreset[] = [
  { id: 'desktop', label: '桌面 PC', width: 0, height: 0 },
  // Apple — iPhone 16/17：官方/YesViz CSS viewport
  { id: 'iphone-16', label: 'iPhone 16', width: 393, height: 852 },
  { id: 'iphone-16-pro', label: 'iPhone 16 Pro', width: 402, height: 874 },
  { id: 'iphone-16-pm', label: 'iPhone 16 Pro Max', width: 440, height: 956 },
  { id: 'iphone-17', label: 'iPhone 17', width: 402, height: 874 }, // 修正：与 17 同级面板多为 402×874，非 393
  { id: 'iphone-17-pro', label: 'iPhone 17 Pro', width: 402, height: 874 },
  { id: 'iphone-17-pm', label: 'iPhone 17 Pro Max', width: 440, height: 956 },
  // Google
  { id: 'pixel-9', label: 'Pixel 9', width: 412, height: 915 },
  { id: 'pixel-9-pro', label: 'Pixel 9 Pro', width: 412, height: 915 },
  { id: 'pixel-10', label: 'Pixel 10', width: 412, height: 915 },
  // 华为（公开 CSS 少，按同代安卓默认缩放估算）
  { id: 'huawei-pura70', label: '华为 Pura 70', width: 360, height: 780 },
  { id: 'huawei-pura70-ultra', label: '华为 Pura 70 Ultra', width: 412, height: 915 },
  { id: 'huawei-mate70', label: '华为 Mate 70', width: 390, height: 844 },
  { id: 'huawei-mate70-pro', label: '华为 Mate 70 Pro', width: 412, height: 915 },
  { id: 'huawei-mate-xt', label: '华为 Mate XT', width: 372, height: 832 },
  // 小米 17 / 18（1080 系≈393；高分旗舰≈412；Pro Max 大屏≈440）
  { id: 'xiaomi-17', label: '小米 17', width: 393, height: 873 },
  { id: 'xiaomi-17-pro', label: '小米 17 Pro', width: 412, height: 915 },
  { id: 'xiaomi-17-ultra', label: '小米 17 Ultra', width: 412, height: 915 },
  { id: 'xiaomi-18', label: '小米 18', width: 393, height: 873 },
  { id: 'xiaomi-18-pro', label: '小米 18 Pro', width: 412, height: 915 },
  { id: 'xiaomi-18-pm', label: '小米 18 Pro Max', width: 440, height: 956 },
  { id: 'xiaomi-18-ultra', label: '小米 18 Ultra', width: 440, height: 956 },
  { id: 'redmi-k80', label: '红米 K80', width: 402, height: 874 },
  { id: 'redmi-k80-pro', label: '红米 K80 Pro', width: 412, height: 915 },
  // OPPO Find X9（物理÷3：X9≈419×920，Pro≈424×924，Ultra≈480×1056）
  { id: 'oppo-find-x9', label: 'OPPO Find X9', width: 420, height: 920 },
  { id: 'oppo-find-x9-pro', label: 'OPPO Find X9 Pro', width: 424, height: 924 },
  { id: 'oppo-find-x9-ultra', label: 'OPPO Find X9 Ultra', width: 480, height: 1056 },
  // vivo X200 / X300（X200/X300 Pro：1260×2800÷3≈420×933；Ultra：1440×3168÷3≈480×1056）
  { id: 'vivo-x200', label: 'vivo X200', width: 412, height: 915 },
  { id: 'vivo-x200-pro', label: 'vivo X200 Pro', width: 420, height: 933 },
  { id: 'vivo-x200-ultra', label: 'vivo X200 Ultra', width: 480, height: 1056 },
  { id: 'vivo-x300', label: 'vivo X300', width: 412, height: 915 },
  { id: 'vivo-x300-pro', label: 'vivo X300 Pro', width: 420, height: 933 },
  { id: 'vivo-x300-ultra', label: 'vivo X300 Ultra', width: 480, height: 1056 },
  // 三星 — YesViz：S25 360×780；S25+/Ultra 默认缩放约 412×891
  { id: 'samsung-s25', label: '三星 S25', width: 360, height: 780 },
  { id: 'samsung-s25-plus', label: '三星 S25+', width: 412, height: 891 },
  { id: 'samsung-s25-ultra', label: '三星 S25 Ultra', width: 412, height: 891 },
  { id: 'samsung-zfold6', label: '三星 Z Fold6 外屏', width: 344, height: 882 },
  { id: 'samsung-zflip6', label: '三星 Z Flip6', width: 360, height: 780 },
]

const COLLAPSE_KEY = 'hadice-web-peek-toolbar-collapsed'
/** 展开后无操作自动收起 */
const AUTO_COLLAPSE_MS = 8000
/** 与 CSS .web-peek-bar 宽度过渡一致（略慢更好感知） */
const BAR_WIDTH_MS = 680

function readInitialUrl(): string {
  try {
    return normalizeWebPeekUrl(new URLSearchParams(window.location.search).get('url') ?? '')
  } catch {
    return ''
  }
}

/**
 * 网页看看 · 悬浮工具条：同一长条 morph（宽由快到慢变长/变短，文字随长度淡入淡出）。
 */
export function WebPeekViewerPage(): React.JSX.Element {
  const initial = useMemo(readInitialUrl, [])
  const [urlInput, setUrlInput] = useState(initial)
  const [deviceId, setDeviceId] = useState('desktop')
  /** 视觉展开（CSS width） */
  const [barOpen, setBarOpen] = useState(false)
  /** 原生窗已是展开尺寸（收起动画期间仍为大窗） */
  const [shellWide, setShellWide] = useState(false)
  const [busy, setBusy] = useState<'open' | 'size' | 'devtools' | 'browser' | null>(null)
  const [idleToken, setIdleToken] = useState(0)

  const animLock = useRef(false)
  const barOpenRef = useRef(false)
  barOpenRef.current = barOpen
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const pendingCollapseShell = useRef(false)

  const syncCollapsedWindow = useCallback(async (collapsed: boolean): Promise<void> => {
    try {
      await App.SetWebPeekToolbarCollapsed(collapsed)
    } catch (err) {
      console.error('[WebPeekViewer] SetWebPeekToolbarCollapsed failed:', err)
    }
  }, [])

  const persistCollapsed = useCallback((collapsed: boolean): void => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [])

  const bumpIdle = useCallback((): void => {
    setIdleToken((n) => n + 1)
  }, [])

  /** 展开：先扩原生窗，再 Morph 变长 + 文字淡入 */
  const expandNow = useCallback((): void => {
    if (animLock.current || barOpenRef.current) return
    animLock.current = true
    persistCollapsed(false)
    void syncCollapsedWindow(false).then(() => {
      setShellWide(true)
      // 双 rAF：保证从收起宽度起步再过渡到展开，否则无动画
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setBarOpen(true)
          window.setTimeout(() => {
            animLock.current = false
          }, BAR_WIDTH_MS)
        })
      })
    })
  }, [persistCollapsed, syncCollapsedWindow])

  const finishCollapseShell = useCallback((): void => {
    if (!pendingCollapseShell.current) return
    pendingCollapseShell.current = false
    void syncCollapsedWindow(true).finally(() => {
      setShellWide(false)
      animLock.current = false
    })
  }, [syncCollapsedWindow])

  /** 收起：Morph 变短 + 文字淡出，结束后再缩原生窗 */
  const collapseNow = useCallback((): void => {
    if (animLock.current || !barOpenRef.current) return
    animLock.current = true
    pendingCollapseShell.current = true
    setBarOpen(false)
    persistCollapsed(true)
    // 兜底：部分环境 transitionend 不触发
    window.setTimeout(finishCollapseShell, BAR_WIDTH_MS + 40)
  }, [persistCollapsed, finishCollapseShell])

  const onBarTransitionEnd = useCallback(
    (e: React.TransitionEvent<HTMLDivElement>): void => {
      if (e.propertyName !== 'width') return
      finishCollapseShell()
    },
    [finishCollapseShell]
  )

  // 展开态：8 秒无操作自动收起
  useEffect(() => {
    if (!barOpen) return
    const timer = window.setTimeout(() => collapseNow(), AUTO_COLLAPSE_MS)
    return () => window.clearTimeout(timer)
  }, [barOpen, collapseNow, idleToken])

  useEffect(() => {
    if (initial) setUrlInput(initial)
    void syncCollapsedWindow(true)
  }, [initial, syncCollapsedWindow])

  const applyDeviceSize = useCallback(async (id: string): Promise<void> => {
    const device = DEVICE_PRESETS.find((d) => d.id === id) ?? DEVICE_PRESETS[0]
    setBusy('size')
    try {
      await App.SetWebPeekContentSize(device.width, device.height)
      collapseNow()
    } catch (err) {
      console.error('[WebPeekViewer] SetWebPeekContentSize failed:', err)
      toast.error(err instanceof Error ? err.message : '调整窗口尺寸失败')
    } finally {
      setBusy(null)
    }
  }, [collapseNow])

  const openContent = useCallback(async (raw: string): Promise<void> => {
    const url = normalizeWebPeekUrl(raw)
    if (!url) {
      toast.error('请输入有效的 http/https 地址')
      return
    }
    setUrlInput(url)
    setBusy('open')
    try {
      await App.OpenWebPeekFullWindow(url)
      rememberWebPeekUrl(url)
      const device = DEVICE_PRESETS.find((d) => d.id === deviceId) ?? DEVICE_PRESETS[0]
      await App.SetWebPeekContentSize(device.width, device.height)
      collapseNow()
    } catch (err) {
      console.error('[WebPeekViewer] open content failed:', err)
      toast.error(err instanceof Error ? err.message : '打开失败')
    } finally {
      setBusy(null)
    }
  }, [deviceId, collapseNow])

  const openDevTools = useCallback(async (): Promise<void> => {
    setBusy('devtools')
    try {
      await App.OpenWebPeekDevTools()
      collapseNow()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '打开 DevTools 失败')
    } finally {
      setBusy(null)
    }
  }, [collapseNow])

  const openBrowser = useCallback(async (): Promise<void> => {
    setBusy('browser')
    try {
      await openSystemBrowser(urlInput)
      collapseNow()
    } finally {
      setBusy(null)
    }
  }, [urlInput, collapseNow])

  /** 收起态：拖动 / 单击展开 */
  const onFabPointerDown = (e: React.PointerEvent<HTMLButtonElement>): void => {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.screenX, y: e.screenY, moved: false }
  }
  const onFabPointerMove = (e: React.PointerEvent<HTMLButtonElement>): void => {
    const d = drag.current
    if (!d || e.buttons === 0) return
    const dx = Math.round(e.screenX - d.x)
    const dy = Math.round(e.screenY - d.y)
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 5) return
    d.moved = true
    d.x = e.screenX
    d.y = e.screenY
    void App.MoveWebPeekToolbarBy(dx, dy).catch(() => undefined)
  }
  const onFabPointerUp = (): void => {
    const d = drag.current
    drag.current = null
    if (!d?.moved) expandNow()
  }

  return (
    <div
      className={cn(
        'flex h-full w-full items-center bg-transparent',
        shellWide || barOpen ? 'justify-end px-1 py-1' : 'justify-center p-0.5'
      )}
      onPointerDown={barOpen ? bumpIdle : undefined}
      onKeyDown={barOpen ? bumpIdle : undefined}
    >
      <div
        className={cn('web-peek-bar', barOpen && 'is-open')}
        onTransitionEnd={onBarTransitionEnd}
      >
        {/* 收起：圆形入口；展开过程中藏掉以免抢位 */}
        <button
          type="button"
          title="单击展开 · 拖动可移动"
          aria-hidden={barOpen}
          tabIndex={barOpen ? -1 : 0}
          className={cn(
            'web-peek-bar-fab flex h-9 w-9 shrink-0 cursor-grab items-center justify-center rounded-full',
            'text-foreground active:cursor-grabbing hover:bg-secondary/60',
            barOpen && 'pointer-events-none w-0 overflow-hidden opacity-0'
          )}
          onPointerDown={onFabPointerDown}
          onPointerMove={onFabPointerMove}
          onPointerUp={onFabPointerUp}
          onPointerCancel={() => {
            drag.current = null
          }}
        >
          <ChevronDown className="h-4 w-4 pointer-events-none" />
        </button>

        {/* 展开内容：随宽度淡入淡出 */}
        <div className="web-peek-bar-body">
          <Smartphone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <form
            className="flex min-w-0 flex-1 items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault()
              bumpIdle()
              void openContent(urlInput)
            }}
          >
            <div className="relative min-w-0 flex-1">
              <Input
                value={urlInput}
                onChange={(e) => {
                  bumpIdle()
                  setUrlInput(e.target.value)
                }}
                className="h-7 w-full border-0 bg-transparent pr-6 font-mono text-[11px] shadow-none focus-visible:ring-0"
                placeholder="https://…"
                spellCheck={false}
                autoComplete="off"
              />
              {urlInput.length > 0 && (
                <button
                  type="button"
                  title="清除"
                  className="absolute right-0.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground opacity-40 hover:opacity-100"
                  onClick={() => {
                    bumpIdle()
                    setUrlInput('')
                  }}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
            <Button type="submit" size="sm" className="h-7 shrink-0 px-2 text-xs" disabled={busy !== null}>
              {busy === 'open' ? <Loader2 className="h-3 w-3 animate-spin" /> : '打开'}
            </Button>
          </form>

          <select
            className="h-7 max-w-[12rem] rounded-md border border-input bg-background px-1.5 text-[11px]"
            value={deviceId}
            disabled={busy !== null}
            title="默认桌面；切移动端缩小内容窗"
            onChange={(e) => {
              bumpIdle()
              const id = e.target.value
              setDeviceId(id)
              void applyDeviceSize(id)
            }}
          >
            {DEVICE_PRESETS.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
                {d.width > 0 ? ` ${d.width}` : ''}
              </option>
            ))}
          </select>

          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 gap-1 shrink-0 px-2 text-xs"
            disabled={busy !== null}
            title="DevTools"
            onClick={() => void openDevTools()}
          >
            {busy === 'devtools' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wrench className="h-3 w-3" />}
            DevTools
          </Button>

          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 gap-1 shrink-0 px-2 text-xs"
            disabled={busy !== null || !urlInput.trim()}
            title="系统浏览器"
            onClick={() => void openBrowser()}
          >
            {busy === 'browser' ? <Loader2 className="h-3 w-3 animate-spin" /> : <ExternalLink className="h-3 w-3" />}
            系统浏览器
          </Button>

          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 w-7 shrink-0 p-0"
            title="聚焦内容窗"
            onClick={() => {
              void App.FocusWebPeekContent().catch(() => undefined)
              collapseNow()
            }}
          >
            <PanelRightOpen className="h-3.5 w-3.5" />
          </Button>

          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 w-7 shrink-0 p-0"
            title="收缩工具条"
            onClick={collapseNow}
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}
