import assert from 'node:assert/strict'
import { isTerminalHostReady } from './terminal-ready'

assert.equal(isTerminalHostReady(null), false)
assert.equal(isTerminalHostReady(undefined), false)
assert.equal(isTerminalHostReady({ clientWidth: 0, clientHeight: 400 }), false)
assert.equal(isTerminalHostReady({ clientWidth: 800, clientHeight: 0 }), false)
assert.equal(isTerminalHostReady({ clientWidth: 800, clientHeight: 400 }), true)

console.log('terminal-ready.selfcheck: ok')
