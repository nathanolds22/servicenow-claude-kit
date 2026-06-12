# /deploy — Capability-Aware Deploy of Fluent Build Artifacts

**Applies only when the project has adopted the Fluent SDK** (`now.config.json` exists — see [.claude/rules/fluent-metadata.md](../rules/fluent-metadata.md)). Deploys source-controlled metadata to the instance via the path the capability report proves works, then verifies parity by read-back.

Arguments: `$ARGUMENTS` — optional:
- `--dry-run` — print the classified plan; apply nothing.
- `--force-rest` — ignore the capability report; use the REST-bypass path (safe escape hatch).

## 0. Fluent gate

```bash
test -f now.config.json || echo "NOT A FLUENT PROJECT"
```

If `now.config.json` is absent → **STOP**: this project is MCP-first. Artifacts are built via MCP power tools and verified with `/verify` — there is no build output to deploy. Read [.claude/rules/fluent-metadata.md](../rules/fluent-metadata.md) before adopting the SDK.

## 1. Pre-flight

- **Capability report fresh** (`npm run probe:summary` — no `[STALE]`). Stale → run `/capability_probe` first.
- **Working tree clean** (`git status --porcelain`). Dirty → **STOP**: commit or stash; a deploy must be attributable to a commit.
- **Green build**: `npx now-sdk build`. The readiness scan ($id uniqueness, reference resolution, enum correctness) is the pre-deploy contract — nothing deploys from a red build.
- Quality gate: `bash scripts/quality-gate.sh`.

## 2. Deploy-path selection — positive evidence only

Branch via `getCapability()` on the project's SDK-install capability (probe class `sdk_install.*`, e.g. `sdk_install.upload_processor_works`):

| Capability | Path |
|---|---|
| `true` (fresh, positive evidence) | `npx now-sdk install` — the supported path |
| `false`, `unknown`, `n/a`, stale, or `--force-rest` | REST-bypass: walk the built update XML (`dist/app/update/*.xml`) and upsert each record via admin-basic-auth Table API |

**Never take the SDK path on `unknown`** — `now-sdk install` can be broken per release family (upload-processor incompatibility, LESSONS #19); the safe default for unknown is the previous-behaviour path. If neither path has ever been probed on this instance, add the probe first (`.claude/rules/capability-report.md`).

REST-bypass pattern (implement once as a project script, keep it idempotent):
- GET by sys_id → PATCH if exists, POST if new. Stable `$id`s make re-runs no-op upserts.
- Platform-minted-sys_id tables (`sys_security_acl`, `sys_security_acl_role`, `sn_aia_version`) reconcile by **natural key**, never by declared sys_id (LESSONS #8).
- `sn_aia_trigger_configuration` UPDATEs route through `setWorkflow(false)` — REST updates can silently deactivate the bound flow (LESSONS #15).

## 3. Class ordering — dependencies before dependents

Apply classes in this order, stopping on the first failure:

1. **Script includes** (shared code other artifacts call)
2. **Tables** (+ their co-located ACLs)
3. **Properties**
4. **Scheduled jobs**
5. **Tool scripts** (AI-agent tools — their schemas must land with the body)
6. Remaining surfaces (business rules, agents, REST APIs, UI) in dependency order

A class out of order produces silent half-states (a BR referencing an undeployed SI compiles but dies at runtime; an agent tool whose m2m `inputs[]` schema lands without the body invents argument names — `.claude/rules/ai-tools.md`).

## 4. Post-deploy verification — read-back, not exit code

For every deployed artifact: read it back via Table API / MCP `get_*` and assert the load-bearing fields match source (`/verify` discipline). Additionally:

- **Parity check** after an SDK-path deploy — the SDK has had serialization bugs that mangle specific fields per release family; diff live values against source for the fields your app depends on.
- **Trigger/flow health** if any trigger configuration was touched: bound flow `active=true, status=published` (LESSONS #15) — new trigger INSERTs still need one manual Studio Publish.
- **Dictionary attributes** declared in source sync via admin-basic-auth `sys_dictionary` PATCH, gated on `table_api.sys_dictionary_writable` (script-path writes silently no-op — LESSONS #6).
- **Prompt versions** if agent instructions changed: new published version entry, prior retired, hash lockfile regenerated (`.claude/rules/ai-agents.md`).

## 5. Properties are re-applied from source — runtime flips revert

Every deploy re-applies `properties` from source, **reverting any runtime property flip** an operator made on the instance (kill switches, dispatch-path selectors, circuit states). This is by design — source is truth. The permanent-change path is: change the value in Fluent source → `/deploy`. Before deploying, check whether any deliberate runtime flip is live (incident response in progress?) and either fold it into source or hold the deploy.

## 6. Summary

Report: classes applied (counts), records touched, deploy path taken (+ which capability drove it), parity result, anything that could NOT be verified (a blocker, not a caveat). On failure: the failing class, the specific REST call (status + body), and the rollback option (re-deploy the parent commit's build output).
