import assert from 'node:assert/strict'
import {
  hydrateAndroidCaptureApp,
  hydrateHarmonyCaptureApp,
  reconcileAndroidCaptureApp,
  toSavedCaptureApp,
} from './capture-selected-app'

assert.deepEqual(
  toSavedCaptureApp({
    bundleName: 'com.a',
    processName: 'com.a:push',
    appName: 'A',
  }),
  { packageName: 'com.a', processName: 'com.a:push', appName: 'A' }
)

assert.equal(hydrateHarmonyCaptureApp(null, []), null)

const saved = {
  packageName: 'com.a',
  processName: 'com.a:push',
  appName: 'A',
}
assert.equal(hydrateHarmonyCaptureApp(saved, [])?.pid, 0)
assert.equal(
  hydrateHarmonyCaptureApp(saved, [
    {
      bundleName: 'com.a',
      appName: 'AppA',
      processName: 'com.a:push',
      pid: 9,
    },
  ])?.pid,
  9
)
assert.equal(
  hydrateHarmonyCaptureApp(saved, [
    { bundleName: 'other', appName: 'O', processName: 'other', pid: 1 },
  ]),
  null
)

// 同包名多进程：必须命中 processName，不能抢到列表第一项 :remote
const catalog = [
  {
    packageName: 'com.example.app',
    processName: 'com.example.app:remote',
    name: 'remote',
    pid: 1,
    debuggable: true,
  },
  {
    packageName: 'com.example.app',
    processName: 'com.example.app',
    name: 'main',
    pid: 2,
    debuggable: true,
  },
]
const mainSaved = {
  packageName: 'com.example.app',
  processName: 'com.example.app',
  appName: 'main',
}
assert.equal(
  hydrateAndroidCaptureApp(mainSaved, catalog)?.processName,
  'com.example.app'
)
assert.equal(
  reconcileAndroidCaptureApp(
    {
      packageName: 'com.example.app',
      processName: 'com.example.app',
      name: 'main',
      pid: 0,
      debuggable: true,
    },
    catalog
  )?.pid,
  2
)

assert.equal(
  reconcileAndroidCaptureApp(
    {
      packageName: 'gone',
      processName: 'gone',
      name: 'G',
      pid: 1,
      debuggable: true,
    },
    catalog
  ),
  null
)

console.log('capture-selected-app.selfcheck: ok')
