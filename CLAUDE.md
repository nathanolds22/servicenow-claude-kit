# CLAUDE.md — <project name>

This file tells Claude Code how to work in this repository. Always read it first. Replace every `<placeholder>` during `/bootstrap`.

Surface-specific rules live in [.claude/rules/](./.claude/rules/) — read the matching rule before touching that surface (ai-agents, ai-tools, capability-report, a2a-exposure, fluent-metadata).

## What this repo is

A ServiceNow project scaffolded from [servicenow-claude-kit](https://github.com/nathanolds22/servicenow-claude-kit), working against the instance below via the [servicenow-mcp](https://github.com/nathanolds22/servicenow-mcp) server (Layer A) plus this repo's scaffolding (Layer B).

## Coordinates

- **Instance**: `<instance>.service-now.com`
- **Application scope**: `<scope or "none yet">`
- **Integration user**: `<integration username>` (creds resolve via env → `.env` → `~/.claude.json`; see [scripts/lib/sn-creds.js](scripts/lib/sn-creds.js))
- **Canonical sys_ids**: record every agent/team/table sys_id here the day it's created — name lookups across scopes are a bug (see `.claude/rules/ai-agents.md`).

## Instance state — the capability report

[.team/instance-capabilities.json](.team/instance-capabilities.json) is the **source of truth for what works on this instance** — never this doc, never memory. Refresh with `npm run probe:quick` (read-only, ~5s) or `npm run probe:full` (sentinel writes). The SessionStart hook prints the summary. Branch on it via `getCapability()` only; the safe default for `unknown` is the previous-behaviour path.

## Division of labour — authoring vs live state

| Task | Use |
|---|---|
| Reading live instance state | MCP (`mcp__ServiceNow__*` get/list tools) |
| Ad-hoc script execution | MCP `execute_script` (requires the god-mode endpoint — probe `execute_script.available`) |
| AI-agent runtime debug | MCP `debug_agent_execution`, `get_ai_execution_plan` |
| Mutating live data (records, not metadata) | MCP / Table API |
| Authoring metadata (tables, BRs, agents, catalog) | MCP power-build tools — or the Fluent SDK once adopted (then: source → build → deploy ONLY; never hand-patch a deployed artifact) |
| Platform-behaviour questions | `servicenow-docs` skill (local mirror) — never from memory |

## Daily loop

1. Check the SessionStart capability summary; re-probe if `[STALE]`.
2. Build (MCP tools or Fluent source per the table above).
3. **Verify** — `/verify`: read back every artifact, prove behaviour, never trust a silent write.
4. Review non-trivial diffs with `/team_review`.
5. Record reusable traps in [.team/LESSONS.md](.team/LESSONS.md); investigation narratives in [.team/agent-findings/](.team/agent-findings/).

## Knowledge bases in this repo

- [.team/LESSONS.md](.team/LESSONS.md) — instance-independent ServiceNow gotchas. Read before building anything.
- [.team/agent-findings/](.team/agent-findings/) — dated root-cause narratives (this project's durable memory; machine-local auto-memory does not survive a laptop move).
- `vendor/servicenow-docs/` — official platform docs mirror (gitignored; `npm run docs:servicenow:detect`). Retrieval: `llms.txt` index → ripgrep → read the page. No vector DB.

## Fluent SDK opt-in

This repo starts MCP-first. To adopt source-controlled metadata authoring: install `@servicenow/sdk`, `now-sdk init` (creates `now.config.json` + `src/fluent/`), then read [.claude/rules/fluent-metadata.md](.claude/rules/fluent-metadata.md) BEFORE declaring anything. The Stop-hook quality gate picks up `now-sdk build` automatically once `now.config.json` exists. Probe `sdk_install.*`-class capabilities before trusting the SDK deploy path on this instance.

## Verification before any commit

- [ ] `npm run lint:sanitize` green (no secrets/instance leakage — adjust the banned list for THIS project's confidentiality needs)
- [ ] Capability report fresh; any capability the change depends on is `OK`
- [ ] Every created/modified artifact read back from the instance (`/verify`)
- [ ] If an AI agent changed: clean `debug_agent_execution` trace + stop conditions intact
