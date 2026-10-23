import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  applyDocumentTheme,
  THEME_STORAGE_KEY,
  type AppTheme
} from '@/lib/theme'

interface ThemeState {
  theme: AppTheme
  setTheme: (theme: AppTheme) => void
  toggleTheme: () => void
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      setTheme: (theme) => {
        applyDocumentTheme(theme)
        set({ theme })
      },
      toggleTheme: () => {
        const next: AppTheme = get().theme === 'dark' ? 'light' : 'dark'
        get().setTheme(next)
      }
    }),
    {
      name: THEME_STORAGE_KEY,
      onRehydrateStorage: () => (state) => {
        if (state?.theme) applyDocumentTheme(state.theme)
      }
    }
  )
)

// 独立窗口 / 多窗口：localStorage 变更时同步主题
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== THEME_STORAGE_KEY || !event.newValue) return
    try {
      const parsed = JSON.parse(event.newValue) as { state?: { theme?: string } }
      const theme = parsed?.state?.theme
      if (theme !== 'dark' && theme !== 'light') return
      if (useThemeStore.getState().theme === theme) return
      applyDocumentTheme(theme)
      useThemeStore.setState({ theme })
    } catch {
      // ignore malformed storage
    }
  })
}
