import assert from 'node:assert/strict'
import type { NetworkRequest } from '../types/hdc'
import { decodeNetworkUrlForDisplay, stripUrlForFavorite } from './network-url'

function req(partial: Partial<NetworkRequest>): NetworkRequest {
  return {
    id: '1',
    timestamp: 0,
    method: 'GET',
    url: '',
    direction: 'request',
    ...partial,
  }
}

// 无 &：整段保留（仅去 hash）
assert.equal(
  stripUrlForFavorite('https://a.com/p?x=1#h'),
  'https://a.com/p?x=1'
)

// 有多个 query：截到第一个 &
assert.equal(
  stripUrlForFavorite(
    'https://api.example.com/?_m=list_resource&args=%7B%22city_id%22:%221002%22%7D&version=1.0.0&token=abc'
  ),
  'https://api.example.com/?_m=list_resource'
)
assert.equal(
  stripUrlForFavorite(
    'https://api.example.com/user/homepage_info?args=%7B%7D&version=1.0.0&token=abc'
  ),
  'https://api.example.com/user/homepage_info?args={}'
)

// requestParams 合并进 query 后同样按第一个 & 截
assert.equal(
  stripUrlForFavorite(req({
    baseURL: 'https://a.com',
    url: '/api/x',
    requestParams: { a: '1', b: '2' },
  })),
  'https://a.com/api/x?a=1'
)

assert.equal(stripUrlForFavorite(''), '')
assert.equal(stripUrlForFavorite(req({ url: '' })), '')
assert.equal(stripUrlForFavorite('-'), '')

assert.equal(
  decodeNetworkUrlForDisplay('https://a.com/p?args=%7B%22x%22:1%7D'),
  'https://a.com/p?args={"x":1}'
)
assert.equal(decodeNetworkUrlForDisplay('-'), '-')

console.log('network-url.selfcheck: ok')
