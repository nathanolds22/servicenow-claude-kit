# Ship history

Append-only log of `/ship` release-gate verdicts — one line per completed run, **even BLOCKED** (a refused ship is a release artifact). Never edit or delete prior lines; `/ship` Phase 4 appends here.

Line format (v1):

```
- <ISO8601 UTC> | <branch> | <READY|REVIEW|BLOCKED> | agents: <dispatched>/<applicable> | browser: <PASS|FAIL|N/A — rationale> | top finding: <one line, or "none">
```

Keep the top-finding text generic — no instance hostnames, scope names, or sys_ids in this committed file; full evidence belongs in `.team/agent-findings/`. A REVIEW line whose HIGHs are risk-accepted rather than fixed records who accepted and why.

- 2026-06-12T12:33:23Z | feat/wave-3-a2a-deploy-ship | READY | agents: 4/4 | browser: N/A — kit ships no user-facing UI on the instance (app-agnostic scaffolding); no browser MCP in session | top finding: none (informational: A2A card-read/round-trip surfaces lack dedicated probes — follow-up filed)
