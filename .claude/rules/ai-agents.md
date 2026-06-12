# Rules: AI agents (sn_aia)

Applies to: any sn_aia agent, team, workflow, or trigger configuration this project authors — via MCP `create_ai_agent`/`create_trigger_config` tools, or via Fluent `AiAgent(...)` blocks when the project has adopted the SDK.

## Lookups by sys_id, never by name

Agent and team names are not unique across scopes — a legacy global-scope record with the same name as your in-scope record makes any `addQuery('name', …)` a coin flip. Record canonical sys_ids in CLAUDE.md Coordinates the day an agent is created, and use them everywhere.

## When adding a new agent

1. Declare explicit `run_as` identity, security ACL, channel, one published version, and explicit role/type. Never rely on the trigger's `run_as` default — on several releases it points at a field that may not exist on your table, and dispatch dies with `security_violation`.
2. Give it a **STOP CONDITIONS** block (see below).
3. If it can be dispatched standalone with bare input (Studio "Test Agent"), give it a step-0 self-heal that resolves missing context via a tool, or it will hard-stop on bare-sys_id input.
4. Prove dispatch end-to-end before calling it done: a clean execution plan trace (`debug_agent_execution`), not a saved record.

## Stop conditions are load-bearing

The platform has no explicit tool-error retry policy; the STOP CONDITIONS block in the agent's instructions is what prevents tool-failure loops and is the first defence against adversarial/malformed input (especially for A2A-exposed agents). Never soften one without checking which failure mode it was added for. Run a stop-condition presence check as part of any prompt-bump gate.

## Prompt versioning is non-negotiable

- Every change to a published instruction set = new version entry (published), prior entry retired, hash lockfile regenerated, attribution row seeded post-deploy.
- Never edit a published version in place once any usage-log row references it — version history is load-bearing for audit.

## Deterministic sequencing lives in code, not in the orchestrator prompt

When agent order is deterministic, enforce it with a state-machine BR / flow / switch — an LLM orchestrator can paraphrase, re-order, or fall back. Trigger conditions use `CHANGESTO` (not equality) or in-stage updates re-fire the trigger and produce duplicate plans.

## Objective shaping

- `contextProcessingScript` can only enrich `plan.context`; it **cannot** mutate `plan.objective` — and the orchestrator reads the objective.
- Trigger paths: use the trigger's objective template (field substitution on the source record).
- Studio-Test / manual / API paths: use a cross-scope before-insert BR on `sn_aia_execution_plan`. Gate it on an OR across `usecase`, `team`, AND `agent` — Studio single-agent tests populate only `agent`.

## Cross-scope BR realities (verified on recent releases)

- A BR declared in your scope targeting an `sn_aia_*` table executes in the **target** scope: your Script Includes are unresolvable there — inline the logic; only platform-global APIs (`GlideRecord`, `gs`, `JSON`) work.
- Cross-scope `setAbortAction(true)` and `throw` can be **silently swallowed** — the insert succeeds anyway. Workaround: mutate `current` to a state the downstream consumer skips (e.g. `state='cancelled'` + a reason). Same-scope BRs abort normally.

## Dispatch stall diagnostics

- **Four-field fingerprint**: a plan that reached an orchestrator carries `conversation`, `derived_scope`, `metadata`, `test_version`. A plan missing any was inserted off-pipeline and will sit at `state=ready` with `sys_mod_count=0` forever. First check on any stall. Scope caveat (live-verified): plans dispatched via the external-agent API (`/api/sn_aia/agenticai/v1/...`) legitimately omit `test_version` and still complete — judge API-path plans on the remaining three fields.
- Direct Table-API POSTs to `sn_aia_execution_plan` no-op silently — they're not a dispatch path.
- `sn_aia_execution_plan` has no `trigger_record` field on recent releases — use `related_task_record` + `related_task_table`; the "Insufficient rights" error querying the old field is a missing-column symptom, not ACL.
- Studio Publish wipes trigger `run_as` — reconcile after every wizard run.

## Direct-LLM (non-agent) pipelines

If a platform regression forces a stage out of sn_aia into a direct-LLM Script Include: keep a separate usage/cost bucket per pathway (`<service>_direct` vs `<service>`), select the path via a property so rollback is a flip not a redeploy, keep the agent's version entry as the documented prompt anchor, and write down the retire-when condition (a capability probe flipping back). Don't wrap the SI in a fake agent — it breaks attribution and moves the stall.
