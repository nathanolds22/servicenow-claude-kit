#!/usr/bin/env node
// scripts/probe-instance-capabilities.js
//
// Capability probe — discovers what works on the connected ServiceNow
// instance and writes the verdict to `.team/instance-capabilities.json`.
// The report, not this doc and not anyone's memory, is the source of truth
// for instance state. See .claude/rules/capability-report.md.
//
// Modes:
//   --quick               read-only probes only (default; CI-safe)
//   --full                + side-effect probes (sentinel writes)
//   --fail-on-regression  exit non-zero if any capability that was true is now false
//   --print-summary       don't probe; just print a one-screen summary of the
//                         existing report (for the SessionStart hook)
//   --lazy                probe only if report missing or > 24h stale, never throw
//                         (for npm postinstall — must always exit 0)
//   --json                print machine-readable diff after probing
//
// Probe discipline (.claude/rules/capability-report.md):
//   - quick probes are READ-ONLY against the instance
//   - full probes may mutate, but only probe-owned KIT_PROBE_* sentinels,
//     cleaned up (or no-op same-value writes) before the probe returns
//   - never infer one capability from another; each is probed independently

'use strict'

const { api, executeScript, readBuildTag, getCreds } = require('./lib/sn-rest')
const { envValue } = require('./lib/sn-creds')
const {
    REPORT_PATH,
    loadReport,
    writeReport,
    isStale,
    setCapability,
    summariseReport,
} = require('./lib/capability-report')

const ARGS = process.argv.slice(2)
const flag = (n) => ARGS.includes(n)
const FULL = flag('--full')
const FAIL_ON_REGRESSION = flag('--fail-on-regression')
const PRINT_SUMMARY = flag('--print-summary')
const LAZY = flag('--lazy')
const JSON_OUT = flag('--json')

const SENTINEL_PREFIX = 'KIT_PROBE_DELETE_ME'

function ok(observed, evidence, method) {
    return { status: true, observed, evidence, probed_at: new Date().toISOString(), probe_method: method }
}
function no(observed, evidence, method) {
    return { status: false, observed, evidence, probed_at: new Date().toISOString(), probe_method: method }
}
function na(observed, evidence, method) {
    return { status: 'n/a', observed, evidence, probed_at: new Date().toISOString(), probe_method: method }
}
function err(observed, evidence, method) {
    return { status: 'error', observed, evidence, probed_at: new Date().toISOString(), probe_method: method }
}

// Parse "glide-<family>-<date>__patch..." into the release family name the
// ServiceNowDocs repo uses as a branch name (lowercase word, e.g. "zurich").
function parseFamily(buildtag) {
    const m = String(buildtag).match(/^glide-([a-z]+)/i)
    return m ? m[1].toLowerCase() : null
}

// Shared by the a2a.* probes: mint a client-credentials Bearer token against
// /oauth_token.do. Side effect (why a2a.* probes are --full): the instance
// issues a short-lived oauth token credential server-side; no rows the probe
// must clean up. `configured: false` means no OAuth client env vars are set.
async function mintA2AToken() {
    const clientId = envValue('A2A_OAUTH_CLIENT_ID')
    const clientSecret = envValue('A2A_OAUTH_CLIENT_SECRET')
    if (!clientId || !clientSecret) return { configured: false }
    const c = getCreds()
    const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret })
    const res = await fetch(c.url + '/oauth_token.do', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
    })
    const text = await res.text()
    let token = null
    let expiresIn = null
    try {
        const parsed = JSON.parse(text)
        token = parsed.access_token || null
        expiresIn = parsed.expires_in ?? null
    } catch {
        /* non-JSON error body */
    }
    return { configured: true, http: res.status, token, expires_in: expiresIn, bodyText: text }
}

const PROBES = [
    {
        name: 'instance.connectivity',
        mode: 'quick',
        expected: 'Basic-auth REST reaches the instance (sys_properties GET returns 200)',
        async run() {
            const res = await api('GET', '/api/now/table/sys_properties?sysparm_query=name=glide.buildtag&sysparm_fields=value&sysparm_limit=1')
            if (res.status === 200) return ok('2xx', { http: res.status }, 'quick')
            return no(`http-${res.status}`, { http: res.status, body: res.body.slice(0, 200) }, 'quick')
        },
    },
    {
        name: 'instance.release_family',
        mode: 'quick',
        expected: 'Instance build tag parses to a release family name (informational; feeds docs:servicenow --detect)',
        async run() {
            let buildtag
            try {
                buildtag = await readBuildTag()
            } catch (e) {
                return err('buildtag-unreadable', { message: e.message.slice(0, 200) }, 'quick')
            }
            const family = parseFamily(buildtag)
            if (!family) return no('unparseable-buildtag', { buildtag }, 'quick')
            // Compare against the committed docs lockfile when present.
            let docsBranch = null
            try {
                docsBranch = require('../servicenow-docs.lock.json').branch
            } catch {
                /* no lockfile yet */
            }
            return ok(family, { buildtag, family, docs_lock_branch: docsBranch, docs_branch_match: docsBranch ? docsBranch === family : null }, 'quick')
        },
    },
    {
        name: 'table_api.read',
        mode: 'quick',
        expected: 'Table API GET on a core table returns 200 for the configured user',
        async run() {
            const res = await api('GET', '/api/now/table/sys_user?sysparm_fields=sys_id&sysparm_limit=1')
            if (res.status === 200) return ok('2xx', { http: res.status }, 'quick')
            return no(`http-${res.status}`, { http: res.status, body: res.body.slice(0, 200) }, 'quick')
        },
    },
    {
        name: 'table_api.write',
        mode: 'full',
        expected: 'Table API can insert, update, and delete a probe-owned sentinel row (sys_user_preference)',
        async run() {
            const post = await api('POST', '/api/now/table/sys_user_preference', {
                name: `${SENTINEL_PREFIX}.table_api_write`,
                value: 'probe',
                description: 'servicenow-claude-kit capability probe sentinel — safe to delete',
            })
            if (post.status !== 201) return no(`insert-http-${post.status}`, { http: post.status, body: post.body.slice(0, 200) }, 'full')
            const sysId = post.json()?.result?.sys_id
            const patch = await api('PATCH', `/api/now/table/sys_user_preference/${sysId}`, { value: 'probe-updated' })
            const del = await api('DELETE', `/api/now/table/sys_user_preference/${sysId}`)
            const allOk = patch.status === 200 && (del.status === 204 || del.status === 200)
            if (allOk) return ok('insert-update-delete', { sentinel_sys_id: sysId }, 'full')
            return no('partial', { insert: post.status, update: patch.status, delete: del.status, sentinel_sys_id: sysId }, 'full')
        },
    },
    {
        name: 'table_api.sys_dictionary_writable',
        mode: 'full',
        expected: 'Table API PATCH on sys_dictionary lands (no-op same-value write; metadata edits have a working path)',
        async run() {
            const get = await api('GET', '/api/now/table/sys_dictionary?sysparm_query=name=sys_user_preference^element=description&sysparm_fields=sys_id,comments&sysparm_limit=1')
            const row = get.json()?.result?.[0]
            if (!row) return err('dict-row-not-found', { http: get.status }, 'full')
            // Same-value write: proves the PATCH path without changing anything.
            const patch = await api('PATCH', `/api/now/table/sys_dictionary/${row.sys_id}`, { comments: row.comments || '' })
            if (patch.status === 200) return ok('2xx-noop-patch', { sys_id: row.sys_id }, 'full')
            return no(`http-${patch.status}`, { http: patch.status, body: patch.body.slice(0, 200) }, 'full')
        },
    },
    {
        name: 'execute_script.available',
        mode: 'quick',
        expected: 'God-mode Scripted REST endpoint is deployed and executes a read-only script (see servicenow-mcp servicenow_scripts/DEPLOYMENT_GUIDE.md)',
        async run() {
            try {
                const r = await executeScript('gs.getProperty("glide.buildtag");')
                if (r && r.success !== false) {
                    return ok('executes', { scope_used: r.scope_used ?? null, result_sample: String(r.result).slice(0, 60) }, 'quick')
                }
                return no('endpoint-error', { error: r?.error ?? null }, 'quick')
            } catch (e) {
                if (e.status === 404) return no('not-deployed', { http: 404 }, 'quick')
                if (e.status === 401 || e.status === 403) return no(`auth-${e.status}`, { http: e.status }, 'quick')
                return err('transport', { message: e.message.slice(0, 200) }, 'quick')
            }
        },
    },
    {
        name: 'execute_script.runs_global_scope',
        mode: 'quick',
        expected: 'God-mode script execution reports global scope — scoped sandboxes silently drop sys_* metadata writes',
        async run() {
            try {
                const r = await executeScript('gs.getCurrentScopeName();')
                if (!r || r.success === false) return na('executor-unavailable', { error: r?.error ?? null }, 'quick')
                const scope = r.scope_used || r.result
                if (String(scope).includes('global') || scope === 'rhino.global') return ok(String(scope), { scope }, 'quick')
                return no(String(scope), { scope, hint: 'sandboxed executor: sys_dictionary and other sys_* writes will silently no-op; use Table API PATCH for metadata' }, 'quick')
            } catch (e) {
                return na('executor-unavailable', { message: e.message.slice(0, 120) }, 'quick')
            }
        },
    },
    {
        name: 'flow_designer.api_available',
        mode: 'quick',
        expected: 'Flow Designer is installed and sys_hub_flow is readable (flow health checks possible)',
        async run() {
            const res = await api('GET', '/api/now/table/sys_hub_flow?sysparm_fields=sys_id&sysparm_limit=1')
            if (res.status === 200) return ok('2xx', { http: res.status }, 'quick')
            return no(`http-${res.status}`, { http: res.status }, 'quick')
        },
    },
    {
        name: 'sn_aia.installed',
        mode: 'quick',
        expected: 'AI Agents plugin (sn_aia) is installed and sn_aia_agent is readable',
        async run() {
            const res = await api('GET', '/api/now/table/sn_aia_agent?sysparm_fields=sys_id&sysparm_limit=1')
            if (res.status === 200) return ok('2xx', { http: res.status }, 'quick')
            if (res.status === 400 || res.status === 404) return no('plugin-absent', { http: res.status }, 'quick')
            return no(`http-${res.status}`, { http: res.status }, 'quick')
        },
    },
    {
        name: 'sn_aia.agent_crud_available',
        mode: 'full',
        expected: 'sn_aia_agent rows can be created and deleted via Table API (agent authoring path works)',
        async run() {
            const probe = await api('GET', '/api/now/table/sn_aia_agent?sysparm_fields=sys_id&sysparm_limit=1')
            if (probe.status !== 200) return na('sn_aia-absent', { http: probe.status }, 'full')
            const post = await api('POST', '/api/now/table/sn_aia_agent', {
                name: `${SENTINEL_PREFIX} agent`,
                description: 'servicenow-claude-kit capability probe sentinel — safe to delete',
                active: 'false',
            })
            if (post.status !== 201) return no(`insert-http-${post.status}`, { http: post.status, body: post.body.slice(0, 200) }, 'full')
            const sysId = post.json()?.result?.sys_id
            const del = await api('DELETE', `/api/now/table/sn_aia_agent/${sysId}`)
            if (del.status === 204 || del.status === 200) return ok('insert-delete', { sentinel_sys_id: sysId }, 'full')
            return no(`delete-http-${del.status}`, { sentinel_sys_id: sysId, delete: del.status, hint: 'sentinel row left behind — delete manually' }, 'full')
        },
    },
    {
        name: 'catalog.read',
        mode: 'quick',
        expected: 'Service Catalog tables are readable (sc_cat_item GET returns 200)',
        async run() {
            const res = await api('GET', '/api/now/table/sc_cat_item?sysparm_fields=sys_id&sysparm_limit=1')
            if (res.status === 200) return ok('2xx', { http: res.status }, 'quick')
            return no(`http-${res.status}`, { http: res.status }, 'quick')
        },
    },
    {
        name: 'catalog.writable',
        mode: 'full',
        expected: 'sc_cat_item rows can be created and deleted via Table API (catalog authoring path works)',
        async run() {
            const post = await api('POST', '/api/now/table/sc_cat_item', {
                name: `${SENTINEL_PREFIX} item`,
                short_description: 'servicenow-claude-kit capability probe sentinel — safe to delete',
                active: 'false',
            })
            if (post.status !== 201) return no(`insert-http-${post.status}`, { http: post.status, body: post.body.slice(0, 200) }, 'full')
            const sysId = post.json()?.result?.sys_id
            const del = await api('DELETE', `/api/now/table/sc_cat_item/${sysId}`)
            if (del.status === 204 || del.status === 200) return ok('insert-delete', { sentinel_sys_id: sysId }, 'full')
            return no(`delete-http-${del.status}`, { sentinel_sys_id: sysId, delete: del.status, hint: 'sentinel row left behind — delete manually' }, 'full')
        },
    },
    {
        name: 'pa.plugin_active',
        mode: 'quick',
        expected: 'Platform Analytics is installed (pa_dashboards GET returns 200)',
        async run() {
            const res = await api('GET', '/api/now/table/pa_dashboards?sysparm_fields=sys_id&sysparm_limit=1')
            if (res.status === 200) return ok('2xx', { http: res.status }, 'quick')
            if (res.status === 400 || res.status === 404) return no('plugin-absent', { http: res.status }, 'quick')
            return no(`http-${res.status}`, { http: res.status }, 'quick')
        },
    },
    {
        name: 'a2a.invocation_authenticated',
        mode: 'full',
        expected: 'OAuth client-credentials + a2aauthscope mints a Bearer token (A2A invocation auth chain is provisioned)',
        // Side effect: token minting only (see mintA2AToken) — no instance rows touched.
        async run() {
            const mint = await mintA2AToken()
            if (!mint.configured) {
                return na('no-oauth-client-configured', { hint: 'provision per the a2a-exposure rule, then set A2A_OAUTH_CLIENT_{ID,SECRET}' }, 'full')
            }
            // expires_in goes into evidence so a later flip has a fuller audit
            // trail (token lifetime is part of the provisioned-auth contract).
            if (mint.http === 200 && mint.token) return ok('token-minted', { http: mint.http, expires_in: mint.expires_in }, 'full')
            return no(`http-${mint.http}`, { http: mint.http, body: mint.bodyText.slice(0, 200) }, 'full')
        },
    },
    {
        name: 'a2a.card_readable',
        mode: 'full',
        expected: 'A2A agent-card endpoint returns HTTP 200 + protocolVersion for a Bearer-authenticated GET (informational until a consumer branches on it; catches token-mints-but-card-surface-dark, e.g. the Studio third-party-access toggle off)',
        // Side effect: token minting only (see mintA2AToken) — the agent list
        // and card read are plain GETs; no instance rows touched.
        async run() {
            const mint = await mintA2AToken()
            if (!mint.configured) {
                return na('no-oauth-client-configured', { hint: 'provision per the a2a-exposure rule, then set A2A_OAUTH_CLIENT_{ID,SECRET}' }, 'full')
            }
            if (!(mint.http === 200 && mint.token)) {
                return err('token-mint-failed', { http: mint.http, hint: 'card readability not assessable without a token — see a2a.invocation_authenticated' }, 'full')
            }
            // Never filter this query on `active`: the column is not queryable on
            // Australia-family instances and the query dies with a misleading 403
            // "Field(s) present in the query do not have permission".
            const agents = await api('GET', '/api/now/table/sn_aia_agent?sysparm_fields=sys_id&sysparm_limit=1')
            if (agents.status === 400 || agents.status === 404) return na('sn_aia-absent', { http: agents.status }, 'full')
            if (agents.status !== 200) return err(`agent-list-http-${agents.status}`, { http: agents.status, body: agents.body.slice(0, 200) }, 'full')
            const agentId = agents.json()?.result?.[0]?.sys_id
            if (!agentId) return na('no-agent-rows', { hint: 'no sn_aia_agent row to read a card for' }, 'full')
            const c = getCreds()
            const res = await fetch(`${c.url}/api/sn_aia/a2a/v2/agent_card/id/${agentId}`, {
                headers: { Authorization: `Bearer ${mint.token}`, Accept: 'application/json' },
            })
            const text = await res.text()
            let card = null
            try {
                card = JSON.parse(text)
            } catch {
                /* non-JSON body */
            }
            if (res.status === 200 && card?.protocolVersion) {
                return ok('card-read', { http: res.status, agent_sys_id: agentId, protocol_version: card.protocolVersion }, 'full')
            }
            if (res.status === 200) {
                return no('200-no-protocolVersion', { http: res.status, agent_sys_id: agentId, body: text.slice(0, 200) }, 'full')
            }
            return no(`http-${res.status}`, {
                http: res.status,
                agent_sys_id: agentId,
                body: text.slice(0, 200),
                hint: 'token mints but the card surface is dark — check the AI Agent Studio "Allow third party to access ServiceNow AI agents" toggle',
            }, 'full')
        },
    },
]

async function main() {
    if (PRINT_SUMMARY) {
        console.log(summariseReport(loadReport()))
        return
    }

    const report = loadReport()

    if (LAZY) {
        const dayMs = 24 * 60 * 60 * 1000
        if (report.generated_at && !isStale(report, dayMs)) return
    }

    let creds
    try {
        creds = require('./lib/sn-creds').readCreds()
    } catch (e) {
        if (LAZY) return
        console.error(e.message)
        process.exit(1)
    }
    report.instance_url = creds.url

    const before = JSON.parse(JSON.stringify(report.capabilities || {}))
    const toRun = PROBES.filter((p) => FULL || p.mode === 'quick')

    for (const probe of toRun) {
        process.stdout.write(`probing ${probe.name} ... `)
        let entry
        try {
            entry = await probe.run()
        } catch (e) {
            entry = err('probe-threw', { message: e.message.slice(0, 300) }, probe.mode)
        }
        entry.expected = probe.expected
        setCapability(report, probe.name, entry)
        console.log(typeof entry.status === 'boolean' ? (entry.status ? 'OK' : 'NO') : entry.status)
    }

    const path = writeReport(report)
    console.log(`\nreport written: ${path}`)
    console.log(summariseReport(report))

    const regressions = Object.keys(report.capabilities).filter(
        (k) => before[k]?.status === true && report.capabilities[k].status === false
    )
    if (regressions.length) {
        console.error(`\nREGRESSIONS: ${regressions.join(', ')}`)
        if (FAIL_ON_REGRESSION) process.exit(2)
    }

    if (JSON_OUT) {
        console.log(JSON.stringify({ report_path: path, regressions, capabilities: report.capabilities }, null, 2))
    }
}

main().catch((e) => {
    if (LAZY) process.exit(0)
    console.error(e)
    process.exit(1)
})
