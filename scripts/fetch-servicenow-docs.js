#!/usr/bin/env node
/**
 * fetch-servicenow-docs.js
 *
 * Vendors the official ServiceNow product documentation (markdown, "optimized
 * for AI Agent consumption") into a gitignored local mirror so build-time
 * agents (Claude Code) can ground against authoritative platform docs.
 *
 * Source : https://github.com/ServiceNow/ServiceNowDocs  (Apache-2.0)
 * Branch : MUST match the connected instance's release family. The repo keeps
 *          only the 3-4 newest families; the oldest branch is deleted on each
 *          GA — re-detect + re-fetch when the instance upgrades.
 *
 * Design:
 *   - NO vector DB. Retrieval is index (`llms.txt`) + ripgrep over markdown/.
 *   - The mirror is GITIGNORED (never enters git history / PR diffs).
 *   - Reproducibility lives in the committed `servicenow-docs.lock.json`
 *     (repo + branch + resolved SHA + fetched_at).
 *
 * Usage:
 *   node scripts/fetch-servicenow-docs.js --detect   # read glide.buildtag from the
 *                                                    # instance, derive the family,
 *                                                    # verify the branch exists, fetch
 *   node scripts/fetch-servicenow-docs.js --branch x # track an explicit branch
 *   node scripts/fetch-servicenow-docs.js            # re-fetch the locked branch
 *                                                    # (or 'zurich' if no lockfile)
 *   node scripts/fetch-servicenow-docs.js --check    # report SHA drift vs remote (no write)
 */

'use strict'

const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const REPO_URL = 'https://github.com/ServiceNow/ServiceNowDocs.git'
const REPO_ROOT = path.resolve(__dirname, '..')
const DEST = path.join(REPO_ROOT, 'vendor', 'servicenow-docs')
const LOCKFILE = path.join(REPO_ROOT, 'servicenow-docs.lock.json')
const FALLBACK_BRANCH = 'zurich'

const argv = process.argv.slice(2)
const CHECK = argv.includes('--check')
const DETECT = argv.includes('--detect')
const branchFlagIdx = argv.indexOf('--branch')

function git(args, opts) {
    const out = execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts })
    return typeof out === 'string' ? out.trim() : ''
}

function readLock() {
    try {
        return JSON.parse(fs.readFileSync(LOCKFILE, 'utf8'))
    } catch {
        return null
    }
}

function remoteBranches() {
    // "<sha>\trefs/heads/<branch>" per line
    const out = git(['ls-remote', '--heads', REPO_URL])
    const map = new Map()
    for (const line of out.split('\n')) {
        const [sha, ref] = line.split('\t')
        if (ref) map.set(ref.replace('refs/heads/', ''), sha.trim())
    }
    return map
}

async function detectFamily() {
    const { readBuildTag } = require('./lib/sn-rest')
    const buildtag = await readBuildTag()
    const m = String(buildtag).match(/^glide-([a-z]+)/i)
    if (!m) throw new Error(`Unparseable buildtag: ${buildtag}`)
    console.log(`[docs] instance buildtag: ${buildtag} -> release family: ${m[1].toLowerCase()}`)
    return m[1].toLowerCase()
}

async function resolveBranch() {
    if (branchFlagIdx !== -1) return argv[branchFlagIdx + 1]
    if (DETECT) {
        const family = await detectFamily()
        const branches = remoteBranches()
        if (branches.has(family)) return family
        console.error(
            `[docs] Branch '${family}' not found upstream (the repo deletes the oldest family on each GA).\n` +
                `[docs] Available branches: ${[...branches.keys()].join(', ')}\n` +
                `[docs] Pick the nearest family manually: npm run docs:servicenow -- --branch <name>`
        )
        process.exit(1)
    }
    return readLock()?.branch || FALLBACK_BRANCH
}

function runCheck(branch) {
    const lock = readLock()
    const branches = remoteBranches()
    const remote = branches.get(branch)
    if (!remote) {
        console.log(`[docs:check] Branch '${branch}' no longer exists upstream. Available: ${[...branches.keys()].join(', ')}`)
        process.exit(1)
    }
    if (!lock) {
        console.log(`[docs:check] No lockfile. Remote ${branch} HEAD is ${remote.slice(0, 12)}. Run: npm run docs:servicenow`)
        process.exit(1)
    }
    if (lock.branch !== branch) {
        console.log(`[docs:check] Lockfile tracks '${lock.branch}' but requested branch is '${branch}'. Re-fetch to switch.`)
        process.exit(1)
    }
    if (lock.sha === remote) {
        console.log(`[docs:check] Up to date — ${branch} @ ${remote.slice(0, 12)} (fetched ${lock.fetched_at}).`)
        process.exit(0)
    }
    console.log(`[docs:check] DRIFT — lockfile ${lock.sha.slice(0, 12)} vs remote ${remote.slice(0, 12)}. Run: npm run docs:servicenow`)
    process.exit(1)
}

function fetchMirror(branch) {
    const exists = fs.existsSync(path.join(DEST, '.git'))
    if (!exists) {
        fs.mkdirSync(path.dirname(DEST), { recursive: true })
        if (fs.existsSync(DEST)) fs.rmSync(DEST, { recursive: true, force: true })
        console.log(`[docs] Cloning ${branch} (shallow) -> vendor/servicenow-docs ...`)
        git(['clone', '--depth', '1', '--single-branch', '--branch', branch, REPO_URL, DEST], { stdio: 'inherit' })
    } else {
        console.log(`[docs] Updating existing mirror to origin/${branch} ...`)
        git(['-C', DEST, 'remote', 'set-url', 'origin', REPO_URL])
        git(['-C', DEST, 'fetch', '--depth', '1', 'origin', branch], { stdio: 'inherit' })
        git(['-C', DEST, 'checkout', '-B', branch, `origin/${branch}`])
        git(['-C', DEST, 'reset', '--hard', `origin/${branch}`])
    }

    const sha = git(['-C', DEST, 'rev-parse', 'HEAD'])
    const lock = {
        repo: 'ServiceNow/ServiceNowDocs',
        repo_url: REPO_URL,
        branch,
        sha,
        fetched_at: new Date().toISOString(),
        license: 'Apache-2.0',
        note: 'Gitignored mirror for build-time agent grounding. Retrieval = llms.txt index + ripgrep. Branch must match the instance release family — re-run with --detect after an instance upgrade.',
    }
    fs.writeFileSync(LOCKFILE, JSON.stringify(lock, null, 2) + '\n')

    const llms = path.join(DEST, 'llms.txt')
    const mdDir = path.join(DEST, 'markdown')
    const hasLlms = fs.existsSync(llms)
    const pubCount = fs.existsSync(mdDir)
        ? fs.readdirSync(mdDir, { withFileTypes: true }).filter((d) => d.isDirectory()).length
        : 0
    console.log(`[docs] Mirror ready @ ${sha.slice(0, 12)} (${branch})`)
    console.log(`[docs]   llms.txt: ${hasLlms ? 'present' : 'MISSING'} | markdown/ publications: ${pubCount}`)
    console.log(`[docs]   lockfile: servicenow-docs.lock.json`)
    if (!hasLlms || pubCount === 0) {
        console.error('[docs] WARNING: expected llms.txt + markdown/ subfolders — repo layout may have changed.')
        process.exit(2)
    }
}

;(async () => {
    try {
        const branch = await resolveBranch()
        if (CHECK) runCheck(branch)
        else fetchMirror(branch)
    } catch (err) {
        console.error(`[docs] ERROR: ${err.message}`)
        process.exit(1)
    }
})()
