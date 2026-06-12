# 2026-06-12 — A2A card surface dark: exposure is per-agent, and zero agents are exposed

## Symptom

New `a2a.card_readable` probe reports NO: `GET /api/sn_aia/a2a/v2/agent_card/id/<sys_id>` returns
`400 {"error":{"message":"No agent available for your query."}}` with a freshly minted, valid client-credentials Bearer token (`a2a.invocation_authenticated` = OK).

## Hypotheses falsified

- **Agent selection artifact** (probe picks the first `sn_aia_agent` row, unfiltered): tried 10 different agents, all OOTB with published versions — identical 400 for every one. Not selection.
- **Instance-wide toggle property off**: `sn_aia.external_agents.enabled` = `true` (since 2025-10), and the endpoint's `ExternalAgentConfigurationDao.isExternalAgentEnabled()` gate demonstrably passes — a failed gate returns 500 "not supported", and we get 400 from inside `AIAgentDiscoveryA2AUtil.getAgentCardById` (Script Include source is protected; behaviour established from the REST operation script + response shape).
- **Missing published version**: the probed agent has `sn_aia_version` v1 `state=published`.

## Verified mechanism

A2A discovery exposure is **per-agent**, materialized as rows in the `sn_aia_external_agent_*` tables. On this instance:

| Table | Rows |
|---|---|
| `sn_aia_external_agent_configuration` | 0 |
| `sn_aia_external_agent_card` | 0 |
| `sn_aia_external_agent_discovery` | 0 |
| `sn_aia_external_agent_protocol` | 2 (platform seed) |
| `sn_aia_external_agent_provider` | 3 (platform seed) |

`sn_aia_agent.external_agent_configuration` (reference to the configuration table) is empty on **all** agents. Nothing has ever been exposed; the discovery endpoint correctly answers "No agent available" for every sys_id. The probe's NO is a **true reading of instance state**, exactly the token-mints-but-card-dark gap it was built to catch.

## Decision

No instance-side change made. Exposing an agent is a governance step (pick the agent, provision per-caller OAuth entity, usage bucket — see `.claude/rules/a2a-exposure.md` and the `a2a-usage` skill), owned by Wave 3 when a project agent exists; hand-inserting exposure rows for an OOTB agent on a shared sandbox (with another operator actively exercising the A2A invocation surface today) would create config noise to make a probe green — backwards.

The probe's failure hint now names the mechanism (zero `sn_aia_external_agent_configuration` rows = nothing exposed) instead of only pointing at the Studio toggle.

## Retire-when

`a2a.card_readable` flips OK on its own once the first agent is legitimately exposed through AI Agent Studio (Settings → third-party access toggle + per-agent configuration). Expected during Wave 3 A2A exposure work.
