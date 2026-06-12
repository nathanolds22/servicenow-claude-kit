# /ship — Release-Gate Review of the Deployed Instance

Multi-agent review of the **live deployed instance** — not the source diff (`/team_review` owns that). The question is: "is the running system in a shape we'd put in front of users today?" Run after deploying (and after `/verify` on the individual artifacts), before tagging/announcing a release.

Arguments: `$ARGUMENTS` — optional context (release label, scope under review).

**Read-only against the instance — non-negotiable.** Findings name fixes; humans (or `/deploy`, `/capability_probe`) apply them. No `update`/`insert`/`deleteRecord`/`gs.setProperty`, no MCP `create_*`/`update_*`/`delete_*` calls. MCP `execute_script` is allowed ONLY for read-only `GlideRecord`/`GlideAggregate` queries, and every such script starts with a `// READ-ONLY` marker comment.

## Phase 0 — Capability gate

The ship gate is too consequential to run on a fuzzy view of the instance. **STOP** (do not dispatch agents) if either:

```bash
node -e "
try {
  const { loadReport, isStale } = require('./scripts/lib/capability-report');
  const r = loadReport();
  if (isStale(r)) { console.error('STALE/missing capability report — run /capability_probe first'); process.exit(1); }
  const errs = Object.entries(r.capabilities || {}).filter(([, c]) => c.status === 'error');
  if (errs.length) { console.error('ERROR entries: ' + errs.map(([k]) => k).join(', ') + ' — re-probe before shipping'); process.exit(1); }
  console.log('capability gate OK (generated ' + r.generated_at + ')');
} catch (e) { console.error('capability report unreadable (' + e.message + ') — fix or delete it, then run /capability_probe'); process.exit(1); }
"
```

- Report older than 7 days (or missing) → run `/capability_probe` first.
- Any `status: "error"` entry → instance state is unknown on that surface; re-probe before shipping.

## Phase 1 — Parallel live review

Launch the kit's live-capable agents **in a single message** (one Agent call each). Each prompt states: the scope under review, the read-only rule above (including the `// READ-ONLY` marker), and the return shape `severity | target (sys_id or table/record) | finding | concrete remediation (which command or human action fixes it)`.

| Agent | Reviews on the live instance |
|---|---|
| `now-platform-best-practices` | hand-rolled mechanisms that duplicate native platform surfaces |
| `capability-auditor` | live state vs capability report — flips, stale workarounds, unprobed dependencies |
| `security-auditor` | ACL coverage on app tables, over-privileged accounts, exposed endpoints, secrets |
| `architect-cert-reviewer` | AI/LLM surfaces — stop conditions, prompt-version hygiene, circuit breakers, tool schemas |

Skip an agent only when its surface demonstrably doesn't exist on the instance (e.g. no sn_aia plugin → no cert review) — and cite the capability-report entry or read-back that proves the absence; a skip without evidence is itself a finding. Phase 4 records dispatched-vs-applicable counts so a quietly under-populated fan-out is visible in the log.

## Phase 2 — Browser smoke (CONDITIONAL)

Required **only when both** hold: a chrome-MCP browser surface is connected in this session, AND the project has a user-facing UI on the instance. Then: read-only navigation of the canonical user path — login, load the app's main surface, render one canonical record, capture console + network errors. No form submissions, no mutating clicks.

Otherwise record **N/A with the rationale** (e.g. "no UI surface — kit/backend-only project" or "no browser MCP connected"). An N/A browser phase does not block `READY`; a *failed* smoke does.

## Phase 3 — Synthesize

- Deduplicate findings; keep the highest severity on conflict.
- **Adversarially verify every CRITICAL/HIGH yourself** against the live instance (read-only) before reporting — agents produce plausible-but-wrong findings. Record, per finding, the specific read that confirmed or refuted it (table/query + what came back); a verification without evidence is narrative, not a gate. The evidence reference goes into the ledger row (`"verified_by"`).
- Verdict: **READY** (no CRITICAL/HIGH confirmed), **REVIEW** (HIGHs need a human call), **BLOCKED** (CRITICAL confirmed, or required browser smoke failed).
- A REVIEW verdict has a defined exit: fix the HIGHs and re-run `/ship` to READY, **or** record an explicit risk-acceptance (who accepted, why) in the SHIP_HISTORY line. Two operators reading the same REVIEW must reach the same next action.

## Phase 4 — Record

Append **one line per run** (verdict reached, even BLOCKED — "we ran ship and the answer was no" is a release artifact) to [.team/SHIP_HISTORY.md](../../.team/SHIP_HISTORY.md), format documented in that file:

```
- <ISO8601 UTC> | <branch> | <verdict> | agents: <dispatched>/<applicable> | browser: <PASS|FAIL|N/A — rationale> | top finding: <one line or none>
```

Append-only — never edit prior lines. Keep the top-finding text **generic**: no instance hostnames, scope names, or sys_ids in this committed file — full evidence belongs in `.team/agent-findings/`. Confirmed findings also go to `.team/agent-findings/ledger.jsonl` (same shape as `/team_review` Phase 3, plus the `"verified_by"` evidence reference); reusable platform gotchas earn a LESSONS.md bullet.

## What /ship does NOT do

- Review the source diff (`/team_review`), verify a single artifact (`/verify`), or deploy (`/deploy`).
- Mutate anything on the instance — including "harmless" property flips.
- Write the capability report — only the probe script does that.
- Tag or push a release. The verdict informs the operator; the operator decides.
