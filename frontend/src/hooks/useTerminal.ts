import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'

/**
 * 终端配置
 */
const TERMINAL_CONFIG = {
  theme: {
    background: '#0a0a0b',
    foreground: '#fafafa',
    cursor: '#fafafa',
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
  fontFamily:
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  fontSize: 11,
  lineHeight: 1.0,
  cursorBlink: false,
  cursorStyle: 'block' as const,
  scrollback: 300,
  rows: 30,
  cols: 80,
  disableStdin: true,
  allowProposedApi: true
}

/**
 * 使用终端 Hook
 */
export function useTerminal(containerRef: React.RefObject<HTMLDivElement>) {
  const terminalInstanceRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)

  // 初始化终端
  useEffect(() => {
    if (!containerRef.current) return

    // 创建终端实例
    const terminal = new Terminal(TERMINAL_CONFIG)

    // 创建 fit addon
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)

    // 打开终端
    terminal.open(containerRef.current)

    // 延迟适配大小，确保容器已渲染
    const fitTerminal = () => {
      try {
        fitAddon.fit()
      } catch (error) {
        console.warn('[useTerminal] Failed to fit terminal:', error)
      }
    }

    // 立即适配
    setTimeout(fitTerminal, 100)

    // 保存引用
    terminalInstanceRef.current = terminal
    fitAddonRef.current = fitAddon

    // 窗口大小改变时重新适配
    const handleResize = () => {
      fitTerminal()
    }
    window.addEventListener('resize', handleResize)

    // 使用 ResizeObserver 监听容器大小变化
    const resizeObserver = new ResizeObserver(() => {
      fitTerminal()
    })
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current)
    }

    // 清理函数
    return () => {
      window.removeEventListener('resize', handleResize)
      resizeObserver.disconnect()
      terminal.dispose()
      terminalInstanceRef.current = null
      fitAddonRef.current = null
    }
  }, [containerRef])

  return {
    terminal: terminalInstanceRef.current,
    fitAddon: fitAddonRef.current
  }
}

