import { create } from 'zustand'
import { toast } from 'sonner'
import type { NetworkRequest } from '@/types/hdc'
import { stripUrlForFavorite } from '@/lib/network-url'

const FAVORITES_KEY = 'network-capture-favorites'
const FILTER_KEY = 'network-capture-favorites-filter'
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
  } catch (e) {
    console.warn('[networkFavoriteStore] load favorites failed:', e)
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
  } catch (e) {
    console.warn('[networkFavoriteStore] save favorites failed:', e)
  }
}

function persistFilter(on: boolean): void {
  try {
    localStorage.setItem(FILTER_KEY, on ? '1' : '0')
  } catch (e) {
    console.warn('[networkFavoriteStore] save filter failed:', e)
  }
}

interface NetworkFavoriteState {
  favorites: string[]
  favoritesFilterOn: boolean
  isFavorite: (requestOrUrl: NetworkRequest | string) => boolean
  toggleFavorite: (requestOrUrl: NetworkRequest | string) => void
  setFavoritesFilterOn: (on: boolean) => void
}

export const useNetworkFavoriteStore = create<NetworkFavoriteState>((set, get) => ({
  favorites: typeof localStorage === 'undefined' ? [] : loadFavorites(),
  favoritesFilterOn: typeof localStorage === 'undefined' ? false : loadFilterOn(),

  isFavorite: (requestOrUrl) => {
    const key = stripUrlForFavorite(requestOrUrl)
    if (!key) return false
    return get().favorites.includes(key)
  },

  toggleFavorite: (requestOrUrl) => {
    const key = stripUrlForFavorite(requestOrUrl)
    if (!key) {
      toast.error('无法收藏该链接')
      return
    }
    const current = get().favorites
    const idx = current.indexOf(key)
    if (idx >= 0) {
      const next = current.filter((_, i) => i !== idx)
      set({ favorites: next })
      persistFavorites(next)
      toast.message(`已取消收藏`)
      return
    }
    let next = [...current, key]
    if (next.length > MAX_FAVORITES) {
      next = next.slice(next.length - MAX_FAVORITES)
      toast.message('已达收藏上限，已移除最早条目')
    }
    set({ favorites: next })
    persistFavorites(next)
    // 收藏键是去参 URL：列表里同路径的其它请求会同步亮星（不是一次写入多条）
    toast.success(`已收藏：${key}`)
  },

  setFavoritesFilterOn: (on) => {
    set({ favoritesFilterOn: on })
    persistFilter(on)
  },
}))
