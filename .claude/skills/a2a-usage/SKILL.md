---
name: a2a-usage
description: Correct usage of ServiceNow's Agent-to-Agent (A2A) protocol — when to invoke an sn_aia agent via A2A and when not to, OAuth client-credentials provisioning, agent-card requirements, and the authenticated smoke that proves exposure. Use when exposing an agent externally, invoking/testing an agent outside its trigger, provisioning an external caller, or debugging A2A 401/403/empty-card failures.
---

# A2A usage — invoke and expose sn_aia agents correctly

Two endpoints make up the A2A surface on the connected instance:

| Purpose | Endpoint |
|---|---|
| Discovery (agent card, JSON) | `GET /api/sn_aia/a2a/v2/agent_card/id/<agent_sys_id>` |
| Invocation (JSON-RPC `message/send`) | `POST /api/sn_aia/a2a/v2/agent/id/<agent_sys_id>` |

Platform support starts at Zurich patch 4; A2A protocol version 0.3 (per the official docs — ground anything deeper via the `servicenow-docs` skill, publication `intelligent-experiences`). Exposure also requires the AI Agent Studio Settings toggle **Allow third party to access ServiceNow AI agents**.

The binding conventions live in [.claude/rules/a2a-exposure.md](../../rules/a2a-exposure.md) — read it before exposing anything. This skill is the how-to.

## Decision tree — is A2A the right tool?

**Use A2A for:**

- **Testing/debugging a built agent in isolation** — invoke it on demand without driving its production trigger. The tight verification loop is: A2A `message/send` → read the resulting `sn_aia_execution_plan` (match on the **Objective** field) → MCP `debug_agent_execution` for the trace. This is how `/verify` proves agent dispatch end-to-end.
- **Build-time orchestration** — a script or pipeline step that needs an agent's output during construction or verification.
- **External-caller integration** — a third-party agentic system consuming a ServiceNow agent as a secondary agent.

**Do NOT use A2A for:**

- **The production path of an agent with a live stall or regression** — exposing a stalling agent converts internal flakiness into external support noise. Fix or pivot the pipeline first; expose after.
- **Wrapping a direct-LLM Script Include as a fake agent** — that moves the stall a layer down and breaks usage-log attribution between pathways (see `.claude/rules/ai-agents.md`, "Direct-LLM pipelines").
- **Anything not yet proven by a full probe + authenticated smoke** — a card read alone proves nothing about invocation. See [reference/smoke.md](reference/smoke.md).

## Auth model — OAuth client-credentials + `a2aauthscope`

Basic auth returns 401 **by design**. The working chain (production-verified; not spelled out in the official docs):

1. Enable the inbound client-credentials grant property.
2. Create an `oauth_entity` (type=client, grant_type=client_credentials) bound to a **dedicated least-privilege service account** — the entity's user determines the issued token's roles.
3. Map the entity to the platform's `a2aauthscope` via **`oauth_entity_auth_scope_mapping`** — NOT the similarly named `oauth_entity_scope` table (known rabbit hole; mappings there do nothing for A2A).
4. Grant the service account `rest_service` + platform REST access.

Full idempotent recipe with field values, the async-callback registry step, and the revert path: [reference/provisioning.md](reference/provisioning.md).

Per-caller governance (from the rule, non-negotiable): **one OAuth entity per external caller**, scope exactly `a2aauthscope`, secrets out-of-band (env/`.env` per `scripts/lib/sn-creds.js` — never committed), and a per-caller usage-log bucket (`a2a_external_<caller>`) so operators can budget-gate by tenant.

A `requires_snc_internal_role` flag on the A2A endpoint is **not** a hard block — the OAuth + `a2aauthscope` path satisfies an alternate check. Don't flip platform-owned flags and never grant `snc_internal` to users chasing it.

## Agent-card requirements

Every exposed agent's card needs, before you call it externally consumable:

- A **description written for an external reader** — name the domain and the input/output shape; the card is the only thing a foreign orchestrator sees.
- Non-empty **card-level** `defaultInputModes` / `defaultOutputModes` (convention: `["application/json"]`).
- Non-empty **per-skill** `inputModes` / `outputModes` — note the field-name gotcha: skill-level arrays have **no `default` prefix**. Auditors checking `skills[].defaultInputModes` create phantom findings.
- **STOP CONDITIONS intact** in the agent's instructions — external callers are the most likely source of adversarial or malformed input (`.claude/rules/ai-agents.md`).
- Card `version` may be a **platform constant** (e.g. hard-coded `"1.0.0"`) regardless of `sn_aia_version` record state on some releases — verify before chasing version drift.

## Declaring an agent exposed — the gate

1. `npm run probe:full` — the `a2a.invocation_authenticated` capability must be `OK` (token mints).
2. Authenticated smoke round-trip lands PASS — [reference/smoke.md](reference/smoke.md). Card read alone is **not** sufficient.
3. Record the exposure in `.team/agent-findings/` with the card URL, OAuth entity name, and an example request.

Failures along the way: [reference/troubleshooting.md](reference/troubleshooting.md) (401 vs 403 vs empty card vs protocol-level errors).
