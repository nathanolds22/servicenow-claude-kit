'use strict'
// scripts/lib/sn-creds.js
//
// Layered ServiceNow credential resolution for every kit script. Resolution
// order (first complete set wins):
//
//   1. Process env:  SERVICENOW_INSTANCE_URL / SERVICENOW_USERNAME / SERVICENOW_PASSWORD
//   2. Repo .env:    same keys, KEY=VALUE lines, gitignored (see .env.example)
//   3. ~/.claude.json: mcpServers.<name>.env — the MCP server registration.
//      <name> defaults to "ServiceNow"; override with SERVICENOW_MCP_SERVER_NAME
//      (in process env or .env) if the server is registered under another name.
//
// This keeps scripts working regardless of how the MCP server was registered
// on a given machine, and lets corporate machines keep the password out of
// ~/.claude.json entirely (use .env or session env instead).
//
// envValue(key) applies the same layering to ANY key (e.g.
// SCRIPT_EXECUTION_API_RESOURCE_PATH for the god-mode endpoint path).

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const ENV_FILE = path.join(REPO_ROOT, '.env')

let _dotenvCache = null
function dotenv() {
    if (_dotenvCache) return _dotenvCache
    _dotenvCache = {}
    try {
        for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
            const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
            if (!m || line.trim().startsWith('#')) continue
            // Strip optional surrounding quotes.
            _dotenvCache[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
        }
    } catch {
        /* no .env — fine */
    }
    return _dotenvCache
}

let _claudeJsonCache
function claudeJsonEnv() {
    if (_claudeJsonCache !== undefined) return _claudeJsonCache
    _claudeJsonCache = null
    try {
        const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8'))
        const name = process.env.SERVICENOW_MCP_SERVER_NAME || dotenv().SERVICENOW_MCP_SERVER_NAME || 'ServiceNow'
        _claudeJsonCache = cfg.mcpServers?.[name]?.env || null
    } catch {
        /* no ~/.claude.json or unreadable — fine */
    }
    return _claudeJsonCache
}

function envValue(key) {
    if (process.env[key] !== undefined && process.env[key] !== '') return process.env[key]
    const d = dotenv()
    if (d[key] !== undefined && d[key] !== '') return d[key]
    const c = claudeJsonEnv()
    if (c && c[key] !== undefined && c[key] !== '') return c[key]
    return undefined
}

function readCreds() {
    const url = envValue('SERVICENOW_INSTANCE_URL')
    const user = envValue('SERVICENOW_USERNAME')
    const password = envValue('SERVICENOW_PASSWORD')
    if (!url || !user || !password) {
        throw new Error(
            'ServiceNow credentials not found. Set SERVICENOW_INSTANCE_URL / ' +
                'SERVICENOW_USERNAME / SERVICENOW_PASSWORD via (1) process env, ' +
                `(2) ${ENV_FILE}, or (3) ~/.claude.json mcpServers.<name>.env ` +
                '(server name defaults to "ServiceNow"; override with SERVICENOW_MCP_SERVER_NAME). ' +
                'Run /bootstrap to set this up interactively.'
        )
    }
    return { url: url.replace(/\/$/, ''), user, password }
}

module.exports = { readCreds, envValue, ENV_FILE }
