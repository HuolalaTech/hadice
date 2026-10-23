import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { getTerminalTheme } from '@/lib/theme'
import { useThemeStore } from '@/store/themeStore'

/**
 * 使用终端 Hook
 */
export function useTerminal(containerRef: React.RefObject<HTMLDivElement>) {
  const terminalInstanceRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const theme = useThemeStore((s) => s.theme)

  // 初始化终端
  useEffect(() => {
    if (!containerRef.current) return

    const terminal = new Terminal({
      theme: getTerminalTheme(theme),
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
    })

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(containerRef.current)

    const fitTerminal = () => {
      try {
        fitAddon.fit()
      } catch (error) {
        console.warn('[useTerminal] Failed to fit terminal:', error)
      }
    }

    setTimeout(fitTerminal, 100)

    terminalInstanceRef.current = terminal
    fitAddonRef.current = fitAddon

    const handleResize = () => {
      fitTerminal()
    }
    window.addEventListener('resize', handleResize)

    const resizeObserver = new ResizeObserver(() => {
      fitTerminal()
    })
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current)
    }

    return () => {
      window.removeEventListener('resize', handleResize)
      resizeObserver.disconnect()
      terminal.dispose()
      terminalInstanceRef.current = null
      fitAddonRef.current = null
    }
    // theme 变化时重建代价大；下面单独 setOption 更新主题
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef])

  useEffect(() => {
    terminalInstanceRef.current?.options &&
      (terminalInstanceRef.current.options.theme = getTerminalTheme(theme))
  }, [theme])

  return {
    terminal: terminalInstanceRef.current,
    fitAddon: fitAddonRef.current
  }
}
