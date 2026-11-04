import assert from 'node:assert/strict'
import {
  buildPanelWindowPath,
  LAST_DEVICE_CONNECT_KEY,
  LAST_DEVICE_SNAPSHOT_KEY,
  loadLastDeviceConnectKey,
  loadLastDeviceSnapshot,
  readPreferredDeviceKeyFromSearch,
  resolveSelectedDevice,
  saveLastDeviceConnectKey,
  saveLastDeviceSnapshot,
} from './device-selection'

type D = { connectKey: string; status: string; platform: string }

const android: D = { connectKey: 'vangogh', status: 'Connected', platform: 'android' }
const harmony: D = {
  connectKey: 'mate60',
  status: 'Connected',
  platform: 'harmonyos',
}
const offline: D = { connectKey: 'dead', status: 'Offline', platform: 'android' }

// 无偏好：取列表中第一台已连接（复现独立窗误选安卓）
assert.equal(resolveSelectedDevice([android, harmony], null)?.connectKey, 'vangogh')

// 有偏好：即使安卓排在前面，也选鸿蒙（修复目标）
assert.equal(
  resolveSelectedDevice([android, harmony], 'mate60')?.connectKey,
  'mate60'
)

// 独立窗严格模式：偏好未命中时绝不回退到第一台安卓
assert.equal(
  resolveSelectedDevice([android, harmony], 'missing', { fallbackToFirst: false }),
  null
)

// 偏好设备离线：回退第一台已连接
assert.equal(
  resolveSelectedDevice([offline, android, harmony], 'dead')?.connectKey,
  'vangogh'
)

// 偏好不在列表：回退
assert.equal(
  resolveSelectedDevice([android, harmony], 'missing')?.connectKey,
  'vangogh'
)

// 用户路径：上次 B 已不在，刷新后只剩 A/C → 自动选第一台
assert.equal(
  resolveSelectedDevice(
    [
      { connectKey: 'A', status: 'Connected', platform: 'android' },
      { connectKey: 'C', status: 'Connected', platform: 'harmonyos' },
    ],
    'B'
  )?.connectKey,
  'A'
)

assert.equal(resolveSelectedDevice([], 'mate60'), null)
assert.equal(resolveSelectedDevice([offline], null), null)

assert.equal(
  readPreferredDeviceKeyFromSearch('?page=app-layout&standalone=1&device=mate60'),
  'mate60'
)
assert.equal(
  readPreferredDeviceKeyFromSearch('?page=app-layout&standalone=1'),
  null
)

assert.equal(
  buildPanelWindowPath('app-layout', 'mate60'),
  '/?page=app-layout&standalone=1&device=mate60'
)
assert.equal(
  buildPanelWindowPath('app-layout', null),
  '/?page=app-layout&standalone=1'
)
assert.equal(
  buildPanelWindowPath('app-layout', ''),
  '/?page=app-layout&standalone=1'
)

// Node 无 DOM localStorage：挂一个最小实现再测读写
const mem = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => {
      mem.set(k, String(v))
    },
    removeItem: (k: string) => {
      mem.delete(k)
    },
  },
})
saveLastDeviceConnectKey('device-abc')
assert.equal(loadLastDeviceConnectKey(), 'device-abc')
assert.equal(mem.get(LAST_DEVICE_CONNECT_KEY), 'device-abc')
saveLastDeviceConnectKey(null)
assert.equal(loadLastDeviceConnectKey(), null)

saveLastDeviceSnapshot({
  connectKey: 'mate60',
  connectionType: 'USB',
  status: 'Connected',
  productName: 'Mate',
  platform: 'harmonyos',
})
assert.equal(loadLastDeviceConnectKey(), 'mate60')
assert.equal(loadLastDeviceSnapshot()?.productName, 'Mate')
assert.ok(mem.get(LAST_DEVICE_SNAPSHOT_KEY))
saveLastDeviceSnapshot(null)
assert.equal(loadLastDeviceSnapshot(), null)

console.log('device-selection.selfcheck: ok')
