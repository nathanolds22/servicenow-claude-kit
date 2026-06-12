# Ship history

Append-only log of `/ship` release-gate verdicts — one line per completed run, **even BLOCKED** (a refused ship is a release artifact). Never edit or delete prior lines; `/ship` Phase 4 appends here.

Line format:

```
- <ISO8601 UTC> | <branch> | <READY|REVIEW|BLOCKED> | agents: <n> | browser: <PASS|FAIL|N/A — rationale> | top finding: <one line, or "none">
```
