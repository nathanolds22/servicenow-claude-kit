# A2A smoke — prove the round-trip before declaring exposure

Five stages with PASS / BLOCKED / FAIL semantics: **BLOCKED** = the chain is broken before the agent (provisioning/auth gap — fix and re-run); **FAIL** = the chain reached the agent and the agent side is defective; **PASS** = stage proven. Never declare an agent "callable via A2A" from a card read alone — the card endpoint and the invocation endpoint fail independently.

Credentials resolve via the layered lookup in `scripts/lib/sn-creds.js` (`SERVICENOW_INSTANCE_URL` for the base URL, `A2A_OAUTH_CLIENT_ID` / `A2A_OAUTH_CLIENT_SECRET` for the OAuth client).

## Stage 0 — stop-condition presence check (gate)

Before sending anything, read the agent's instruction set (Table API GET on the `sn_aia_agent` record) and assert a STOP CONDITIONS block exists **and** explicitly rejects instruction-marker content (`<system>`, `Ignore previous`, `New instructions:`). Absent or softened → **BLOCKED**: do not smoke, and do not expose, an agent whose adversarial-input defence is missing (`.claude/rules/ai-agents.md` — stop conditions are load-bearing). Re-run this stage after every prompt bump of an exposed agent.

## Stage 1 — agent card GET (discovery)

```
GET <instance-url>/api/sn_aia/a2a/v2/agent_card/id/<agent_sys_id>
```

PASS = HTTP 200 AND the body parses as JSON with `protocolVersion` and a `skills` array. Evidence worth recording: status, `protocolVersion`, `name`, `skills.length`.

- **FAIL** = HTTP 200 but the body doesn't parse, `protocolVersion` is missing, or `skills` is empty/absent — a structurally broken card is an agent-side defect, not an auth problem.
- A 400 with `"No agent available for your query"` is a platform-side exclusion of that agent from the A2A surface (not auth) → **BLOCKED** — see [troubleshooting.md](troubleshooting.md).
- While you have the card, audit it against the SKILL.md card requirements (card-level `defaultInputModes`/`defaultOutputModes`, per-skill `inputModes`/`outputModes` — no `default` prefix at skill level).

## Stage 2 — token mint

```
POST <instance-url>/oauth_token.do
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&client_id=<id>&client_secret=<secret>
```

PASS = HTTP 200 with an `access_token` in the JSON body. This is exactly what the kit's `a2a.invocation_authenticated` full-mode probe does — `npm run probe:full` and check the report entry if you'd rather not hand-roll the call. Mint failure = **BLOCKED** (provisioning gap, not agent gap) — work [provisioning.md](provisioning.md) before touching the agent. This stage has no distinct FAIL: nothing here reaches the agent.

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

Use a probe message that explicitly forbids tool invocation so the smoke is cheap and side-effect-free (the message text is a courtesy, not a defence — the defence is the Stage 0 stop-condition gate). Do not expect `"blocking": true` to spare you the callback registry: on current families the flag is ignored and `message/send` without a registered push config still fails with `-32602 "Push Notification URL is required for asynchronous requests"` (live-verified 2026-06-12) — the callback-registry row from [provisioning.md](provisioning.md) step 5 is required for every smoke. Reserve a recognisable caller token — replace the placeholder with a concrete value like `smoke-<yyyymmdd>`; sending a literal `<project>-smoke` placeholder pollutes real-caller usage buckets — so dashboards can filter smoke traffic.

Interpret the status precisely:

| Result | Meaning | Verdict |
|---|---|---|
| 2xx | invocation accepted | **PASS** (pending Stage 4) |
| 401 / 403 | auth chain broken (token, scope mapping, roles) | **BLOCKED** |
| other non-2xx | auth worked, request reached the agent; payload/protocol error | auth **PASS**, fix the payload |

That last row matters: a JSON-RPC error body with a 200/400-level non-auth status means the OAuth chain is healthy — don't re-debug provisioning for a malformed `params.message`.

## Stage 4 — verify execution and attribution (all runs, sync and async)

A 2xx from `message/send` proves HTTP receipt, **not** that a plan dispatched and completed — verify both, whichever `blocking` mode was used:

1. **Execution plan**: query `sn_aia_execution_plan` and identify your run by the **Objective** field containing the probe text (officially documented verification path); confirm the plan reached a productive terminal state, then `debug_agent_execution` for a clean trace. No matching plan within the observation window = **FAIL** — invocation accepted but dispatch didn't materialize; switch to the dispatch-stall playbook (`.claude/rules/ai-agents.md`).
2. **Usage-log attribution** (async runs, if the project logs per-caller buckets per `.claude/rules/ai-tools.md`): poll the project's usage-log table for a row in the caller's bucket created since the invocation, and assert the caller id matches the `pushNotificationConfig.token` you sent. Give the callback + logger a generous window (the agent run itself may take ~30–60s).

## Recording

Append the smoke result to `.team/agent-findings/` (dated file): card URL, OAuth entity name, request shape, statuses observed, plan evidence — **with every credential value redacted** (`Authorization: Bearer <redacted>`, no live client_id/secret/token in any committed file). The exposure claim in any doc should link to this finding, not restate it.
