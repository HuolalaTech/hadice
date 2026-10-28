/**
 * 应用主题工具：文档 class、xterm / 图表配色
 */
import type { CSSProperties } from 'react'

export type AppTheme = 'dark' | 'light'

/** zustand persist 的 storage key（与 themeStore 一致） */
export const THEME_STORAGE_KEY = 'hadice-theme'

export interface TerminalThemeColors {
  background: string
  foreground: string
  cursor: string
  cursorAccent?: string
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
}

export interface ChartChrome {
  grid: string
  axis: string
  label: string
  memoryStroke: string
  tooltipStyle: CSSProperties
}

const DARK_TERMINAL: TerminalThemeColors = {
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
}

const LIGHT_TERMINAL: TerminalThemeColors = {
  background: '#fafafa',
  foreground: '#171717',
  cursor: '#171717',
  cursorAccent: '#fafafa',
  black: '#000000',
  red: '#dc2626',
  green: '#16a34a',
  yellow: '#ca8a04',
  blue: '#2563eb',
  magenta: '#9333ea',
  cyan: '#0891b2',
  white: '#fafafa',
  brightBlack: '#737373',
  brightRed: '#ef4444',
  brightGreen: '#22c55e',
  brightYellow: '#eab308',
  brightBlue: '#3b82f6',
  brightMagenta: '#a855f7',
  brightCyan: '#06b6d4',
  brightWhite: '#ffffff'
}

export function readStoredTheme(): AppTheme {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY)
    if (!raw) return 'dark'
    const parsed = JSON.parse(raw) as { state?: { theme?: string } } | AppTheme
    const theme = typeof parsed === 'string' ? parsed : parsed?.state?.theme
    return theme === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

export function applyDocumentTheme(theme: AppTheme): void {
  const root = document.documentElement
  const body = document.body
  root.classList.toggle('dark', theme === 'dark')
  root.classList.toggle('light', theme === 'light')
  if (body) {
    body.classList.toggle('dark', theme === 'dark')
    body.classList.toggle('light', theme === 'light')
  }

  // Wails 窗口标题栏 / 系统控件（不可用则忽略）
  void import('../../wailsjs/runtime/runtime')
    .then((runtime) => {
      if (theme === 'dark') runtime.WindowSetDarkTheme()
      else runtime.WindowSetLightTheme()
    })
    .catch(() => {
      // ignore: browser / unbound runtime
    })
}

/** 在 React 渲染前调用，避免首屏闪错主题 */
export function initTheme(): void {
  applyDocumentTheme(readStoredTheme())
}

export function getTerminalTheme(theme: AppTheme): TerminalThemeColors {
  return theme === 'light' ? LIGHT_TERMINAL : DARK_TERMINAL
}

export function getChartChrome(theme: AppTheme): ChartChrome {
  if (theme === 'light') {
    return {
      grid: '#e5e5e5',
      axis: '#737373',
      label: '#737373',
      memoryStroke: '#171717',
      tooltipStyle: {
        backgroundColor: '#ffffff',
        border: '1px solid #e5e5e5',
        borderRadius: '6px',
        fontSize: '10px',
        lineHeight: '14px',
        padding: '4px 6px',
        color: '#171717'
      }
    }
  }
  return {
    grid: '#333',
    axis: '#666',
    label: '#888',
    memoryStroke: '#ffffff',
    tooltipStyle: {
      backgroundColor: '#1a1a1a',
      border: '1px solid #333',
      borderRadius: '6px',
      fontSize: '10px',
      lineHeight: '14px',
      padding: '4px 6px'
    }
  }
}
