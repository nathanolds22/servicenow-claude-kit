#!/usr/bin/env node
// install.js — overlay this kit into an EXISTING repo.
//
//   node install.js --into /path/to/existing-repo [--force] [--dry-run]
//
// For a NEW project, don't use this: clone the kit (or use GitHub's
// "Use this template") and start there.
//
// Behaviour (idempotent):
//   - copies kit files into the target, creating directories as needed
//   - NEVER overwrites a file that exists and differs, unless --force
//     (existing-identical files are skipped silently)
//   - CLAUDE.md is copied only if the target has none (never clobbered,
//     even with --force — merge it by hand)
//   - package.json: merges missing script entries into the target's
//     scripts block (creates package.json if absent)
//   - .gitignore: appends any kit lines the target is missing

'use strict'

const fs = require('node:fs')
const path = require('node:path')

const KIT_ROOT = __dirname
const argv = process.argv.slice(2)
const intoIdx = argv.indexOf('--into')
const TARGET = intoIdx !== -1 ? path.resolve(argv[intoIdx + 1] || '') : null
const FORCE = argv.includes('--force')
const DRY = argv.includes('--dry-run')

if (!TARGET || !fs.existsSync(TARGET)) {
    console.error('Usage: node install.js --into /path/to/existing-repo [--force] [--dry-run]')
    process.exit(1)
}

// Files and directories the overlay owns. CLAUDE.md and package.json are
// handled specially below.
const COPY_PATHS = [
    '.claude/settings.json',
    '.claude/commands',
    '.claude/agents',
    '.claude/rules',
    '.claude/skills',
    '.team/LESSONS.md',
    '.team/SHIP_HISTORY.md',
    '.team/agent-findings/README.md',
    '.team/agent-findings/ledger.jsonl',
    '.team/instance-capabilities.json',
    '.team/plans/.gitkeep',
    'scripts/lib/sn-creds.js',
    'scripts/lib/sn-rest.js',
    'scripts/lib/capability-report.js',
    'scripts/probe-instance-capabilities.js',
    'scripts/fetch-servicenow-docs.js',
    'scripts/lint-sanitize.js',
    'scripts/quality-gate.sh',
    'scripts/__tests__/capability-report.test.js',
    '.env.example',
]

const stats = { copied: 0, skippedSame: 0, skippedDiffers: 0, merged: 0 }

function walk(rel) {
    const abs = path.join(KIT_ROOT, rel)
    if (fs.statSync(abs).isDirectory()) {
        return fs.readdirSync(abs).flatMap((f) => walk(path.join(rel, f)))
    }
    return [rel]
}

function copyOne(rel) {
    const src = path.join(KIT_ROOT, rel)
    const dst = path.join(TARGET, rel)
    const srcBody = fs.readFileSync(src)
    if (fs.existsSync(dst)) {
        if (fs.readFileSync(dst).equals(srcBody)) {
            stats.skippedSame++
            return
        }
        if (!FORCE) {
            console.log(`  differs, skipped (use --force): ${rel}`)
            stats.skippedDiffers++
            return
        }
    }
    console.log(`  copy: ${rel}`)
    if (!DRY) {
        fs.mkdirSync(path.dirname(dst), { recursive: true })
        fs.writeFileSync(dst, srcBody)
        if (rel.endsWith('.sh') || rel.startsWith('scripts/')) {
            try {
                fs.chmodSync(dst, fs.statSync(src).mode)
            } catch {}
        }
    }
    stats.copied++
}

function mergePackageJson() {
    const kitPkg = JSON.parse(fs.readFileSync(path.join(KIT_ROOT, 'package.json'), 'utf8'))
    const dst = path.join(TARGET, 'package.json')
    let pkg
    if (fs.existsSync(dst)) {
        pkg = JSON.parse(fs.readFileSync(dst, 'utf8'))
    } else {
        pkg = { name: path.basename(TARGET), version: '0.0.0', private: true, scripts: {} }
    }
    pkg.scripts = pkg.scripts || {}
    let added = 0
    for (const [k, v] of Object.entries(kitPkg.scripts)) {
        if (k === 'postinstall' && pkg.scripts.postinstall) continue
        if (!pkg.scripts[k]) {
            pkg.scripts[k] = v
            added++
        }
    }
    if (added) {
        console.log(`  package.json: merged ${added} script entr${added === 1 ? 'y' : 'ies'}`)
        if (!DRY) fs.writeFileSync(dst, JSON.stringify(pkg, null, 2) + '\n')
        stats.merged++
    }
}

function mergeGitignore() {
    const kitLines = fs
        .readFileSync(path.join(KIT_ROOT, '.gitignore'), 'utf8')
        .split('\n')
        .filter((l) => l.trim() && !l.startsWith('#'))
    const dst = path.join(TARGET, '.gitignore')
    const existing = fs.existsSync(dst) ? fs.readFileSync(dst, 'utf8') : ''
    const have = new Set(existing.split('\n').map((l) => l.trim()))
    const missing = kitLines.filter((l) => !have.has(l.trim()))
    if (missing.length) {
        console.log(`  .gitignore: appended ${missing.length} line(s)`)
        if (!DRY) fs.writeFileSync(dst, existing.replace(/\n*$/, '\n') + '\n# servicenow-claude-kit\n' + missing.join('\n') + '\n')
        stats.merged++
    }
}

function copyClaudeMd() {
    const dst = path.join(TARGET, 'CLAUDE.md')
    if (fs.existsSync(dst)) {
        console.log('  CLAUDE.md exists — not touched. Merge the kit template by hand (see kit CLAUDE.md).')
        return
    }
    copyOne('CLAUDE.md')
}

console.log(`Installing servicenow-claude-kit into ${TARGET}${DRY ? ' (dry run)' : ''}`)
for (const p of COPY_PATHS) for (const rel of walk(p)) copyOne(rel)
copyClaudeMd()
mergePackageJson()
mergeGitignore()
console.log(
    `Done: ${stats.copied} copied, ${stats.skippedSame} identical, ${stats.skippedDiffers} kept (differs), ${stats.merged} merged.`
)
console.log('Next: open the repo in Claude Code and run /bootstrap.')
