'use strict'
// Invariant tests for scripts/lib/capability-report.js — the safe-default
// contract every consumer depends on.

const test = require('node:test')
const assert = require('node:assert')

const { getCapability, isStale, setCapability, summariseReport } = require('../lib/capability-report')

function freshReport(capabilities = {}) {
    return {
        schema_version: 1,
        generated_at: new Date().toISOString(),
        instance_url: 'https://example.service-now.com',
        capabilities,
    }
}

test('getCapability returns unknown for a missing entry', () => {
    assert.strictEqual(getCapability('nope.never_probed', { report: freshReport() }), 'unknown')
})

test('getCapability returns unknown when the report is stale', () => {
    const r = freshReport({ 'a.b': { status: true } })
    r.generated_at = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
    assert.strictEqual(getCapability('a.b', { report: r }), 'unknown')
})

test('getCapability coerces string statuses', () => {
    const r = freshReport({
        't.s': { status: 'true' },
        'f.s': { status: 'false' },
        'na.s': { status: 'n/a' },
        'e.s': { status: 'error' },
    })
    assert.strictEqual(getCapability('t.s', { report: r }), true)
    assert.strictEqual(getCapability('f.s', { report: r }), false)
    assert.strictEqual(getCapability('na.s', { report: r }), 'n/a')
    assert.strictEqual(getCapability('e.s', { report: r }), 'error')
})

test('isStale: null/missing generated_at is stale', () => {
    assert.strictEqual(isStale({ generated_at: null }), true)
    assert.strictEqual(isStale(null), true)
    assert.strictEqual(isStale(freshReport()), false)
})

test('setCapability normalizes the entry shape', () => {
    const r = freshReport()
    setCapability(r, 'g.n', { status: true, observed: '2xx' })
    const e = r.capabilities['g.n']
    assert.strictEqual(e.status, true)
    assert.strictEqual(e.observed, '2xx')
    assert.ok(e.probed_at)
    assert.strictEqual(e.expected, null)
    assert.strictEqual(e.evidence, null)
})

test('summariseReport renders one line per capability with status icons', () => {
    const r = freshReport({ 'ok.x': { status: true }, 'no.x': { status: false }, 'unk.x': { status: 'unknown' } })
    const s = summariseReport(r)
    assert.match(s, /OK {2}ok\.x/)
    assert.match(s, /NO {2}no\.x/)
    assert.match(s, /\?\? {2}unk\.x/)
})
