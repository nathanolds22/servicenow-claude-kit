#!/usr/bin/env node
// scripts/lint-sanitize.js
//
// Sanitization gate for this public kit. Fails (exit 1) if any tracked or
// untracked-unignored text file contains a banned string: source-project
// domain terms, instance hostnames, canonical sys_ids, person names, or
// personal absolute paths. Run via `npm run lint:sanitize`; enforced in CI
// and by the Stop-hook quality gate.
//
// This file is self-excluded (it must name the banned patterns). Hiding a
// banned string here would survive the gate — PR review covers that.

'use strict'

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const REPO_ROOT = path.resolve(__dirname, '..')
const SELF = path.relative(REPO_ROOT, __filename)

const BANNED = [
    // Negative lookbehind keeps innocent substrings (upgrade, ripgrep) clean
    // while catching the token itself, x_-prefixed scopes, and camelCase uses.
    { re: /(?<![a-z0-9])pgr/i, why: 'source-project domain prefix' },
    { re: /\bfca\b/i, why: 'source-project regulatory domain' },
    { re: /tstsandbox/i, why: 'source-project instance hostname' },
    // Any concrete instance hostname (a leading host label is required, so the
    // template placeholder `<instance>.service-now.com` survives — `>` breaks
    // the label match). Consumer projects that commit instance-bearing files
    // (e.g. their capability report) should drop or scope this entry.
    { re: /[a-z0-9][a-z0-9-]*\.service-now\.com/i, why: 'instance hostname' },
    { re: /adam\s*hoffman/i, why: 'person name' },
    { re: /\b(ageas|aviva|allianz)\b/i, why: 'source-project insurer name' },
    { re: /\/Users\/[A-Za-z]/, why: 'personal absolute path (use ~ or relative paths)' },
    // Canonical sys_ids from the source project — meaningless elsewhere, banned anyway.
    {
        re: /(3e6b7946292d40ceb0271fef13dcbf07|48e88ee804434c7293f2ef983d8c8268|7558a3299e094569a2804f667ac0d4ed|d5702c96bc6b4a0ea71cfbba0ea70d41|bc63072681844c8b99eef8cf98994ec6)/i,
        why: 'source-project sys_id',
    },
]

const SKIP_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.pdf', '.ico', '.woff', '.woff2', '.zip'])

function trackedFiles() {
    const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
    })
    return out.split('\n').filter(Boolean)
}

let failures = 0
for (const rel of trackedFiles()) {
    if (rel === SELF) continue
    if (SKIP_EXT.has(path.extname(rel).toLowerCase())) continue
    const abs = path.join(REPO_ROOT, rel)
    let text
    try {
        text = fs.readFileSync(abs, 'utf8')
    } catch {
        continue
    }
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
        for (const { re, why } of BANNED) {
            if (re.test(lines[i])) {
                console.error(`SANITIZE ${rel}:${i + 1}  [${why}]  ${lines[i].trim().slice(0, 120)}`)
                failures++
            }
        }
    }
}

if (failures) {
    console.error(`\nlint:sanitize FAILED — ${failures} banned-string occurrence(s). This kit must stay app-agnostic and client-clean.`)
    process.exit(1)
}
console.log('lint:sanitize OK — no banned strings.')
