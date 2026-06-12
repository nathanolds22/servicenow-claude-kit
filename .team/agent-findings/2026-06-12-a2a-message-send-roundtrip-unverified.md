# 2026-06-12 — A2A `message/send` round-trip: documented, not yet executed PASS

## Status of the kit's own A2A validation

The Wave 2 build of the `create-agentic-workflow` and `a2a-usage` recipes live-verified the A2A chain **up to the protocol boundary**, on a real instance, with a freshly built sentinel agent:

| Step | Live-verified? | Evidence shape |
|---|---|---|
| OAuth client-credentials token mint (`a2aauthscope`) | ✅ | 200 + `access_token`, probe `a2a.invocation_authenticated` |
| Agent-card discovery after config-row exposure flip | ✅ | 400 → 200 on `public=true` + `specialist_enabled=true` |
| JSON-RPC error contract on the invocation endpoint | ✅ | `-32600` plain JSON, `-32601` `message/stream`, `-32602` no push config (incl. `blocking:true` ignored), `-32003` unregistered URL |
| **`message/send` → `submitted` → `tasks/get` → terminal state** | ❌ **never executed** | — |

## Why the final step was not executed

The platform requires a pre-registered `sn_aia_external_agent_callback_registry` row (`state=verified`, URL matching the inline `pushNotificationConfig.url`) for **every** async A2A invocation, and on current families the pipeline is async-only. Two independent blocks:

1. Registry rows are **shared instance configuration** — inserting one auto-creates a connection/credential alias for the platform's outbound POSTs. That is an operator-governance step (one row per external caller, agreed with the instance owner), not a sentinel write a build session should make unilaterally. The session's permission layer denied it for exactly this reason, including a `KIT_PROBE_*`-named row and reuse of another tenant's existing callback URL (cross-tenant data concern).
2. A meaningful PASS needs a **caller-owned reachable endpoint** to receive the platform's callback POST — none exists in the kit's build context.

## What this means for kit users

The registry-matched success row in `create-agentic-workflow/reference/a2a-validation.md` §3 and the Stage 3 PASS → Stage 4 verification path in `a2a-usage/reference/smoke.md` are assembled from live-verified error signatures plus platform documentation — they have **not** been proven end-to-end by this kit. Treat the full round-trip as a recipe to execute on your instance, not a guarantee: run the five-stage smoke with your own operator-approved registry row before declaring any agent A2A-callable.

Everything *before* that step (provisioning, card requirements, auth chain, error taxonomy) is live-verified and safe to rely on.

## Retire-when

A full smoke lands Stage 3 PASS + Stage 4 plan/attribution evidence on a live instance (operator pre-creates or approves the callback registry row; recipe in `a2a-validation.md` §3 and `smoke.md`). When that happens, record the run in this directory and delete the caveat notes that link here.
