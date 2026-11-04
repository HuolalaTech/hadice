import assert from 'node:assert/strict'
import { normalizeWebPeekUrl } from './web-peek-url'

assert.equal(normalizeWebPeekUrl(''), '')
assert.equal(normalizeWebPeekUrl('javascript:alert(1)'), '')
assert.equal(normalizeWebPeekUrl('file:///tmp/x'), '')
assert.ok(normalizeWebPeekUrl('www.163.com').startsWith('https://www.163.com'))
assert.ok(normalizeWebPeekUrl('www.baidu.com').startsWith('https://www.baidu.com'))
assert.ok(normalizeWebPeekUrl('http://localhost:8888/?hd=1').startsWith('http://localhost:8888/'))

console.log('web-peek-url.selfcheck: ok')
