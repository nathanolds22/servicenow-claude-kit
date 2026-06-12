'use strict'
// scripts/lib/capability-report.js
//
// Reader/writer for `.team/instance-capabilities.json` — the single source of
// truth for "what works on the connected ServiceNow instance". Consumed by:
//   - scripts/probe-instance-capabilities.js (writer)
//   - .claude/settings.json hooks (SessionStart summary, PreToolUse warn)
//   - .claude/commands/{capability_probe,verify,bootstrap}.md
//   - any project script that branches on instance behaviour
//
// Capabilities live as `{ "<group>.<name>": { status, expected, observed,
// probed_at, probe_method, evidence } }`. status is one of:
//   true    - probe ran, observed matches expected
//   false   - probe ran, observed does NOT match expected
//   n/a     - probe ran but the subject no longer exists. Neither a pass nor
//             a regression.
//   unknown - never probed OR report stale beyond MAX_AGE_MS
//   error   - probe attempted but errored before producing a result
//
// `getCapability(name)` returns 'unknown' for missing OR stale entries so
// downstream branching can default to the safe previous-behaviour path when
// the report is out of date. THE SAFE DEFAULT FOR ANY UNKNOWN IS THE
// PREVIOUS-BEHAVIOUR PATH — new behaviour requires positive evidence.

const fs = require('node:fs')
const path = require('node:path')

const REPORT_PATH = path.join(__dirname, '..', '..', '.team', 'instance-capabilities.json')
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7d

function loadReport() {
    try {
        return JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'))
    } catch (e) {
        if (e.code === 'ENOENT') {
            return { schema_version: 1, generated_at: null, instance_url: null, capabilities: {} }
        }
        throw e
    }
}

function writeReport(report) {
    report.generated_at = new Date().toISOString()
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true })
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n')
    return REPORT_PATH
}

function isStale(report, maxAgeMs = MAX_AGE_MS) {
    if (!report || !report.generated_at) return true
    const age = Date.now() - Date.parse(report.generated_at)
    return age > maxAgeMs
}

function getCapability(name, { report = null, maxAgeMs = MAX_AGE_MS } = {}) {
    const r = report || loadReport()
    if (isStale(r, maxAgeMs)) return 'unknown'
    const entry = r.capabilities?.[name]
    if (!entry) return 'unknown'
    if (entry.status === true || entry.status === 'true') return true
    if (entry.status === false || entry.status === 'false') return false
    if (entry.status === 'n/a') return 'n/a'
    return entry.status === 'error' ? 'error' : 'unknown'
}

function setCapability(report, name, entry) {
    if (!report.capabilities) report.capabilities = {}
    report.capabilities[name] = {
        status: entry.status,
        expected: entry.expected ?? null,
        observed: entry.observed ?? null,
        probed_at: entry.probed_at ?? new Date().toISOString(),
        probe_method: entry.probe_method ?? 'unknown',
        evidence: entry.evidence ?? null,
    }
}

function summariseReport(report) {
    const lines = []
    if (!report || !report.capabilities) return '(no capability report yet)'
    const keys = Object.keys(report.capabilities).sort()
    if (keys.length === 0) return '(no probes recorded)'
    const stale = isStale(report)
    lines.push(
        `instance: ${report.instance_url || 'unknown'}  generated: ${report.generated_at || 'never'}` +
            (stale ? '  [STALE]' : '')
    )
    for (const k of keys) {
        const e = report.capabilities[k]
        const ico =
            e.status === true
                ? 'OK '
                : e.status === false
                  ? 'NO '
                  : e.status === 'n/a'
                    ? 'N/A'
                    : e.status === 'error'
                      ? 'ERR'
                      : '?? '
        lines.push(`  ${ico} ${k}`)
    }
    return lines.join('\n')
}

module.exports = {
    REPORT_PATH,
    MAX_AGE_MS,
    loadReport,
    writeReport,
    isStale,
    getCapability,
    setCapability,
    summariseReport,
}
