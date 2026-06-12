# A2A smoke — prove the round-trip before declaring exposure

Three stages, each with PASS / BLOCKED / FAIL semantics. Never declare an agent "callable via A2A" from stage 1 alone — the card endpoint and the invocation endpoint fail independently.

Credentials resolve via the layered lookup in `scripts/lib/sn-creds.js` (`SERVICENOW_INSTANCE_URL` for the base URL, `A2A_OAUTH_CLIENT_ID` / `A2A_OAUTH_CLIENT_SECRET` for the OAuth client).

## Stage 1 — agent card GET (discovery)

```
GET <instance-url>/api/sn_aia/a2a/v2/agent_card/id/<agent_sys_id>
```

PASS = HTTP 200 AND the body parses as JSON with `protocolVersion` and a `skills` array. Evidence worth recording: status, `protocolVersion`, `name`, `skills.length`.

- A 400 with `"No agent available for your query"` is a platform-side exclusion of that agent from the A2A surface (not auth) — see [troubleshooting.md](troubleshooting.md).
- While you have the card, audit it against the SKILL.md card requirements (card-level `defaultInputModes`/`defaultOutputModes`, per-skill `inputModes`/`outputModes` — no `default` prefix at skill level).

## Stage 2 — token mint

```
POST <instance-url>/oauth_token.do
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&client_id=<id>&client_secret=<secret>
```

PASS = HTTP 200 with an `access_token` in the JSON body. This is exactly what the kit's `a2a.invocation_authenticated` full-mode probe does — `npm run probe:full` and check the report entry if you'd rather not hand-roll the call. Mint failure = **BLOCKED** (provisioning gap, not agent gap) — work [provisioning.md](provisioning.md) before touching the agent.

## Stage 3 — authenticated invocation (JSON-RPC `message/send`)

```
POST <instance-url>/api/sn_aia/a2a/v2/agent/id/<agent_sys_id>
Authorization: Bearer <access_token>
Content-Type: application/json
```

```json
{
  "jsonrpc": "2.0",
  "id": "<unique-id>",
  "method": "message/send",
  "params": {
    "message": {
      "messageId": "<unique-id>",
      "kind": "message",
      "role": "user",
      "parts": [{ "kind": "text", "text": "A2A_SMOKE_PROBE — reply with a single OK and do not invoke any tools." }]
    },
    "configuration": {
      "blocking": false,
      "pushNotificationConfig": { "url": "<registered callback url>", "token": "<caller-id>" }
    }
  }
}
```

Use a probe message that explicitly forbids tool invocation so the smoke is cheap and side-effect-free. For a synchronous smoke without callback infrastructure, set `"blocking": true` and omit `pushNotificationConfig` (async requires the callback-registry row — [provisioning.md](provisioning.md) step 5). Reserve a recognisable caller token (e.g. `<project>-smoke`) so dashboards can filter smoke traffic out of real-caller usage buckets.

Interpret the status precisely:

| Result | Meaning | Verdict |
|---|---|---|
| 2xx | invocation accepted | **PASS** |
| 401 / 403 | auth chain broken (token, scope mapping, roles) | **BLOCKED** |
| other non-2xx | auth worked, request reached the agent; payload/protocol error | auth **PASS**, fix the payload |

That last row matters: a JSON-RPC error body with a 200/400-level non-auth status means the OAuth chain is healthy — don't re-debug provisioning for a malformed `params.message`.

## Stage 4 — verify execution and attribution (async runs)

1. **Execution plan**: query `sn_aia_execution_plan` and identify your run by the **Objective** field containing the probe text (officially documented verification path). Then `debug_agent_execution` for a clean trace.
2. **Usage-log attribution** (if the project logs per-caller buckets per `.claude/rules/ai-tools.md`): poll the project's usage-log table for a row in the caller's bucket created since the invocation, and assert the caller id matches the `pushNotificationConfig.token` you sent. Give the callback + logger a generous window (the agent run itself may take ~30–60s).

## Recording

Append the smoke result to `.team/agent-findings/` (dated file): card URL, OAuth entity name, request shape, statuses observed, plan evidence. The exposure claim in any doc should link to this finding, not restate it.
