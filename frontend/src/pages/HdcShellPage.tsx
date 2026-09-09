import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { captureEvent } from '@/lib/posthog'
import { Terminal as TerminalIcon, RefreshCw, Plus, ChevronDown, Trash2 } from 'lucide-react'
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
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { AddCommandDialog } from '@/components/dialogs/AddCommandDialog'
import { WindowToggleButton } from '@/components/layout/WindowToggleButton'
import { HelpToggleButton } from '@/components/layout/HelpToggleButton'
import { useCommandStore } from '@/store/commandStore'
import { isHdcAvailable } from '@/lib/hdc'
import '@xterm/xterm/css/xterm.css'

/**
 * 终端命令页面
 * 使用 node-pty + xterm.js 实现真正的本地 shell 终端
 */
export function HdcShellPage(): React.JSX.Element {

  // 终端相关引用
  const terminalRef = useRef<HTMLDivElement>(null)
  const terminalInstanceRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const shellIdRef = useRef<string>('local-shell-1')
  const isShellRunningRef = useRef<boolean>(false)
  // 事件监听器清理函数引用
  const stdoutUnsubscribeRef = useRef<(() => void) | null>(null)
  const exitUnsubscribeRef = useRef<(() => void) | null>(null)
  const errorUnsubscribeRef = useRef<(() => void) | null>(null)
  // 用于跟踪组件是否已卸载
  const isMountedRef = useRef<boolean>(true)

  // 状态
  const [isTerminalReady, setIsTerminalReady] = useState(false)
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)

  // 快捷命令 store
  const { getAllCommands, removeCommand } = useCommandStore()
  
  // 获取所有命令（内置 + 自定义）
  const allCommands = useMemo(() => getAllCommands(), [getAllCommands])
  
  // 分离内置命令和自定义命令
  const builtInCommands = useMemo(() => allCommands.filter(cmd => cmd.id.startsWith('builtin-')), [allCommands])
  const customCommands = useMemo(() => allCommands.filter(cmd => cmd.id.startsWith('custom-')), [allCommands])

  /**
   * 初始化 xterm.js 终端
   */
  useEffect(() => {
    if (!terminalRef.current || !isHdcAvailable()) return

    // 创建终端实例
    const terminal = new Terminal({
      theme: {
        background: '#0a0a0b',
        foreground: '#fafafa',
        cursor: '#fafafa',
        cursorAccent: '#0a0a0b',
        black: '#000000',
        red: '#ef4444',
        green: '#22c55e',
        yellow: '#eab308',
        blue: '#3b82f6',
        magenta: '#a855f7',
        cyan: '#06b6d4',
        white: '#fafafa',
        brightBlack: '#525252',
        brightRed: '#ef4444',
        brightGreen: '#22c55e',
        brightYellow: '#eab308',
        brightBlue: '#3b82f6',
        brightMagenta: '#a855f7',
        brightCyan: '#06b6d4',
        brightWhite: '#ffffff'
      },
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 1000,
      disableStdin: false, // 允许输入
      allowProposedApi: true,
      convertEol: true,
      windowsMode: false
    })

    // 创建并加载 addons
    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()
    const unicode11Addon = new Unicode11Addon()

    terminal.loadAddon(fitAddon)
    terminal.loadAddon(webLinksAddon)
    terminal.loadAddon(unicode11Addon)
    terminal.unicode.activeVersion = '11'

    // 打开终端
    terminal.open(terminalRef.current)

    // 适配终端大小
    const fitTerminal = () => {
      try {
        fitAddon.fit()
        // 通知主进程调整 PTY 大小
        if (isShellRunningRef.current && terminalInstanceRef.current) {
          const dimensions = fitAddon.proposeDimensions()
          if (dimensions) {
            window.hdc.resizeShell(shellIdRef.current, dimensions.cols, dimensions.rows).catch((err) => {
              console.error('[HdcShell] Failed to resize shell:', err)
            })
          }
        }
      } catch (error) {
        console.warn('[HdcShell] Failed to fit terminal:', error)
      }
    }

    // 延迟适配，确保容器已渲染
    setTimeout(fitTerminal, 100)

    // 保存引用
    terminalInstanceRef.current = terminal
    fitAddonRef.current = fitAddon

    // 监听窗口大小变化
    const handleResize = () => {
      fitTerminal()
    }
    window.addEventListener('resize', handleResize)

    // 使用 ResizeObserver 监听容器大小变化
    const resizeObserver = new ResizeObserver(() => {
      fitTerminal()
    })
    if (terminalRef.current) {
      resizeObserver.observe(terminalRef.current)
    }

    // 监听用户输入
    terminal.onData((data: string) => {
      if (isShellRunningRef.current) {
        window.hdc.writeToShell(shellIdRef.current, data).catch((err) => {
          console.error('[HdcShell] Failed to write to shell:', err)
        })
      }
    })

    setIsTerminalReady(true)

    // 清理函数
    return () => {
      window.removeEventListener('resize', handleResize)
      resizeObserver.disconnect()
      terminal.dispose()
      terminalInstanceRef.current = null
      fitAddonRef.current = null
    }
  }, [])

  /**
   * 清理事件监听器
   */
  const cleanupEventListeners = useCallback(() => {
    if (stdoutUnsubscribeRef.current) {
      stdoutUnsubscribeRef.current()
      stdoutUnsubscribeRef.current = null
    }
    if (exitUnsubscribeRef.current) {
      exitUnsubscribeRef.current()
      exitUnsubscribeRef.current = null
    }
    if (errorUnsubscribeRef.current) {
      errorUnsubscribeRef.current()
      errorUnsubscribeRef.current = null
    }
  }, [])

  /**
   * 启动 shell 进程
   */
  const startShell = useCallback(async () => {
    if (!isHdcAvailable() || isShellRunningRef.current || !isMountedRef.current) return

    // 先清理旧的事件监听器，防止内存泄漏
    cleanupEventListeners()

    try {
      const success = await window.hdc.startShell(shellIdRef.current)
      if (!success) {
        console.error('[HdcShell] Failed to start shell')
        if (terminalInstanceRef.current && isMountedRef.current) {
          terminalInstanceRef.current.writeln('\r\n\x1b[31m[错误] 无法启动终端进程\x1b[0m\r\n')
        }
        return
      }

      // 再次检查组件是否已卸载
      if (!isMountedRef.current) {
        return
      }

      isShellRunningRef.current = true

      // 监听 shell 输出
      stdoutUnsubscribeRef.current = window.hdc.onShellStdout(shellIdRef.current, (data: string) => {
        if (terminalInstanceRef.current && isMountedRef.current) {
          terminalInstanceRef.current.write(data)
        }
      })

      // 监听 shell 退出
      exitUnsubscribeRef.current = window.hdc.onShellExit(shellIdRef.current, (data: { code: number | null; signal: string | null }) => {
        if (!isMountedRef.current) {
          return
        }

        isShellRunningRef.current = false
        if (terminalInstanceRef.current) {
          const codeStr = data.code !== null ? String(data.code) : 'unknown'
          const signalStr = data.signal || ''
          const exitMsg = `\r\n\x1b[33m[进程退出] 退出码: ${codeStr}${signalStr ? `, 信号: ${signalStr}` : ''}\x1b[0m\r\n`
          terminalInstanceRef.current.writeln(exitMsg)
        }
        // 清理所有事件监听器
        cleanupEventListeners()
      })

      // 监听 shell 错误
      errorUnsubscribeRef.current = window.hdc.onShellError(shellIdRef.current, (error: string) => {
        if (!isMountedRef.current) {
          return
        }

        if (terminalInstanceRef.current) {
          terminalInstanceRef.current.writeln(`\r\n\x1b[31m[错误] ${error}\x1b[0m\r\n`)
        }
        isShellRunningRef.current = false
        // 清理所有事件监听器
        cleanupEventListeners()
      })

      // 适配终端大小
      if (fitAddonRef.current && terminalInstanceRef.current) {
        setTimeout(() => {
          try {
            fitAddonRef.current?.fit()
            const dimensions = fitAddonRef.current?.proposeDimensions()
            if (dimensions) {
              window.hdc.resizeShell(shellIdRef.current, dimensions.cols, dimensions.rows).catch((err) => {
                console.error('[HdcShell] Failed to resize shell:', err)
              })
            }
          } catch (error) {
            console.warn('[HdcShell] Failed to fit terminal after shell start:', error)
          }
        }, 300)
      }
    } catch (error) {
      console.error('[HdcShell] Error starting shell:', error)
      if (terminalInstanceRef.current && isMountedRef.current) {
        terminalInstanceRef.current.writeln(`\r\n\x1b[31m[错误] ${error instanceof Error ? error.message : String(error)}\x1b[0m\r\n`)
      }
      // 清理事件监听器（如果已注册）
      cleanupEventListeners()
    }
  }, [cleanupEventListeners])

  /**
   * 重启 shell
   */
  const restartShell = useCallback(async () => {
    captureEvent('shell restarted')
    if (isShellRunningRef.current) {
      try {
        // 先清理事件监听器
        cleanupEventListeners()
        await window.hdc.stopShell(shellIdRef.current)
        isShellRunningRef.current = false
      } catch (error) {
        console.error('[HdcShell] Error stopping shell:', error)
      }
    }

    // 清空终端
    if (terminalInstanceRef.current && isMountedRef.current) {
      terminalInstanceRef.current.clear()
    }

    // 等待一小段时间后重新启动
    setTimeout(() => {
      if (isMountedRef.current) {
        startShell()
      }
    }, 200)
  }, [startShell, cleanupEventListeners])

  /**
   * 当终端就绪后启动 shell
   */
  useEffect(() => {
    if (isTerminalReady && !isShellRunningRef.current) {
      startShell()
    }
  }, [isTerminalReady, startShell])

  /**
   * 组件卸载时清理 shell 和事件监听器
   */
  useEffect(() => {
    isMountedRef.current = true

    return () => {
      // 标记组件已卸载
      isMountedRef.current = false

      // 清理事件监听器
      cleanupEventListeners()

      // 停止 shell 进程
      if (isShellRunningRef.current) {
        window.hdc.stopShell(shellIdRef.current).catch((err) => {
          console.error('[HdcShell] Error stopping shell on unmount:', err)
        })
        isShellRunningRef.current = false
      }
    }
  }, [cleanupEventListeners])

  /**
   * 执行快捷命令
   * 模拟键盘输入，直接将命令写入 shell，就像用户手动输入一样
   */
  const executeCommand = useCallback((command: string) => {
    if (!isShellRunningRef.current) {
      return
    }

    captureEvent('shell quick command executed', { command })

    // 直接通过 IPC 写入到 shell，模拟键盘输入
    // 这样 shell 会正确处理命令，就像用户手动输入一样
    // 命令会显示在终端中，光标在命令末尾，用户可以直接按回车执行
    window.hdc.writeToShell(shellIdRef.current, command).catch((err) => {
      console.error('[HdcShell] Failed to write command to shell:', err)
    })
  }, [])

  /**
   * 处理添加快捷命令
   */
  const handleAddCommand = useCallback((name: string, command: string) => {
    captureEvent('shortcut command added', { name })
    useCommandStore.getState().addCommand(name, command)
  }, [])

  /**
   * 处理删除快捷命令
   */
  const handleRemoveCommand = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation() // 阻止事件冒泡，避免触发命令执行
    captureEvent('shortcut command deleted')
    removeCommand(id)
  }, [removeCommand])

  // 未连接设备时的提示（这个页面不需要设备，但保留原有逻辑）
  // 注意：根据需求，这是一个本地终端，不需要设备连接

  return (
    <div className="p-6 h-full flex flex-col">
      {/* 标题栏 */}
      <div className="mb-4 flex items-center justify-between flex-shrink-0">
        <h1 className="text-2xl font-bold flex items-center gap-3">
          <TerminalIcon className="h-6 w-6 text-primary" />
          终端命令
          <WindowToggleButton />
            <HelpToggleButton />
        </h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-2" onClick={restartShell}>
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
              {/* 内置命令 */}
              {builtInCommands.length > 0 && (
                <>
                  <DropdownMenuLabel className="text-xs text-muted-foreground">内置命令</DropdownMenuLabel>
                  {builtInCommands.map((cmd) => (
                    <DropdownMenuItem
                      key={cmd.id}
                      className="flex flex-col items-start gap-1 py-2 cursor-pointer"
                      onClick={() => executeCommand(cmd.command)}
                    >
                      <div className="font-medium w-full">{cmd.name}</div>
                      <div className="text-xs text-muted-foreground font-mono break-all">{cmd.command}</div>
                    </DropdownMenuItem>
                  ))}
                </>
              )}

              {/* 自定义命令 */}
              {customCommands.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs text-muted-foreground">自定义命令</DropdownMenuLabel>
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
                      <div className="text-xs text-muted-foreground font-mono break-all">{cmd.command}</div>
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

      {/* 终端区域 */}
      <Card className="flex-1 min-h-0 overflow-hidden flex flex-col">
        <div
          ref={terminalRef}
          className="flex-1 w-full h-full p-2"
          style={{ minHeight: 0, minWidth: 0 }}
        />
      </Card>

      {/* 添加快捷命令对话框 */}
      <AddCommandDialog
        open={isAddDialogOpen}
        onOpenChange={setIsAddDialogOpen}
        onAdd={handleAddCommand}
      />
    </div>
  )
}
