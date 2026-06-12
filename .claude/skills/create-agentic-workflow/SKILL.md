---
name: create-agentic-workflow
description: Build and verify an sn_aia AI agent (Now Assist AI Agents) on the connected ServiceNow instance — agent anatomy, script tools with matching input schemas, STOP CONDITIONS, published-version lifecycle, dispatch verification, A2A exposure. Use when asked to "create an AI agent", "build an agentic workflow", "add a tool to an agent", "expose an agent via A2A", or when an agent "won't dispatch", "stalls at ready", or dies with security_violation.
---

# Create an agentic workflow (sn_aia)

The law for this surface lives in [.claude/rules/ai-agents.md](../../rules/ai-agents.md) and [.claude/rules/ai-tools.md](../../rules/ai-tools.md) — read both before building. This skill is the build-and-verify recipe; full payloads in [reference/build-recipe.md](reference/build-recipe.md), A2A exposure in [reference/a2a-validation.md](reference/a2a-validation.md).

## 0. Gate

`getCapability('sn_aia.installed')` and `getCapability('sn_aia.agent_crud_available')` must each return `true` (always via `getCapability()`, never by reading the report JSON directly). The §3 trigger-free smoke additionally gates on `getCapability('sn_aia.external_agent_api_available')` — `false`/`unknown` fallbacks in build-recipe §4.

## 1. Agent anatomy — what actually lives where (live-verified)

| Concern | Where it lives |
|---|---|
| Name, description, **role**, base instructions, channel, agent_type, record_type | `sn_aia_agent` |
| **Versioned instructions** (what the runtime reads) | `sn_aia_version` (target_id = agent) |
| **run_as_user**, `public`, `specialist_enabled`, guest access | `sn_aia_agent_config` (auto-created with the agent) |
| Tool definition (script body + `input_schema`) | `sn_aia_tool` |
| Agent↔tool wiring (+ per-agent `inputs`, execution_mode, display flags) | `sn_aia_agent_tool_m2m` |

Three version-lifecycle facts that differ from what you'd guess:

1. Creating the agent **auto-creates a published V1** `sn_aia_version` row.
2. PATCHing `sn_aia_agent.instructions` **syncs into the current published version in place** — convenient while drafting, and exactly why the prompt-versioning rule forbids relying on it once any usage-log row references the version: an in-place sync silently rewrites audit history. Production prompt bumps follow the full rule: new version entry (published), prior retired, hash lockfile regenerated, attribution row seeded post-deploy.
3. Direct POSTs to `sn_aia_version` are **403-rejected** — the platform owns that table's inserts.

Give every agent a **STOP CONDITIONS** block (no platform tool-error retry policy exists; the block is the only brake) and an external-reader description. The build recipe carries a proven template.

## 2. Tools

`sn_aia_tool` script bodies follow the IIFE contract `(function(inputs){ ... return <string|object>; })(inputs);`. The `input_schema` JSON array (`[{name, description, mandatory}]`) must declare every key the body reads, and the m2m row's `inputs` field mirrors it — a mismatch makes the LLM invent argument names at runtime. Return the structured error shape from the ai-tools rule on failure.

## 3. Verify dispatch — never declare an agent done from saved records

Dispatch the agent for real and read the trace:

- **Trigger-free smoke** (no Studio Publish needed): `POST /api/sn_aia/agenticai/v1/agent/id/<agent_sys_id>` with `{request_id, inputs:[{content_type:"text", content:"<task>"}], metadata:{}}` — returns 200 + session_id, dispatches async. This is the platform's external-agent API; it exercises the same plan pipeline as production triggers. Gate on `getCapability('sn_aia.external_agent_api_available')` first — build-recipe §4 has the `false`/`unknown` fallbacks.
- Poll `sn_aia_execution_plan` (query by `agent=<sys_id>`): healthy = `state` reaches `completed` with empty `state_reason`. `security_violation` = identity problem (check `sn_aia_agent_config.run_as_user` and the access-verification task output). Stuck at `ready` with `sys_mod_count=0` = inserted off-pipeline (see the dispatch-fingerprint rule).
- `debug_agent_execution(<plan sys_id>)`: assert the Access Verification task shows `isAccessAllowed=true` for agent AND each tool, the ReAct step planned your tool with the right arguments, and the tool execution row is `Success` with your structured payload.
- Fingerprint nuance (live-verified): API-path plans carry `conversation`, `derived_scope`, `metadata` but NOT `test_version` — that fourth field is populated by Studio test runs only.

## 4. Known traps (all live-verified)

- **Agent card 400 "No agent available for your query"** on A2A discovery = `sn_aia_agent_config` gating, not a missing agent: set `public=true` (+ `specialist_enabled=true`) on the config row.
- The **default `context_processing_script`** template shipped on new agents throws a Rhino `InternalError` (optional-chaining on some builds) — dispatch survives, but it pollutes every trace. Replace or simplify it when traces matter.
- **Cleanup cascade is partial**: deleting the agent cascades version/config/m2m/plans, but **orphans** the `sn_aia_tool` row, `sn_aia_execution_task`, `sn_aia_message`, and `sn_aia_tools_execution` rows — delete those explicitly. `sys_cs_conversation` header rows resist deletion entirely (platform-protected; even global-scope `setWorkflow(false)` rolls back).
- Deterministic multi-agent sequences belong in a state-machine BR or flow, not in an orchestrator prompt; trigger conditions use `CHANGESTO` — both per the ai-agents rule.
