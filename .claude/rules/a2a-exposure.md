# Rules: A2A exposure (agents callable via the Agent-to-Agent protocol)

Applies to: exposing any sn_aia agent via the A2A endpoints (`/api/sn_aia/a2a/v2/agent/id/<agent_id>` invocation, `/api/sn_aia/a2a/v2/agent_card/id/<agent_id>` discovery).

## When A2A is the right tool — and when it isn't

**Use A2A for:** invoking a built agent on demand from outside its trigger — testing/debugging an agent in isolation, build-time orchestration, external-caller integration. A2A + `debug_agent_execution` + the execution-plan read is the tight loop for agent verification.

**Do NOT use A2A for:**
- the production path of an agent with a live stall/regression — exposing a stalling agent converts internal flakiness into external support noise. Fix or pivot first.
- wrapping a direct-LLM Script Include as a fake agent — that moves the stall a layer down and breaks usage-log attribution between pathways.
- anything not yet proven by a full probe + smoke (below).

## Auth is OAuth client-credentials + `a2aauthscope`

Basic auth returns 401 — by design. Provisioning (4 steps, scriptable): enable the inbound client-credentials property → create an `oauth_entity` bound to an integration user → map it to the platform's `a2aauthscope` via `oauth_entity_auth_scope_mapping` (NOT `oauth_entity_scope` — known rabbit hole) → grant `rest_service` + platform REST access to that user.

Per new external caller:
- **One OAuth entity per caller** — never share client_id/secret across tenants (governance audit trail).
- **Scope exactly `a2aauthscope`** — nothing broader.
- **Dedicated service account** as the entity's user — the entity's user determines the issued token's roles; least privilege, never a human operator.
- **Secrets out-of-band** — never committed; locally they live in env/.env per the creds module.
- **Log every invocation** to a per-caller usage bucket (`a2a_external_<caller>`) so operators can budget-gate by tenant.

A `requires_snc_internal_role` flag on the A2A endpoint is NOT a hard block — the OAuth + a2aauthscope path satisfies an alternate check. Don't flip platform-owned flags and don't grant `snc_internal` to users chasing it.

## Agent-card discovery metadata

Every exposed agent's card needs: a description written for an external reader (name the domain and I/O shape); non-empty card-level `defaultInputModes`/`defaultOutputModes` (convention `["application/json"]`); non-empty per-skill `inputModes`/`outputModes` (note: skill-level names have NO `default` prefix — auditors checking `skills[].defaultInputModes` create phantom findings); STOP CONDITIONS intact in the instructions — external callers are the most likely source of adversarial input.

Card `version` may be a platform constant (e.g. hard-coded `"1.0.0"`) regardless of version-record state on some releases — verify before chasing version drift through `sn_aia_version`.

## Probe + smoke before declaring exposed

1. Capability probe confirms the agent card is accessible and auth mints a token (`a2a.invocation_authenticated`).
2. A live authenticated invocation round-trip lands PASS — never declare an agent callable from a card read alone.
3. Record the exposure in `.team/agent-findings/` with card URL, OAuth entity, and an example request.
