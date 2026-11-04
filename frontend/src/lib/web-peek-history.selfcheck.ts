import assert from 'node:assert/strict'
import { pushWebPeekHistory, WEB_PEEK_HISTORY_MAX } from './web-peek-history'

assert.deepEqual(pushWebPeekHistory([], 'https://a.com'), ['https://a.com'])
assert.deepEqual(pushWebPeekHistory(['https://a.com'], 'https://b.com'), [
  'https://b.com',
  'https://a.com'
])
assert.deepEqual(pushWebPeekHistory(['https://a.com', 'https://b.com'], 'https://a.com'), [
  'https://a.com',
  'https://b.com'
])

const many = Array.from({ length: WEB_PEEK_HISTORY_MAX + 5 }, (_, i) => `https://x.com/${i}`)
const capped = pushWebPeekHistory(many.slice(1), many[0])
assert.equal(capped.length, WEB_PEEK_HISTORY_MAX)
assert.equal(capped[0], many[0])

console.log('web-peek-history.selfcheck: ok')
