import assert from 'node:assert/strict'
import {
  hydrateLogApps,
  refreshLogAppsPids,
  toSavedLogApps,
} from './log-selected-apps'

assert.deepEqual(
  toSavedLogApps([
    { packageName: 'a.b', appName: 'A', pid: 1 },
    { packageName: 'a.b', appName: 'A2', pid: 2 },
    { packageName: ' ', appName: 'x' },
  ]),
  [{ packageName: 'a.b', appName: 'A' }]
)

// catalog 空：保留（加载中）
assert.deepEqual(
  hydrateLogApps([{ packageName: 'a.b', appName: 'A' }], []),
  [{ packageName: 'a.b', appName: 'A' }]
)

// catalog 非空：在列表的回填 pid；不在的（已卸载）丢掉
assert.deepEqual(
  hydrateLogApps(
    [
      { packageName: 'a.b', appName: 'A' },
      { packageName: 'gone', appName: 'G' },
    ],
    [{ packageName: 'a.b', appName: 'AppA', pid: 42 }]
  ),
  [{ packageName: 'a.b', appName: 'AppA', pid: 42 }]
)

const selected = [
  { packageName: 'a.b', appName: 'A', pid: undefined as number | undefined },
  { packageName: 'uninstalled', appName: 'U', pid: 1 },
]
const refreshed = refreshLogAppsPids(selected, [
  { packageName: 'a.b', appName: 'A', pid: 9 },
])
assert.deepEqual(refreshed, [{ packageName: 'a.b', appName: 'A', pid: 9 }])

// catalog 空不误删
assert.equal(refreshLogAppsPids(selected, []), selected)

console.log('log-selected-apps.selfcheck: ok')
