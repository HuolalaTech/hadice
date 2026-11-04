import { create } from 'zustand'
import { toast } from 'sonner'

const FAVORITES_KEY = 'track-log-favorites'
const FILTER_KEY = 'track-log-favorites-filter'
const MAX_FAVORITES = 500

function loadFavorites(): string[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const out: string[] = []
    const seen = new Set<string>()
    for (const item of parsed) {
      if (typeof item !== 'string') continue
      const key = item.trim()
      if (!key || seen.has(key)) continue
      seen.add(key)
      out.push(key)
    }
    return out
  } catch {
    return []
  }
}

function loadFilterOn(): boolean {
  try {
    return localStorage.getItem(FILTER_KEY) === '1'
  } catch {
    return false
  }
}

function persistFavorites(favorites: string[]): void {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites))
  } catch {
    /* ignore */
  }
}

function persistFilter(on: boolean): void {
  try {
    localStorage.setItem(FILTER_KEY, on ? '1' : '0')
  } catch {
    /* ignore */
  }
}

/** 收藏键：埋点 event 名（同名事件共用一颗星） */
export function trackFavoriteKey(eventName: string | null | undefined): string {
  return String(eventName || '').trim()
}

interface TrackLogFavoriteState {
  favorites: string[]
  favoritesFilterOn: boolean
  isFavorite: (eventName: string | null | undefined) => boolean
  toggleFavorite: (eventName: string | null | undefined) => void
  setFavoritesFilterOn: (on: boolean) => void
}

export const useTrackLogFavoriteStore = create<TrackLogFavoriteState>((set, get) => ({
  favorites: typeof localStorage === 'undefined' ? [] : loadFavorites(),
  favoritesFilterOn: typeof localStorage === 'undefined' ? false : loadFilterOn(),

  isFavorite: (eventName) => {
    const key = trackFavoriteKey(eventName)
    if (!key) return false
    return get().favorites.includes(key)
  },

  toggleFavorite: (eventName) => {
    const key = trackFavoriteKey(eventName)
    if (!key) {
      toast.error('无法收藏该埋点')
      return
    }
    const current = get().favorites
    const idx = current.indexOf(key)
    if (idx >= 0) {
      const next = current.filter((_, i) => i !== idx)
      set({ favorites: next })
      persistFavorites(next)
      toast.message('已取消收藏')
      return
    }
    let next = [...current, key]
    if (next.length > MAX_FAVORITES) {
      next = next.slice(next.length - MAX_FAVORITES)
      toast.message('已达收藏上限，已移除最早条目')
    }
    set({ favorites: next })
    persistFavorites(next)
    toast.success(`已收藏：${key}`)
  },

  setFavoritesFilterOn: (on) => {
    set({ favoritesFilterOn: on })
    persistFilter(on)
  },
}))
