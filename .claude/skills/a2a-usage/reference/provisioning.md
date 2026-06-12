# A2A OAuth provisioning — idempotent walkthrough

Provision OAuth client-credentials access for one external caller of the A2A surface. Every step is an idempotent upsert (query first, insert/update only when needed) so the whole recipe is safe to re-run and safe to script. Run it via MCP `execute_script` (probe `execute_script.available` first) or hand-apply via the platform UI.

Scope discipline: one run of this recipe = one external caller. A second caller gets its own entity (steps 2–3 repeated with a new name), never a shared client_id/secret — the per-entity audit trail is the governance story.

## Step 1 — enable the inbound client-credentials grant

`sys_properties` row:

| Field | Value |
|---|---|
| `name` | `glide.oauth.inbound.client.credential.grant_type.enabled` |
| `value` | `true` |
| `type` | `true\|false` |

Upsert: if the row exists with `value=true`, no-op; if it exists with another value, update; else insert. Without this property, token mints fail with `unsupported_grant_type` / `access_denied` regardless of entity configuration.

## Step 2 — the OAuth entity

`oauth_entity` record, bound to a **dedicated service account** (create one per caller if needed — never a human operator; the entity's user determines the issued token's roles, so least privilege lives here):

| Field | Value |
|---|---|
| `name` | `<Project> A2A <Caller>` (one per caller) |
| `type` | `client` |
| `active` | `true` |
| `default_grant_type` / `inbound_grant_type` | `client_credentials` |
| `public_client` | `false` |
| `token_format` | `opaque` |
| `access_token_lifespan` | `3600` |
| `send_client_credentials_as` | `request_body_parameter` |
| `sub_claim` | `sys_id` |
| `user` | `<service account sys_id>` |
| `sys_scope` | `global` |

On insert the platform mints `client_id` and an encrypted `client_secret`. On re-run, reconcile `user` + grant type rather than recreating.

**Secrets out-of-band — and never through the session transcript.** Anything a provisioning script returns or prints lands in session logs and gets pasted into findings, so: decrypt the secret (`GlideEncrypter().decrypt(...)`, server-side only) and have the script deliver it directly to the machine-local credential layer, returning only a confirmation shape (`{ stored: true, key: 'A2A_OAUTH_CLIENT_SECRET', length: <n> }`) — never the decrypted value itself. Storage layers: env, gitignored `.env`, or `~/.claude.json` `mcpServers.<name>.env` as `A2A_OAUTH_CLIENT_ID` / `A2A_OAUTH_CLIENT_SECRET` (the layering in `scripts/lib/sn-creds.js`). Never commit them.

## Step 3 — scope mapping (the rabbit hole)

Map the entity to the platform-provided `a2aauthscope` auth scope via **`oauth_entity_auth_scope_mapping`**:

| Field | Value |
|---|---|
| `oauth_entity` | `<entity sys_id from step 2>` |
| `auth_scope` | `<sys_auth_scope row where name=a2aauthscope>` |

Resolve the scope by querying `sys_auth_scope` for `name=a2aauthscope` — don't hardcode its sys_id. Two traps:

- **Wrong table**: `oauth_entity_scope` looks right and accepts rows, but A2A token issuance only consults `oauth_entity_auth_scope_mapping`. Mappings in the wrong table produce tokens without the scope → 403 on invocation.
- **Scope exactly `a2aauthscope`** — nothing broader. Don't map additional scopes onto an A2A caller's entity.

## Step 4 — roles for the service account

Grant the entity's user `rest_service` and the platform REST access role (`snc_platform_rest_api_access`). Then **touch the `sys_user` row** (any same-value update) — role grants don't take effect for REST until the role cache flushes (LESSONS #2).

A `requires_snc_internal_role` flag observed on the A2A endpoint is NOT a hard block: the OAuth + `a2aauthscope` path satisfies an alternate check. Never grant `snc_internal` to a service account chasing that flag, and don't flip platform-owned endpoint flags.

## Step 5 (async callers only) — callback registry

If the caller uses asynchronous `message/send` (`configuration.blocking: false` with a `pushNotificationConfig.url`), the platform cross-checks the inline URL against the **External Agent Callback Registries** table `sn_aia_external_agent_callback_registry`. An unregistered URL fails with JSON-RPC error `-32003 Push Notification is not supported`.

- Insert a row with the exact callback `url`, then verify it. The UI's **Verify URL** button actually confirms reachability; scripting `state=verified` directly skips that confirmation — acceptable only for a callback endpoint you own and have independently proven reachable, and say so in the exposure finding. The registered URL should be an external HTTPS endpoint you control — the platform makes outbound requests to it.
- Gotcha: a scoped-app callback endpoint's URL short-name is **platform-derived** (from `sys_package` vs `sys_scope.scope`, not customer-controllable) — read the working path off a live request rather than assuming it matches your scope name.
- Caller attribution: `pushNotificationConfig.token` is forwarded verbatim as the `X-A2A-Notification-Token` header on the callback — it is the only channel that survives platform-side URL sanitisation (query strings are stripped). Use it to carry the caller identifier into your per-caller usage bucket.

## Verify, then declare

Run `npm run probe:full` — `a2a.invocation_authenticated` flips to `OK` when the token mints. That probes auth only: a fresh token is necessary but **not sufficient**. Complete the full smoke ([smoke.md](smoke.md), Stages 0–4) before recording the exposure in `.team/agent-findings/`.

## Revert

Deleting in reverse order is safe and idempotent: scope mapping(s) → oauth_entity → the grant property (only if nothing else on the instance uses inbound client-credentials) → callback registry row. Deliberately do NOT revoke `rest_service` / platform REST roles from a shared service account — other integrations may rely on them; revoke only when the account exists solely for this caller. Clear the stashed client creds from the machine-local layer.
