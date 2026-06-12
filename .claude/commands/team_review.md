# /team_review — Parallel Multi-Agent Review of the Current Diff

Fan out the kit's reviewer agents against the current working-tree diff (or `$ARGUMENTS` — a ref range / PR number), then synthesize a single verdict. Use before merging any non-trivial change.

## Phase 0 — Scope the diff

```bash
git status --short && git diff --stat
```

Decide which agents apply (skip agents whose surface isn't touched):

| Agent | Dispatch when the diff touches |
|---|---|
| `code-reviewer` | any server-side JS / script includes / business rules / client scripts |
| `security-auditor` | ACLs, auth, credentials handling, user input paths, REST endpoints |
| `performance-auditor` | GlideRecord queries, scheduled jobs, bulk writes, aggregates |
| `capability-auditor` | anything that branches on instance behaviour or assumes a capability |
| `now-platform-best-practices` | hand-rolled code that might have a native platform feature |
| `architect-cert-reviewer` | AI-agent / LLM-calling surfaces, prompt changes, multi-agent designs |

## Phase 1 — Dispatch in parallel

Launch all applicable agents in a single message (one Agent call each), passing each: the diff scope, the files touched, and the instruction to return findings as `severity | file:line | finding | concrete remediation`.

## Phase 2 — Synthesize

- Deduplicate findings across agents; keep the highest severity on conflict.
- Verify each CRITICAL/HIGH finding yourself against the actual diff before reporting it (agents produce plausible-but-wrong findings; adversarial check is mandatory).
- Verdict: **PASS** (no CRITICAL/HIGH), **REVIEW** (HIGHs need a human call), **BLOCKED** (CRITICAL confirmed).

## Phase 3 — Record

Append a one-line entry per confirmed finding to `.team/agent-findings/ledger.jsonl`:

```json
{"date":"<ISO>","source":"team_review","severity":"HIGH","file":"<path>","finding":"<one line>","status":"open"}
```

Findings that reveal a reusable platform gotcha also earn a bullet in [.team/LESSONS.md](../../.team/LESSONS.md).
