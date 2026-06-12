# /bootstrap — First-Run Setup on a New Machine / Instance

One command that takes a fresh clone of this kit to a working, instance-aware state. Run it once per machine+instance pair; it is idempotent and safe to re-run.

Arguments: `$ARGUMENTS` — optional instance URL to pre-fill step 2.

## Step 1 — Verify Layer A (the MCP server)

The kit assumes the [servicenow-mcp](https://github.com/nathanolds22/servicenow-mcp) server is registered. Check:

1. Call the MCP tool `list_tool_packages` (load via ToolSearch if deferred). You want package `full` (~236 tools) or at least `agentic_workflow_builder` + `god_mode_full`.
2. If the tool is missing entirely → the server isn't connected. Tell the operator to run `claude mcp add` per the servicenow-mcp README, then restart the session. **STOP** here.
3. If only a small ITSM-ish set is present → the server is running a restricted `MCP_TOOL_PACKAGE`. Tell the operator to set `MCP_TOOL_PACKAGE=full` in the server's registration env. Continue (Layer B still works via REST).

## Step 2 — Credentials

1. Check resolution: `node -e "require('./scripts/lib/sn-creds').readCreds()"`.
2. If it throws: ask the operator for instance URL + integration username + password, then write them to `.env` (copy `.env.example`). Never commit `.env`; never echo the password back.
3. Re-run the check until it passes.

## Step 3 — First capability probe

```bash
npm run probe:quick
```

Read the summary. `instance.connectivity` and `table_api.read` must be `OK` — anything less means creds or network are wrong; fix before continuing. Other `NO`s are *information*, not blockers (e.g. `execute_script.available=NO` means the god-mode Scripted REST API isn't deployed yet — see the servicenow-mcp `servicenow_scripts/DEPLOYMENT_GUIDE.md`).

## Step 4 — Docs mirror

```bash
npm run docs:servicenow:detect
```

This reads the instance's `glide.buildtag`, derives the release family, and fetches the matching ServiceNowDocs branch. If the family's branch was deleted upstream (old release), pick the nearest available branch with `npm run docs:servicenow -- --branch <name>` and note the mismatch in CLAUDE.md.

## Step 5 — Fill CLAUDE.md coordinates

Open [CLAUDE.md](../../CLAUDE.md) and replace the `<placeholders>` in the Coordinates section: instance URL, application scope (if any), integration user. Keep it short — the capability report carries the live state; CLAUDE.md only carries the pointers.

## Step 6 — Seed auto-memory

Write these as memory files (per the harness memory instructions), so every future session starts oriented:

- **user**: who the operator is (role, team) — ask if unknown.
- **project**: instance URL + scope + integration user (the coordinates from step 5).
- **feedback**: "Ground ServiceNow platform claims via the `servicenow-docs` skill before asserting; do not answer platform-behaviour questions from memory."
- **feedback**: "`.team/instance-capabilities.json` (via `getCapability()`) is the source of truth for instance state; never assume a capability from docs or precedent."

## Step 7 — Confirm

A fresh session should now print the capability summary at SessionStart and recall the seeded memories. Tell the operator bootstrap is complete and list anything left `NO`/`unknown` that they may want to fix (god-mode endpoint deploy, A2A OAuth provisioning, `probe:full` for write-path capabilities).
