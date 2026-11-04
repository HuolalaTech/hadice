import assert from 'node:assert/strict'
import { entryPassesDisplayFilter } from './log-display-filter'

const base = {
  level: 'I',
  tag: 'Net',
  message: 'hello world',
  raw: 'I Net hello world',
}

assert.equal(
  entryPassesDisplayFilter(base, { levels: ['I'], tagFilter: 'net' }),
  true
)
assert.equal(
  entryPassesDisplayFilter(base, { levels: ['E'] }),
  false
)
assert.equal(
  entryPassesDisplayFilter(base, {
    levels: ['I'],
    keywordFilter: 'bye',
  }),
  false
)
assert.equal(
  entryPassesDisplayFilter(base, {
    levels: ['I'],
    keywordFilter: 'hel.+',
    useRegex: true,
  }),
  true
)
assert.equal(
  entryPassesDisplayFilter(base, {
    levels: ['I'],
    suppressionRules: [{ tag: 'Net', enabled: true }],
  }),
  false
)

console.log('log-display-filter.selfcheck: ok')
