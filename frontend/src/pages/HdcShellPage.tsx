import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { captureEvent } from '@/lib/posthog'
import {
  Terminal as TerminalIcon,
  RefreshCw,
  Plus,
  ChevronDown,
  Trash2,
  X
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel
} from '@/components/ui/dropdown-menu'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SerializeAddon } from '@xterm/addon-serialize'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { AddCommandDialog } from '@/components/dialogs/AddCommandDialog'
import { WindowToggleButton } from '@/components/layout/WindowToggleButton'
import { HelpToggleButton } from '@/components/layout/HelpToggleButton'
import { useCommandStore } from '@/store/commandStore'
import {
  SHELL_FLUSH_EVENT,
  useShellSessionStore
} from '@/store/shellSessionStore'
import { peekShellHandoff } from '@/lib/shell-handoff'
import { isHdcAvailable } from '@/lib/hdc'
import { getTerminalTheme } from '@/lib/theme'
import { useThemeStore } from '@/store/themeStore'
import { cn } from '@/lib/utils'
import '@xterm/xterm/css/xterm.css'

/** xterm-v1:COLxROW:serialized —— 按原尺寸回放，再 fit 到当前窗口 */
const SHELL_SNAPSHOT_PREFIX = 'xterm-v1:'

function encodeShellSnapshot(terminal: Terminal, serializeAddon: SerializeAddon): string {
  return `${SHELL_SNAPSHOT_PREFIX}${terminal.cols}x${terminal.rows}:${serializeAddon.serialize()}`
}

function decodeShellSnapshot(
  snapshot: string
): { cols: number; rows: number; data: string } | null {
  if (!snapshot.startsWith(SHELL_SNAPSHOT_PREFIX)) return null
  const rest = snapshot.slice(SHELL_SNAPSHOT_PREFIX.length)
  const match = /^(\d+)x(\d+):([\s\S]*)$/.exec(rest)
  if (match) {
    return {
      cols: Number(match[1]),
      rows: Number(match[2]),
      data: match[3]
    }
  }
  // 兼容旧格式 xterm-v1:<serialized>
  return { cols: 0, rows: 0, data: rest }
}

async function pushShellUIStateToBackend(): Promise<void> {
  if (!isHdcAvailable()) return
  const state = useShellSessionStore.getState().toBackendState()
  await window.hdc.setShellUIState(state)
}

async function pullShellUIStateFromBackend(): Promise<void> {
  // 优先用主窗已收下的 handoff（回切瞬间），再 Get 后端
  const handoff = peekShellHandoff(true)
  if (handoff?.tabs?.length) {
    useShellSessionStore.getState().applyBackendState(handoff)
    return
  }
  if (!isHdcAvailable()) return
  const state = await window.hdc.getShellUIState()
  if (state.tabs.length > 0) {
    useShellSessionStore.getState().applyBackendState(state)
  } else {
    useShellSessionStore.setState({ hydrated: true })
  }
}

function waitForContainerSize(
  el: HTMLElement,
  timeoutMs = 2000
): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const ready = (): boolean => el.clientWidth >= 40 && el.clientHeight >= 40
    if (ready()) {
      resolve({ width: el.clientWidth, height: el.clientHeight })
      return
    }
    const started = Date.now()
    const observer = new ResizeObserver(() => {
      if (ready()) {
        observer.disconnect()
        resolve({ width: el.clientWidth, height: el.clientHeight })
      }
    })
    observer.observe(el)
    const timer = window.setInterval(() => {
      if (ready() || Date.now() - started > timeoutMs) {
        window.clearInterval(timer)
        observer.disconnect()
        resolve({ width: el.clientWidth, height: el.clientHeight })
      }
    }, 50)
  })
}

interface HdcShellPageProps {
  /** 页面是否可见（keep-alive 隐藏时仍为 false，用于 fit） */
  visible?: boolean
}

interface ShellSessionPaneProps {
  shellId: string
  active: boolean
  pageVisible: boolean
  restartToken: number
}

/**
 * 单个终端会话。
 * 卸载时只退订事件，不杀 PTY，便于主窗 / 独立窗切换后附着同一会话。
 */
function ShellSessionPane({
  shellId,
  active,
  pageVisible,
  restartToken
}: ShellSessionPaneProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const serializeAddonRef = useRef<SerializeAddon | null>(null)
  const runningRef = useRef(false)
  const lifecycleRef = useRef(0)
  const snapshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const unsubsRef = useRef<Array<() => void>>([])
  const theme = useThemeStore((s) => s.theme)
  const lastRestartTokenRef = useRef(restartToken)
  const setSnapshot = useShellSessionStore((s) => s.setSnapshot)
  const clearSnapshot = useShellSessionStore((s) => s.clearSnapshot)

  const cleanupUnsubs = useCallback(() => {
    for (const unsub of unsubsRef.current) unsub()
    unsubsRef.current = []
  }, [])

  const fitAndResize = useCallback(async () => {
    try {
      const el = containerRef.current
      if (!el || el.clientWidth < 40 || el.clientHeight < 40) return
      fitAddonRef.current?.fit()
      const dimensions = fitAddonRef.current?.proposeDimensions()
      if (dimensions && dimensions.cols > 2 && dimensions.rows > 2) {
        await window.hdc.resizeShell(shellId, dimensions.cols, dimensions.rows)
      }
    } catch {
      // ignore fit races while hidden
    }
  }, [shellId])

  const saveSnapshot = useCallback(() => {
    if (!terminalRef.current || !serializeAddonRef.current) return
    try {
      const encoded = encodeShellSnapshot(
        terminalRef.current,
        serializeAddonRef.current
      )
      if (!encoded || encoded.length < SHELL_SNAPSHOT_PREFIX.length + 4) return
      setSnapshot(shellId, encoded)
      void window.hdc.setShellSnapshot(shellId, encoded)
    } catch {
      // terminal may be disposing
    }
  }, [shellId, setSnapshot])

  const scheduleSnapshot = useCallback(() => {
    if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current)
    snapshotTimerRef.current = setTimeout(saveSnapshot, 80)
  }, [saveSnapshot])

  const subscribeAndStart = useCallback(async (lifecycle: number) => {
    if (!isHdcAvailable()) return

    cleanupUnsubs()

    try {
      if (containerRef.current) {
        await waitForContainerSize(containerRef.current)
      }
      if (lifecycleRef.current !== lifecycle) return
      // 有尺寸后再 fit，避免 0 高清屏
      await fitAndResize()
      if (lifecycleRef.current !== lifecycle) return

      const wasRunning = await window.hdc.isShellRunning(shellId)
      if (lifecycleRef.current !== lifecycle) return

      const pendingStdout: string[] = []
      let acceptingLive = !wasRunning

      const subscribe = (): void => {
        const onStdout = window.hdc.onShellStdout(shellId, (data: string) => {
          if (lifecycleRef.current !== lifecycle) return
          if (!acceptingLive) {
            pendingStdout.push(data)
            return
          }
          terminalRef.current?.write(data, scheduleSnapshot)
        })
        const onExit = window.hdc.onShellExit(
          shellId,
          (data: { code: number | null; signal: string | null }) => {
            if (lifecycleRef.current !== lifecycle) return
            runningRef.current = false
            cleanupUnsubs()
            const codeStr = data.code !== null ? String(data.code) : 'unknown'
            const signalStr = data.signal || ''
            terminalRef.current?.writeln(
              `\r\n\x1b[33m[进程退出] 退出码: ${codeStr}${signalStr ? `, 信号: ${signalStr}` : ''}\x1b[0m\r\n`
            )
            scheduleSnapshot()
          }
        )
        unsubsRef.current = [onStdout, onExit]
      }

      subscribe()

      const success = await window.hdc.startShell(shellId)
      if (lifecycleRef.current !== lifecycle) return
      if (!success) {
        runningRef.current = false
        cleanupUnsubs()
        terminalRef.current?.writeln('\r\n\x1b[31m[错误] 无法启动终端进程\x1b[0m\r\n')
        return
      }
      runningRef.current = true

      if (wasRunning && terminalRef.current) {
        const fromStore = useShellSessionStore.getState().snapshots[shellId] || ''
        const fromBackend = (await window.hdc.getShellSnapshot(shellId)) || ''
        const snapshot = fromStore || fromBackend
        if (lifecycleRef.current !== lifecycle) return

        const decoded = decodeShellSnapshot(snapshot)
        if (decoded?.data) {
          terminalRef.current.reset()
          if (decoded.cols > 2 && decoded.rows > 2) {
            terminalRef.current.resize(decoded.cols, decoded.rows)
          }
          await new Promise<void>((resolve) => {
            terminalRef.current?.write(decoded.data, () => resolve())
          })
          terminalRef.current.scrollToBottom()
        } else {
          // serialize 缺失时回退 raw scrollback，总比空白强
          const scrollback = await window.hdc.getShellScrollback(shellId)
          if (lifecycleRef.current !== lifecycle) return
          terminalRef.current.reset()
          if (scrollback) {
            await new Promise<void>((resolve) => {
              terminalRef.current?.write(scrollback, () => resolve())
            })
            terminalRef.current.scrollToBottom()
          } else {
            await window.hdc.writeToShell(shellId, '\x0c')
          }
        }
        acceptingLive = true
        for (const chunk of pendingStdout) {
          terminalRef.current?.write(chunk)
        }
        pendingStdout.length = 0
        scheduleSnapshot()
      }

      // 布局稳定后再 fit 一两次
      await fitAndResize()
      requestAnimationFrame(() => {
        void fitAndResize()
      })
    } catch (error) {
      runningRef.current = false
      cleanupUnsubs()
      terminalRef.current?.writeln(
        `\r\n\x1b[31m[错误] ${error instanceof Error ? error.message : String(error)}\x1b[0m\r\n`
      )
    }
  }, [
    shellId,
    cleanupUnsubs,
    fitAndResize,
    scheduleSnapshot
  ])

  useEffect(() => {
    if (!containerRef.current || !isHdcAvailable()) return

    const lifecycle = ++lifecycleRef.current
    const terminal = new Terminal({
      theme: getTerminalTheme(useThemeStore.getState().theme),
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorWidth: 2,
      scrollback: 5000,
      disableStdin: false,
      allowProposedApi: true,
      convertEol: true,
      windowsMode: false
    })
    const fitAddon = new FitAddon()
    const serializeAddon = new SerializeAddon()
    terminal.loadAddon(fitAddon)
    terminal.loadAddon(serializeAddon)
    terminal.loadAddon(new WebLinksAddon())
    const unicode11Addon = new Unicode11Addon()
    terminal.loadAddon(unicode11Addon)
    terminal.unicode.activeVersion = '11'
    terminal.open(containerRef.current)

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon
    serializeAddonRef.current = serializeAddon

    const inputDisposable = terminal.onData((data: string) => {
      if (lifecycleRef.current === lifecycle && runningRef.current) {
        void window.hdc.writeToShell(shellId, data)
      }
    })

    // fish / vim 等会发 DECSCUSR 把光标改回 block，写入后强制锁回细竖线
    const lockBarCursor = (): void => {
      if (terminal.options.cursorStyle !== 'bar') {
        terminal.options.cursorStyle = 'bar'
      }
      if (terminal.options.cursorWidth !== 2) {
        terminal.options.cursorWidth = 2
      }
    }
    const writeParsedDisposable = terminal.onWriteParsed(lockBarCursor)

    const onResize = () => {
      void fitAndResize()
    }
    window.addEventListener('resize', onResize)
    const observer = new ResizeObserver(() => {
      void fitAndResize()
    })
    observer.observe(containerRef.current)

    const onFlush = (): void => {
      saveSnapshot()
    }
    window.addEventListener(SHELL_FLUSH_EVENT, onFlush)

    void subscribeAndStart(lifecycle)
    void fitAndResize()

    return () => {
      // 先使所有尚未完成的异步初始化和回调失效，再释放资源。
      if (lifecycleRef.current === lifecycle) lifecycleRef.current += 1
      window.removeEventListener('resize', onResize)
      window.removeEventListener(SHELL_FLUSH_EVENT, onFlush)
      observer.disconnect()
      inputDisposable.dispose()
      writeParsedDisposable.dispose()
      if (snapshotTimerRef.current) {
        clearTimeout(snapshotTimerRef.current)
        snapshotTimerRef.current = null
      }
      saveSnapshot()
      cleanupUnsubs()
      // ponytail: 不在此 stopShell，PTY 留给另一窗口附着；关 Tab / 重启才杀
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
      serializeAddonRef.current = null
      runningRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shellId])

  // 仅「重启终端」清屏并重建 PTY
  useEffect(() => {
    if (restartToken === lastRestartTokenRef.current) return
    lastRestartTokenRef.current = restartToken

    const run = async (): Promise<void> => {
      cleanupUnsubs()
      clearSnapshot(shellId)
      terminalRef.current?.clear()
      try {
        await window.hdc.restartShell(shellId)
        runningRef.current = true
        const onStdout = window.hdc.onShellStdout(shellId, (data: string) => {
          terminalRef.current?.write(data, scheduleSnapshot)
        })
        const onExit = window.hdc.onShellExit(
          shellId,
          (data: { code: number | null; signal: string | null }) => {
            runningRef.current = false
            cleanupUnsubs()
            const codeStr = data.code !== null ? String(data.code) : 'unknown'
            const signalStr = data.signal || ''
            terminalRef.current?.writeln(
              `\r\n\x1b[33m[进程退出] 退出码: ${codeStr}${signalStr ? `, 信号: ${signalStr}` : ''}\x1b[0m\r\n`
            )
          }
        )
        unsubsRef.current = [onStdout, onExit]
        await fitAndResize()
      } catch (error) {
        runningRef.current = false
        terminalRef.current?.writeln(
          `\r\n\x1b[31m[错误] ${error instanceof Error ? error.message : String(error)}\x1b[0m\r\n`
        )
      }
    }
    void run()
  }, [
    restartToken,
    shellId,
    cleanupUnsubs,
    clearSnapshot,
    fitAndResize,
    scheduleSnapshot
  ])

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.theme = getTerminalTheme(theme)
    }
  }, [theme])

  useEffect(() => {
    if (active && pageVisible) {
      const timer = setTimeout(() => {
        void fitAndResize()
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [active, pageVisible, fitAndResize])

  return (
    <div
      ref={containerRef}
      className="w-full h-full p-2"
      style={{ minHeight: 0, minWidth: 0 }}
    />
  )
}

/**
 * 终端命令页面
 * keep-alive + 多 Tab；主窗/独立窗通过持久化 shellId 附着同一后端会话
 */
export function HdcShellPage({ visible = true }: HdcShellPageProps): React.JSX.Element {
  const tabs = useShellSessionStore((s) => s.tabs)
  const activeTabId = useShellSessionStore((s) => s.activeTabId)
  const ensureDefaultTab = useShellSessionStore((s) => s.ensureDefaultTab)
  const addTab = useShellSessionStore((s) => s.addTab)
  const closeTabInStore = useShellSessionStore((s) => s.closeTab)
  const setActiveTabId = useShellSessionStore((s) => s.setActiveTabId)

  const [restartTokens, setRestartTokens] = useState<Record<string, number>>({})
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  // 必须等后端 UI state 拉齐后再挂 xterm，避免用内存里的旧 shellId/快照
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    setReady(false)
    const boot = async (): Promise<void> => {
      await pullShellUIStateFromBackend()
      if (cancelled) return
      ensureDefaultTab()
      // 不在 boot 里 push：避免独立窗空状态覆盖主窗刚写入的快照
      if (!cancelled) setReady(true)
    }
    void boot()
    return () => {
      cancelled = true
    }
  }, [ensureDefaultTab])

  // tabs / 激活态变更时同步到后端（空 snapshots 不会覆盖后端已有内容）
  useEffect(() => {
    if (!ready) return
    void pushShellUIStateToBackend()
  }, [ready, tabs, activeTabId])

  const { getAllCommands, removeCommand } = useCommandStore()
  const allCommands = useMemo(() => getAllCommands(), [getAllCommands])
  const builtInCommands = useMemo(
    () => allCommands.filter((cmd) => cmd.id.startsWith('builtin-')),
    [allCommands]
  )
  const customCommands = useMemo(
    () => allCommands.filter((cmd) => cmd.id.startsWith('custom-')),
    [allCommands]
  )

  const handleAddTab = useCallback(() => {
    addTab()
    captureEvent('shell tab created')
  }, [addTab])

  const handleCloseTab = useCallback(
    (tabId: string, e?: React.MouseEvent) => {
      e?.stopPropagation()
      if (tabs.length <= 1) return
      void window.hdc.stopShell(tabId).catch(() => undefined)
      closeTabInStore(tabId)
      setRestartTokens((prev) => {
        const copy = { ...prev }
        delete copy[tabId]
        return copy
      })
      captureEvent('shell tab closed')
    },
    [tabs.length, closeTabInStore]
  )

  const restartActiveShell = useCallback(() => {
    if (!activeTabId) return
    captureEvent('shell restarted')
    setRestartTokens((prev) => ({
      ...prev,
      [activeTabId]: (prev[activeTabId] || 0) + 1
    }))
  }, [activeTabId])

  const executeCommand = useCallback(
    (command: string) => {
      if (!activeTabId) return
      captureEvent('shell quick command executed', { command })
      void window.hdc.writeToShell(activeTabId, command)
    },
    [activeTabId]
  )

  const handleAddCommand = useCallback((name: string, command: string) => {
    captureEvent('shortcut command added', { name })
    useCommandStore.getState().addCommand(name, command)
  }, [])

  const handleRemoveCommand = useCallback(
    (id: string, e: React.MouseEvent) => {
      e.stopPropagation()
      captureEvent('shortcut command deleted')
      removeCommand(id)
    },
    [removeCommand]
  )

  return (
    <div className="p-6 h-full flex flex-col">
      <div className="mb-4 flex items-center justify-between flex-shrink-0">
        <h1 className="text-2xl font-bold flex items-center gap-3">
          <TerminalIcon className="h-6 w-6 text-primary" />
          终端命令
          <WindowToggleButton />
          <HelpToggleButton />
        </h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-2" onClick={handleAddTab}>
            <Plus className="h-4 w-4" />
            新建终端
          </Button>
          <Button variant="outline" size="sm" className="gap-2" onClick={restartActiveShell}>
            <RefreshCw className="h-4 w-4" />
            重启终端
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                快捷命令
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80 max-h-[600px] overflow-y-auto">
              {builtInCommands.length > 0 && (
                <>
                  <DropdownMenuLabel className="text-xs text-muted-foreground">
                    内置命令
                  </DropdownMenuLabel>
                  {builtInCommands.map((cmd) => (
                    <DropdownMenuItem
                      key={cmd.id}
                      className="flex flex-col items-start gap-1 py-2 cursor-pointer"
                      onClick={() => executeCommand(cmd.command)}
                    >
                      <div className="font-medium w-full">{cmd.name}</div>
                      <div className="text-xs text-muted-foreground font-mono break-all">
                        {cmd.command}
                      </div>
                    </DropdownMenuItem>
                  ))}
                </>
              )}

              {customCommands.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs text-muted-foreground">
                    自定义命令
                  </DropdownMenuLabel>
                  {customCommands.map((cmd) => (
                    <DropdownMenuItem
                      key={cmd.id}
                      className="flex flex-col items-start gap-1 py-2 cursor-pointer group"
                      onClick={() => executeCommand(cmd.command)}
                    >
                      <div className="flex items-center justify-between w-full">
                        <div className="font-medium">{cmd.name}</div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={(e) => handleRemoveCommand(cmd.id, e)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                      <div className="text-xs text-muted-foreground font-mono break-all">
                        {cmd.command}
                      </div>
                    </DropdownMenuItem>
                  ))}
                </>
              )}

              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setIsAddDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                添加快捷命令
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Card className="flex-1 min-h-0 overflow-hidden flex flex-col">
        <div className="flex items-center gap-1 border-b px-2 pt-2 pb-0 overflow-x-auto flex-shrink-0">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTabId(tab.id)}
                className={cn(
                  'group inline-flex items-center gap-1.5 rounded-t-md border border-b-0 px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors',
                  isActive
                    ? 'bg-primary/15 text-primary border-primary/40 shadow-[inset_0_-2px_0_0_hsl(var(--primary))]'
                    : 'bg-muted/30 text-muted-foreground border-transparent hover:bg-muted/60 hover:text-foreground'
                )}
              >
                <TerminalIcon className={cn('h-3 w-3', isActive && 'text-primary')} />
                <span>{tab.title}</span>
                {tabs.length > 1 && (
                  <span
                    role="button"
                    tabIndex={0}
                    className="ml-0.5 rounded p-0.5 opacity-60 hover:opacity-100 hover:bg-accent"
                    onClick={(e) => handleCloseTab(tab.id, e)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') handleCloseTab(tab.id)
                    }}
                  >
                    <X className="h-3 w-3" />
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <div className="relative flex-1 min-h-0">
          {ready &&
            tabs.map((tab) => (
              <div
                key={tab.id}
                className={cn(
                  'absolute inset-0',
                  tab.id === activeTabId ? 'visible' : 'invisible pointer-events-none'
                )}
              >
                <ShellSessionPane
                  shellId={tab.id}
                  active={tab.id === activeTabId}
                  pageVisible={visible}
                  restartToken={restartTokens[tab.id] || 0}
                />
              </div>
            ))}
        </div>
      </Card>

      <AddCommandDialog
        open={isAddDialogOpen}
        onOpenChange={setIsAddDialogOpen}
        onAdd={handleAddCommand}
      />
    </div>
  )
}
