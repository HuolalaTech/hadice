import assert from 'node:assert/strict'
import { shouldStopLogStreamOnUnmount } from './log-stream-ownership'

// 主窗普通离开系统日志页：应停流
assert.equal(
  shouldStopLogStreamOnUnmount({ standalone: false, panelOpenForLogs: false }),
  true
)

// 主窗因打开独立窗而卸载：不得停流（否则异步 stop 会杀独立窗新流）
assert.equal(
  shouldStopLogStreamOnUnmount({ standalone: false, panelOpenForLogs: true }),
  false
)

// 独立窗关闭卸载：不得停流（主窗会重新挂载并 start）
assert.equal(
  shouldStopLogStreamOnUnmount({ standalone: true, panelOpenForLogs: false }),
  false
)
assert.equal(
  shouldStopLogStreamOnUnmount({ standalone: true, panelOpenForLogs: true }),
  false
)

console.log('log-stream-ownership.selfcheck: ok')
