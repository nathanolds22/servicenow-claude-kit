# LESSONS — instance-independent ServiceNow gotchas

Hard-won, production-verified platform behaviours. Each cost real debugging time on a live project. Read before building; add new entries (dated, one bullet each) when a `/team_review` or incident reveals a reusable trap. Project-specific narratives go in `agent-findings/`, not here.

## Auth, users, roles

1. **Password hashing**: only `gr.user_password.setDisplayValue('plain')` inside server script hashes; `setValue` or Table API PATCH stores plaintext. Changing **another** user's password additionally needs `security_admin` elevation — a generic "Error during update of sys_user" with admin-but-not-security_admin is this.
2. **Role cache after a grant**: after inserting `sys_user_has_role`, touch the `sys_user` row (any update) to flush the role cache before REST calls honour the new role.
3. **Restrict-basic-auth**: users need a `sys_user_basic_auth_exception` row with `decision=global` (NOT `grant`) for basic-auth REST; mirror a known-working row. The exceptions table itself is ACL-protected (admin REST → 403; sandboxed script → silent null) — insert via Background Scripts context.

## Table API and metadata writes

4. **`ws_access=0` blocks the Table API** with "Failed API level ACL Validation" — check it before debugging ACLs.
5. **`sys_db_object.read_only` doesn't persist via PATCH** — the persistent location is the table-scoped `sys_dictionary` row (`name=<table>^elementISEMPTY`).
6. **Sandboxed script execution silently drops `sys_*` metadata writes** (e.g. `sys_dictionary`) — no error, no effect. Use admin-basic-auth Table API PATCH for metadata edits, and probe which scope your script executor actually runs in.
7. **Some tables silently roll back scripted writes entirely** (e.g. `sys_ui_bookmark` via a bridged session: `insert()` returns null, `deleteRecord()` rolls back, no error). Direct admin-basic-auth REST works. When a scripted write "succeeds" but the row isn't there, switch transports before debugging logic.
8. **Platform-minted sys_ids**: `sys_security_acl`, `sys_security_acl_role`, and `sn_aia_version` ignore caller-supplied sys_ids on insert. Declared IDs are anchors only; reconcile live state by natural key and design deployers to remap references.
9. **Every new domain table needs explicit ACLs in source** — default inheritance leaves it world-readable to any authenticated user via the Table API. The single most recurring security finding.
21. **(2026-06-12) A Table-API 403 "Operation Failed / Error during insert" can be a unique-index collision, not ACL** — e.g. `sn_aia_agent.internal_name` (`scope.scope.name`) is DB-unique, so one leftover same-name row makes every subsequent insert 403. Read the `syslog` `FAILED TRYING TO EXECUTE` row for the underlying `BatchUpdateException` before debugging security; any process writing fixed-name sentinel rows must pre-clean strays (a kill between insert and delete orphans them).

## Scoped-app sandbox

10. **GlideAggregate COUNT/SUM can silently cap (~1k rows) inside a scoped app** while the same query in global scope returns the true total. `GlideRecord.getRowCount()` + iteration are unaffected. Never let a scoped aggregate feed a budget cap or compliance number; re-test on each upgrade.
11. **Cross-scope BRs execute in the target table's scope** — your scope's Script Includes are unresolvable there (inline the logic; only `GlideRecord`/`gs`/`JSON` work), and cross-scope `setAbortAction(true)`/`throw` can be silently swallowed (mutate `current` to a non-consumable state instead).
12. **Scoped metadata inserts can be sandbox-blocked even with cross-scope create privilege** (`sys_trigger`, `sysevent_register`, `gs.eventQueue` from app scope) — scheduler-context jobs are the fallback dispatch path.

## sn_aia / AI agents

13. **`sn_aia_execution_plan` has no `trigger_record` field on recent releases** — use `related_task_record` + `related_task_table`. The misleading "Insufficient rights to query records" is a missing-column symptom.
14. **Trigger `run_as` is fragile**: it defaults to a field that may not exist on your table (dispatch dies with `security_violation`), and Studio Publish wipes it on every wizard run — declare it explicitly and reconcile after each publish.
15. **Trigger-config REST updates can deactivate the bound flow** (async regen BRs set `active=0/draft` → dispatch silently breaks). Route updates through `setWorkflow(false)`; new trigger INSERTs need one manual Studio Publish.
16. **Dispatch fingerprint**: a plan that truly entered the dispatch pipeline carries `conversation`, `derived_scope`, `metadata`, `test_version`. A plan missing any was inserted off-pipeline and sits at `state=ready` forever — first stall diagnostic. Direct Table-API POSTs to the plan table no-op silently.

## UI

17. **Jelly UI pages are XML, not HTML** — a tag-shaped token anywhere in the html field (even inside a CSS comment) breaks compilation and the platform silently blanks the whole page. Validate the XML before deploying.
18. **Server-built HTML surfaced to a browser is a stored-XSS surface** — escape every DB-sourced interpolation, including enum-constrained fields (drift breaks the assumption). Client-side, render untrusted strings via `.textContent`, never `innerHTML`.

## Deploy paths

19. **`now-sdk install` can be broken on a given release family** (upload-processor incompatibility) — capability-probe it; the fallback is a REST walk of the built update XML with a post-deploy parity verifier. Never assume the SDK path works because docs say so.
20. **BR names truncate at 40 chars in `sys_script.name`** — two names identical in the first 40 collide on natural-key reconciliation and renames silently no-op. Keep BR names ≤40 and unique within the truncation window.
