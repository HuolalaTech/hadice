const mem = new Map<string, string>()
;(globalThis as any).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => {
    mem.set(k, v)
  },
  removeItem: (k: string) => {
    mem.delete(k)
  },
}

import assert from 'node:assert/strict'
import { useNetworkFavoriteStore } from './networkFavoriteStore'

const store = useNetworkFavoriteStore.getState()
// 隔离：自检前清空
useNetworkFavoriteStore.setState({ favorites: [], favoritesFilterOn: false })

const url = 'https://a.com/api'
assert.equal(store.isFavorite(url), false)
store.toggleFavorite(url)
assert.equal(useNetworkFavoriteStore.getState().isFavorite(url), true)
assert.deepEqual(useNetworkFavoriteStore.getState().favorites, [url])
store.toggleFavorite(url)
assert.equal(useNetworkFavoriteStore.getState().isFavorite(url), false)

// FIFO：塞满后加新项应丢掉最旧
useNetworkFavoriteStore.setState({
  favorites: Array.from({ length: 500 }, (_, i) => `https://a.com/${i}`),
})
useNetworkFavoriteStore.getState().toggleFavorite('https://a.com/new')
const list = useNetworkFavoriteStore.getState().favorites
assert.equal(list.length, 500)
assert.equal(list[0], 'https://a.com/1')
assert.equal(list[list.length - 1], 'https://a.com/new')

useNetworkFavoriteStore.getState().setFavoritesFilterOn(true)
assert.equal(useNetworkFavoriteStore.getState().favoritesFilterOn, true)

console.log('networkFavoriteStore.selfcheck: ok')
