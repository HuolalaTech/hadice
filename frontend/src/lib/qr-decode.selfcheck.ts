import assert from 'node:assert/strict'
import { extractHttpUrl } from './qr-decode'

assert.equal(extractHttpUrl('https://cdn.example/app.apk'), 'https://cdn.example/app.apk')
assert.equal(
  extractHttpUrl('https://cdn.example/app.apk?Expires=1&Signature=ab'),
  'https://cdn.example/app.apk?Expires=1&Signature=ab'
)
assert.equal(
  extractHttpUrl('下载地址：\nhttps://cdn.example/app.hap?Expires=1'),
  'https://cdn.example/app.hap?Expires=1'
)
assert.equal(extractHttpUrl('见 https://a.com/x.apk。'), 'https://a.com/x.apk')
assert.equal(extractHttpUrl('not a url'), null)
assert.equal(extractHttpUrl('ftp://old.host/a.apk'), null)
assert.equal(extractHttpUrl(''), null)

console.log('qr-decode.selfcheck: ok')
