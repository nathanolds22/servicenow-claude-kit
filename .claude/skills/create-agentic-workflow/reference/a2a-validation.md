# Validating a new agent via A2A

Provisioning law and decision tree: [.claude/rules/a2a-exposure.md](../../../rules/a2a-exposure.md) (and the `a2a-usage` skill when present). This page covers only what a freshly built agent needs before the A2A smoke passes, with live-verified failure signatures.

## 0. Gate

`getCapability('a2a.invocation_authenticated')` must be `true` before attempting any invocation step (it is a `--full` probe — run `npm run probe:full`). The `a2a.card_readable` capability is informational: it samples an arbitrary agent, so `NO` may just mean the sampled agent isn't exposed; `unknown` means the full probe hasn't run.

## 1. Discovery — the card must resolve first

```
GET /api/sn_aia/a2a/v2/agent_card/id/<agent_sys_id>     (basic auth works for the card)
```

- **400 `"No agent available for your query"`** does NOT mean the agent is missing — it means the `sn_aia_agent_config` row isn't exposing it. Set `public=true` and `specialist_enabled=true` on the config row and re-fetch (verified: the flip alone turned 400 into 200).
- Card-metadata requirements (modes, per-skill fields, description quality) are canonical in the a2a-exposure rule — read it there rather than from a copy here. Two live-verified card facts worth knowing: every tool appears under `skills[]`, and `version` is the platform constant `"1.0.0"` regardless of `sn_aia_version` state — don't chase version drift through the card.

## 2. Auth — OAuth client-credentials, never basic

```
POST /oauth_token.do   (grant_type=client_credentials, client_id, client_secret)
  → 200 { access_token, scope: "a2aauthscope", expires_in: 3599 }
```

Basic auth on the invocation endpoint returns 401 **by design**. The kit's `a2a.invocation_authenticated` capability probes the token mint; provision per the a2a-exposure rule.

## 3. Invocation — JSON-RPC, and the push-notification registry gotcha

Both A2A endpoints — `/api/sn_aia/a2a/v2/agent/id/<id>` and `/api/sn_aia/a2a/v1/agent/id/<id>` — speak JSON-RPC (`message/send` with `params.message = {role, kind:"message", messageId, parts:[{kind:"text", text}]}`). A plain JSON body gets `-32600 Invalid JSON-RPC Request`. (Do not confuse these with the internal `/api/sn_aia/agenticai/v1/agent/id/<id>` endpoint from §4, which is plain REST, not JSON-RPC.)

On current families the A2A task pipeline is **async-only** and demands a pre-registered push-notification callback:

| You send | Platform answers |
|---|---|
| `message/send`, no push config (even with `configuration.blocking=true` — it's ignored) | `-32602 "Push Notification URL is required for asynchronous requests"` |
| Inline `pushNotificationConfig.url` NOT matching a registered row | `-32003 "Push Notification is not supported"` |
| `message/stream` | `-32601` (matches the card's `streaming:false`) |
| Inline URL matching a `sn_aia_external_agent_callback_registry` row with `state=verified` | `200 {result:{id, contextId, status:{state:"submitted"}}}`, then poll `tasks/get` |

So a first-time A2A smoke needs a one-time per-caller setup: a callback registry row (`url`, `state=verified`) — inserting it auto-creates a connection/credential alias for the platform's outbound POSTs. Registering callbacks is shared instance configuration: agree it with the instance owner, one row per external caller, and point the URL at an endpoint that caller owns.

> **Validation status**: the error rows of the table above are live-verified; the success row (registry-matched URL → `submitted` → `tasks/get`) is assembled from those signatures plus platform docs and has **not** been executed PASS by this kit's own validation — the registry row is operator-governed and needs a caller-owned endpoint. Details and retire-when: [.team/agent-findings/2026-06-12-a2a-message-send-roundtrip-unverified.md](../../../../.team/agent-findings/2026-06-12-a2a-message-send-roundtrip-unverified.md). Prove it on your instance with the `a2a-usage` smoke before declaring an agent A2A-callable.

## 4. The trigger-free alternative for build-time verification

When you only need to prove the agent dispatches cleanly (not the A2A transport itself), skip the registry entirely: the internal external-agent API (`POST /api/sn_aia/agenticai/v1/agent/id/<sys_id>` — see [build-recipe.md](build-recipe.md) §4) runs the same plan pipeline with normal authentication and no callback requirement, and `debug_agent_execution` gives the full trace. Use A2A for what only A2A proves: the OAuth chain, card discovery, and external-caller reachability.

## 5. Before declaring the agent exposed

Two rule-mandated steps complete the checklist (full text in the a2a-exposure rule): wire every invocation into a per-caller usage bucket (`a2a_external_<caller>`) so operators can budget-gate by tenant, and record the exposure in `.team/agent-findings/` with the card URL, OAuth entity, and a redacted example request/response.
