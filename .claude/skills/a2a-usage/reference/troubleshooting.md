# A2A troubleshooting — symptom → cause → fix

Work top-down: discovery failures and auth failures look similar from a caller's seat but have disjoint causes. Statuses below are from production debugging on Zurich/Australia-family instances; re-verify on a new release family before trusting an exotic one.

## Token mint (`POST /oauth_token.do`)

| Symptom | Likely cause | Fix |
|---|---|---|
| 401 / `access_denied` or `unsupported_grant_type` | inbound client-credentials grant property missing or `false` | provisioning step 1 |
| 401 / `invalid_client` | wrong client_id/secret, or entity `active=false` | re-read creds from the entity; check `active` |
| 200 but token lacks the scope (later 403s) | mapping row in `oauth_entity_scope` instead of `oauth_entity_auth_scope_mapping` | provisioning step 3 — the known rabbit hole |
| mint works for one caller, fails for another | callers sharing an entity, secret rotated by one of them | one entity per caller, always |

## Agent card (`GET /api/sn_aia/a2a/v2/agent_card/id/<sys_id>`)

| Symptom | Likely cause | Fix |
|---|---|---|
| 401 with basic auth | by design — the surface wants OAuth | mint a token; don't debug ACLs |
| 400 `"No agent available for your query"` | platform-side exclusion of this agent from the A2A surface (not auth): agent inactive, no published version, or not discoverable | check `sn_aia_agent.active`, a published version exists, and the Studio Settings toggle **Allow third party to access ServiceNow AI agents** |
| 404 | wrong sys_id (name-based lookup picked a same-named agent in another scope) or wrong endpoint path | use the canonical sys_id from CLAUDE.md Coordinates; never look up by name |
| 200 but card is sparse/empty fields | card metadata gaps on the agent | fill description + mode arrays per SKILL.md card requirements |
| card `version` doesn't match `sn_aia_version` records | platform constant (e.g. hard-coded `"1.0.0"`) on some releases | not drift; don't chase it through `sn_aia_version` |
| auditor reports missing `skills[].defaultInputModes` | phantom finding — skill-level field names have **no** `default` prefix | check `skills[].inputModes` / `skills[].outputModes` |

## Invocation (`POST /api/sn_aia/a2a/v2/agent/id/<sys_id>`)

| Symptom | Likely cause | Fix |
|---|---|---|
| 401 | missing/expired Bearer token | re-mint; tokens default to 3600s lifespan |
| 403 | token minted without `a2aauthscope` (wrong mapping table), or entity user missing `rest_service`/platform REST role | provisioning steps 3–4; touch the user row after role grants |
| `requires_snc_internal_role` observed on the endpoint | NOT a hard block — OAuth + `a2aauthscope` satisfies an alternate check | do nothing; never grant `snc_internal` |
| JSON-RPC `-32003 Push Notification is not supported` | `pushNotificationConfig.url` not registered/verified in `sn_aia_external_agent_callback_registry` | provisioning step 5; the URL must match the registry row exactly |
| 2xx accepted but no callback ever arrives | callback URL short-name mismatch (platform derives the scoped path from `sys_package`, not your scope name), or registry row not `verified` | read the working path off a live request; verify the row |
| 2xx accepted but agent hard-stops immediately | bare input hit an agent with no step-0 self-heal | `.claude/rules/ai-agents.md` — standalone-dispatchable agents need a step-0 context resolver |
| non-2xx that is not 401/403 | payload/protocol error — auth is fine | fix the JSON-RPC envelope; don't re-debug provisioning |

## Plan created but nothing happens

The invocation can be accepted (2xx) and still stall downstream. That's a dispatch problem, not an A2A problem — switch playbooks:

- Four-field fingerprint on the plan (`conversation`, `derived_scope`, `metadata`, `test_version`) — a plan missing any was inserted off-pipeline and sits at `state=ready` forever (`.claude/rules/ai-agents.md`, dispatch stall diagnostics).
- `debug_agent_execution` for the trace; check trigger `run_as` and stop conditions.
- If the agent stalls reproducibly: do **not** keep it exposed while you debug — that's the "do NOT use A2A for" case in SKILL.md.
