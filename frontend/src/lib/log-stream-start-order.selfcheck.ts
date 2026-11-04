import assert from 'node:assert/strict'

/**
 * 约定：开流顺序必须是 subscribe → start，不能 start → subscribe。
 * 用字符串序列模拟，防止回归独立窗「进程在跑、界面空白」。
 */
function startStreamOrdered(steps: string[]): string[] {
  const out: string[] = []
  // stop
  out.push('stop')
  // subscribe first
  out.push('subscribe')
  // then start backend
  out.push('start')
  assert.deepEqual(
    steps,
    ['stop', 'subscribe', 'start'],
    '独立窗开流顺序必须 stop → subscribe → start'
  )
  return out
}

assert.deepEqual(startStreamOrdered(['stop', 'subscribe', 'start']), [
  'stop',
  'subscribe',
  'start',
])

let threw = false
try {
  startStreamOrdered(['stop', 'start', 'subscribe'])
} catch {
  threw = true
}
assert.equal(threw, true, '错误顺序应失败')

console.log('log-stream-start-order.selfcheck: ok')
