# /verify — Definition of Done for an Instance-Affecting Change

Generic verification gate: run after building anything (record, metadata, agent, dashboard, catalog item, flow change) and before declaring it done. "Looks done" is not done — every claim below is proven by a read-back or a probe, never by the absence of an error on the write.

Arguments: `$ARGUMENTS` — optional description of the change under verification.

## 1. Capability pre-check

- The capability report must be fresh (`npm run probe:summary` — no `[STALE]` tag). If stale, run `/capability_probe` first.
- Any capability the change depends on must be `OK` — if the change assumed a capability that is `NO`/`unknown`, that is a finding, not a footnote.

## 2. Artifact read-back

For every record the change created or modified:

- **Read it back** via the Table API or the matching MCP `get_*` tool and assert the fields you wrote are the fields that landed. Silent partial writes are a known ServiceNow failure mode (scoped sandboxes, ACL-filtered fields, BR rewrites).
- Confirm the record landed in the **expected scope** — cross-scope writes landing in `global` (or vice versa) are a recurring trap.
- For metadata (dictionary, ACLs, properties): read back via Table API, not via the script path that wrote it.

## 3. Behavioural check

- If the change is callable (script include, REST endpoint, agent, flow): invoke it once through its real entry path and assert the response shape.
- If the change is an AI agent: `debug_agent_execution` (or read the latest `sn_aia_execution_plan`) and confirm a clean trace — plan reaches a productive terminal state, no `security_violation`, no empty output.
- If the change is a scheduled/async surface: force one execution (or wait one cycle) and read the evidence row.

## 4. No banned patterns introduced

Quick scan of the diff for the traps in [.team/LESSONS.md](../../.team/LESSONS.md), minimally:

- name lookups where sys_id lookups are required
- `GlideAggregate` for counts/sums inside a scoped app
- server-built HTML interpolating unescaped DB fields
- new tables without explicit ACLs
- secrets or instance credentials in committed files (`npm run lint:sanitize` must pass)

## 5. Report

State what was verified with the evidence (read-back values, plan sys_id, HTTP statuses) — and state plainly anything that could NOT be verified and why. An unverifiable step is a blocker to "done", not a caveat.
