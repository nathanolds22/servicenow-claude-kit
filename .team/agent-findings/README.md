# agent-findings — dated investigation narratives

One file per investigation: `YYYY-MM-DD-<slug>.md`. Each is a root-cause narrative — symptom, hypotheses falsified, the verified mechanism, the fix or workaround, and the retire-when condition if it's a workaround. This directory is the project's durable, repo-resident memory; the harness auto-memory is machine-local and does NOT survive a laptop move.

`ledger.jsonl` accumulates one JSON line per confirmed review finding (see `/team_review` Phase 3 for the shape).

When a finding generalizes beyond this project/instance, distil it to a bullet in [.team/LESSONS.md](../LESSONS.md) as well.
