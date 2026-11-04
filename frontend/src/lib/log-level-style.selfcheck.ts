import assert from 'node:assert/strict'
import {
  entryPassesLevelFilter,
  formatLogLineForTerminal,
  minLevelForBackend,
  normalizeLogLevel,
  stripAnsi,
} from './log-level-style'

assert.equal(stripAnsi('\x1b[33mW\x1b[0m'), 'W')
assert.equal(normalizeLogLevel('\x1b[33mW\x1b[0m'), 'W')
assert.equal(normalizeLogLevel('w'), 'W')
assert.equal(normalizeLogLevel('WARN'), 'W')

const harmonyRaw = formatLogLineForTerminal({
  level: 'W',
  time: '10:00:00',
  tag: 'Tag',
  message: 'hello',
  raw: '\x1b[33m10:00:00 W Tag: hello\x1b[0m', // 设备自带色应被忽略
})
const androidPlain = formatLogLineForTerminal({
  level: 'W',
  time: '10:00:00',
  tag: 'Tag',
  message: 'hello',
  raw: '10:00:00 W Tag: hello',
})

assert.equal(
  harmonyRaw,
  androidPlain,
  '同级安卓/鸿蒙终端着色必须一致'
)
assert.ok(harmonyRaw.includes('\x1b[33m'), 'W 应用统一黄色 ANSI')
assert.ok(!harmonyRaw.includes('\x1b[33m10:00'), '不得透传 raw 里整行设备色')

assert.equal(entryPassesLevelFilter({ level: 'W' }, []), true)
assert.equal(entryPassesLevelFilter({ level: 'W' }, ['I', 'W']), true)
assert.equal(entryPassesLevelFilter({ level: 'E' }, ['I', 'W']), false)
assert.equal(
  entryPassesLevelFilter({ level: '\x1b[33mW\x1b[0m' }, ['W']),
  true
)

assert.equal(minLevelForBackend(['I', 'W']), 'I')
assert.equal(minLevelForBackend(['W', 'E']), 'W')
assert.equal(minLevelForBackend([]), null)

console.log('log-level-style.selfcheck: ok')
