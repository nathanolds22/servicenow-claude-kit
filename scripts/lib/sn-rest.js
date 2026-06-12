'use strict'
// scripts/lib/sn-rest.js
//
// Shared basic-auth REST client for the kit's probe + utility scripts.
// Credentials resolve lazily on first call via ./sn-creds (layered:
// process env -> repo .env -> ~/.claude.json). Callers can catch the
// missing-creds error and degrade (e.g. the postinstall lazy probe).
//
// Surface kept deliberately small:
//   api(method, path, body)  -> { status, ok, body, json() }
//   executeScript(script)    -> god-mode Scripted REST execution (requires the
//                               companion endpoint from the servicenow-mcp
//                               fork's servicenow_scripts/DEPLOYMENT_GUIDE.md)
//   getCreds()               -> { url, user, password, auth }

const { readCreds, envValue } = require('./sn-creds')

let _creds = null
let _auth = null
function getCreds() {
    if (_creds) return { ..._creds, auth: _auth }
    _creds = readCreds()
    _auth = 'Basic ' + Buffer.from(_creds.user + ':' + _creds.password).toString('base64')
    return { ..._creds, auth: _auth }
}

async function api(method, reqPath, body) {
    const c = getCreds()
    const init = {
        method,
        headers: { Authorization: c.auth, Accept: 'application/json' },
    }
    if (body !== undefined) {
        init.headers['Content-Type'] = 'application/json'
        init.body = JSON.stringify(body)
    }
    const res = await fetch(c.url + reqPath, init)
    const text = await res.text()
    return {
        status: res.status,
        ok: res.ok,
        body: text,
        json() {
            try {
                return JSON.parse(text)
            } catch {
                return null
            }
        },
    }
}

// God-mode script execution via the Scripted REST API shipped with the
// servicenow-mcp fork (default resource path /api/global/ai_agent_executor).
// Override the base path with SCRIPT_EXECUTION_API_RESOURCE_PATH (same env
// var the MCP server itself honours). Returns the parsed inner result object
// ({ success, result, error, logs, ... }) or throws on transport failure.
function scriptExecutionBasePath() {
    return (envValue('SCRIPT_EXECUTION_API_RESOURCE_PATH') || '/api/global/ai_agent_executor').replace(/\/$/, '')
}

async function executeScript(script) {
    const res = await api('POST', scriptExecutionBasePath() + '/execute', { script })
    if (!res.ok) {
        const err = new Error(`executeScript HTTP ${res.status}: ${res.body.slice(0, 300)}`)
        err.status = res.status
        throw err
    }
    const parsed = res.json()
    return parsed?.result ?? parsed
}

// glide.buildtag is FILE-backed (glide.properties), not a sys_properties row —
// a Table API query returns 200 with zero rows, and /stats.do 302s to the
// login page under basic auth (both verified live 2026-06-12). Reliable
// basic-auth sources, in order:
//   1. sys_upgrade_history latest glide-* to_version (Table API, read-only)
//   2. god-mode executeScript gs.getProperty('glide.buildtag') (if deployed)
//   3. sys_properties row (some instances materialize it)
async function readBuildTag() {
    const hist = await api(
        'GET',
        '/api/now/table/sys_upgrade_history?sysparm_query=to_versionSTARTSWITHglide-^ORDERBYDESCsys_created_on&sysparm_fields=to_version&sysparm_limit=1'
    )
    const ver = hist.json()?.result?.[0]?.to_version
    if (ver) return ver.replace(/\.zip$/, '')
    try {
        const r = await executeScript('gs.getProperty("glide.buildtag");')
        if (r && r.success !== false && /^glide-/.test(String(r.result))) return String(r.result)
    } catch {
        /* executor not deployed — fall through */
    }
    const tbl = await api(
        'GET',
        '/api/now/table/sys_properties?sysparm_query=name=glide.buildtag&sysparm_fields=value&sysparm_limit=1'
    )
    const row = tbl.json()?.result?.[0]
    if (row?.value) return row.value
    throw new Error(`Could not read build tag (sys_upgrade_history HTTP ${hist.status} empty, executor unavailable, sys_properties empty)`)
}

module.exports = { api, executeScript, getCreds, scriptExecutionBasePath, readBuildTag }
