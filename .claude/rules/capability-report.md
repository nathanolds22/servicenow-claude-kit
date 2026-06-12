# Rules: Capability report (`.team/instance-capabilities.json`)

Applies to: [scripts/probe-instance-capabilities.js](../../scripts/probe-instance-capabilities.js), [scripts/lib/capability-report.js](../../scripts/lib/capability-report.js), and any code branching on `getCapability(...)`.

## Why this exists

Docs drift from reality, and nobody should have to read a 2,000-line CLAUDE.md to learn whether a deploy path works on the connected instance today. The capability report inverts that: a script *probes* the instance, writes structured findings, and every consumer (scripts, slash commands, hooks, CI) branches off the report. Project docs become pointers to the report, not pinned snapshots.

## Naming

`<group>.<noun_clause>` in lowercase snake_case. Group = subsystem under test; noun clause = the specific assertion.

- `table_api.sys_dictionary_writable` ✓
- `execute_script.runs_global_scope` ✓
- `sdk_works` ✗ (too vague) · `sdkInstallOk` ✗ (camelCase, no group)

## Required fields per entry

`status` (`true` | `false` | `"n/a"` | `"unknown"` | `"error"`), `expected` (one sentence defining what true means), `observed` (one-token summary, e.g. `"2xx"`, `"plugin-absent"`), `probed_at` (ISO), `probe_method` (`"quick"`/`"full"`), `evidence` (raw counts, sys_ids, HTTP statuses — without it a flipped capability has no audit trail).

## `--quick` vs `--full`

A `--quick` probe MUST be read-only against the instance (GETs, queries, non-mutating script evaluation). A `--full` probe MAY mutate, but only against a probe-owned sentinel (`KIT_PROBE_*` prefix) that the probe creates and cleans up — or a same-value no-op write. Never insert-then-orphan; never touch real domain rows.

CI runs `--quick` only, non-blocking until a probe has ~2 weeks of stable green data.

## Adding a new probe

1. Add `{ name, mode, expected, run }` to `PROBES` in the probe script; `run()` returns `ok()`, `no()`, `na()`, or `err()` (the helpers timestamp consistently).
2. Seed the entry in the report JSON with `status: "unknown"`, `probed_at: null` so the schema is stable from day one.
3. Document side effects of `--full` probes inline.
4. Run the probe locally; commit the resulting report alongside the probe code.
5. Wire any downstream consumer in the same PR — otherwise flag the probe as informational in its `expected` text.

## Branching on capability

Always go through `getCapability(name)` — it returns `'unknown'` for missing or stale (>7 days) entries.

**The safe default for any unknown is the previous-behaviour path, never the new behaviour. New behaviour requires positive evidence.**

## Don't

- Don't read or write the report file by hand — use the lib functions.
- Don't infer one capability from another. Each must be probed.
- Don't delete a probe when its capability flips permanently true — keep it so a regression stays visible; mark dependent workarounds retire-eligible instead.
- Don't write `--full` probes that insert real domain rows.
- Don't let anything except the probe script write the report. Hooks and commands only read it.
