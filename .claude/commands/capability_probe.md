# /capability_probe — Probe ServiceNow Instance Capabilities

Discover what works on the connected instance and write the verdict to [.team/instance-capabilities.json](../../.team/instance-capabilities.json). All hook/script/skill branching reads from this file via `getCapability()` — the report, not memory or docs, is the source of truth for instance state.

Arguments: `$ARGUMENTS` — optional:
- `--quick` *(default)* — read-only probes only (CI-safe, ~5s).
- `--full` — adds side-effect probes (probe-owned `KIT_PROBE_*` sentinel writes). ~30s.
- `--fail-on-regression` — exit non-zero if any capability that was `true` is now `false`.
- `--json` — print machine-readable diff after probing.

## When to run

- First session on a new instance (run via `/bootstrap`).
- After an instance upgrade or plugin install.
- When a build-skill's verification step fails — re-probe to see if the underlying capability flipped.
- Whenever the SessionStart summary shows `[STALE]` (report older than 7 days).

## 1. Pre-flight

Working tree clean is **not** required — the probe is read-only by default. But credentials must resolve:

```bash
node -e "require('./scripts/lib/sn-creds').readCreds()"
```

If this errors → **STOP** and run `/bootstrap` (or set `SERVICENOW_INSTANCE_URL` / `SERVICENOW_USERNAME` / `SERVICENOW_PASSWORD` in `.env`).

## 2. Run

```bash
npm run probe:quick    # default
# or
npm run probe:full
# or with regression gate
node scripts/probe-instance-capabilities.js --full --fail-on-regression
```

## 3. Read the output

- **`OK`**: capability passes — code paths gated on it may take the capable branch.
- **`NO`**: capability fails — keep the safe-default path; name the workaround in the project docs.
- **`N/A`**: probe subject doesn't apply on this instance (e.g. OAuth client not provisioned). Not a regression.
- **`ERR`**: probe couldn't run — investigate before trusting the rest of the report.
- **regression** (`true → false`): something that worked broke. **STOP** and investigate before relying on that surface; record a finding in `.team/agent-findings/<date>-capability-regression-<name>.md`.

## 4. Commit the report

Commit `.team/instance-capabilities.json` alongside any code that newly branches on a capability.

## 5. Adding a new probe

See [.claude/rules/capability-report.md](../rules/capability-report.md). In summary:
1. Add `{ name, mode, expected, run }` to `PROBES` in [scripts/probe-instance-capabilities.js](../../scripts/probe-instance-capabilities.js).
2. Seed a `status: "unknown"` entry in the report JSON.
3. Wire any consumer (hook, script, skill) in the same PR — or mark the probe informational in its `expected` text.
