# Rules: Fluent SDK metadata (applies WHEN the project has adopted the Fluent SDK)

Applies to: `src/fluent/*.now.ts` files, once `npm run init:fluent` (or manual SDK setup) has been done. An MCP-first project without `now.config.json` can ignore this file until then — but read it BEFORE adopting the SDK.

## `$id` is a contract, not a cosmetic

Every `$id: Now.ID['...']` key becomes the sys_id of the deployed record. Renaming or deleting a key on a deployed artifact orphans the live record: references break silently and the next deploy mints a NEW record. Don't rename keys; if you must, script the rename on the instance too.

**Known platform exceptions** (the instance mints fresh sys_ids regardless of the declared value):
- `sys_security_acl` / `sys_security_acl_role` — override-path inserts discard `sys_id`. Natural-key identity is `(table, operation, name)` / `(acl, role)`.
- `sn_aia_version` — a before-insert BR mints sys_ids and can non-deterministically flip `state`. Natural key `(target_id, target_table, version_number)`.

For these, the Fluent `$id` stays the declarative anchor; live reconciliation goes by natural key. Expect drift, design deployers to remap.

## Every application table ships with explicit ACLs in source

Default ACL inheritance leaves a new table world-readable to any authenticated user via the Table API. Rule: each new table declares read (audience role) + create/write/delete (admin) ACLs co-located in source, deployed with the table. CI/service accounts get extra role wires, never a broadened base ACL.

## The build is the pre-deploy gate

`now-sdk build`'s readiness scan ($id uniqueness, reference resolution, enum correctness) is a contract check, not advisory. Nothing deploys from a red build.

## Don't hand-patch deployed artifacts

Anything declared in Fluent is updated ONLY by rebuild + redeploy. If a live record drifts (someone edited in the platform UI), reconcile by updating source or overwriting live from source — never leave them diverged. If the SDK install path is broken on your instance (probe it — `sdk_install.*` capabilities), the fallback is a REST walk of `dist/app/update/*.xml`, capability-gated, with a post-deploy parity verifier.

## Trigger-configuration deploys can break bound flows

On some release families, REST updates to `sn_aia_trigger_configuration` fire async BRs that regenerate the bound flow AND deactivate it (`active=0`, `status=draft`) — dispatch silently breaks until a manual Studio Publish. Route UPDATEs through `setWorkflow(false)`; INSERTs of brand-new triggers still need one manual Studio Publish to bind a flow. Probe flow health (`active=true, status=published`) after every deploy that touches triggers.

## Dictionary changes

Prefer declaring dictionary attributes in source and syncing post-deploy via admin-basic-auth Table API PATCH on `sys_dictionary` (the Table API runs through normal ACL evaluation, not the scoped script sandbox — script-path `sys_dictionary` writes silently no-op when sandboxed). Gate the sync on the `table_api.sys_dictionary_writable` capability.

## Fluent source grammar restrictions

No multi-line string concatenation with `+`; no imports outside the SDK packages; no runtime-computed `$id`s. Collapse literals to single lines; share helpers via sibling `.now.ts` files.

## Keep BR names ≤40 chars and unique within the first 40

`sys_script.name` silently truncates at 40 characters. Two BRs whose names collide in the first 40 chars become indistinguishable on `(name, collection)` — natural-key reconciliation breaks and renames silently no-op. There is no build-time warning.
