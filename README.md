# servicenow-claude-kit

Portable Claude Code scaffolding for ServiceNow projects: an instance **capability report** with session-start surfacing, **official-docs grounding** without a vector DB, hardened **reviewer agents**, surface-specific **rules**, and a **lessons corpus** of production-verified platform gotchas. Distilled from ~2 months of hardened Claude-Code-on-ServiceNow delivery; companion to the [servicenow-mcp](https://github.com/nathanolds22/servicenow-mcp) server.

## The two-layer mental model

| Layer | What | Where it lives |
|---|---|---|
| **A — the tools** | The `mcp__ServiceNow__*` tool surface: god-mode `execute_script`, A2A invocation, AI-agent CRUD, catalog/flow/PA tools (~236 tools) | [servicenow-mcp](https://github.com/nathanolds22/servicenow-mcp), registered per-machine (`claude mcp add`), `MCP_TOOL_PACKAGE=full` |
| **B — the brain** | Capability report, docs mirror, skills/commands/agents/rules, hooks, lessons | **This kit, in your repo** |

If Claude "feels worse" on a machine, diagnose which layer is missing before building anything. Layer A check: `claude mcp list`, then call `list_tool_packages`. Layer B check: does a new session print the capability summary?

## Quickstart (new project)

1. **Use this template** (or clone) → your new repo.
2. Open it in Claude Code with the servicenow-mcp server connected.
3. Run **`/bootstrap`** — it verifies Layer A, collects credentials into `.env`, runs the first capability probe, fetches the docs mirror for your instance's release family (auto-detected from `glide.buildtag`), fills CLAUDE.md coordinates, and seeds session memory.

Existing repo instead? Overlay the kit without clobbering local files:

```bash
node install.js --into /path/to/existing-repo   # add --dry-run first if cautious
```

## What's inside

```
.claude/
  settings.json        SessionStart capability summary · PreToolUse execute_script warning · adaptive Stop quality gate
  commands/            /bootstrap · /capability_probe · /verify · /team_review
  agents/              code-reviewer · security-auditor · performance-auditor ·
                       capability-auditor · now-platform-best-practices · architect-cert-reviewer
  rules/               capability-report · ai-agents · ai-tools · a2a-exposure · fluent-metadata
  skills/              servicenow-docs (index → grep → read; no embeddings)
.team/
  instance-capabilities.json   the capability report (probe-written, getCapability()-read)
  LESSONS.md                   20 production-verified, instance-independent platform gotchas
  agent-findings/              dated root-cause narratives (your project's durable memory)
scripts/
  probe-instance-capabilities.js   ~13 universal probes (--quick read-only / --full sentinel writes)
  fetch-servicenow-docs.js         docs mirror with --detect (release family from glide.buildtag)
  lint-sanitize.js                 banned-string gate (keep the kit/client repos clean)
  quality-gate.sh                  adaptive Stop-hook gate (runs only the gates that exist)
  lib/                             sn-creds (layered resolution) · sn-rest · capability-report
```

### The capability report — instance self-awareness

`npm run probe:quick` probes the live instance and writes `.team/instance-capabilities.json`; every session starts by printing the OK/NO table. Code branches via `getCapability(name)` — stale or missing entries return `'unknown'`, and **the safe default for unknown is the previous-behaviour path**. Probes never assume; they observe. See `.claude/rules/capability-report.md` for the probe-authoring discipline.

### Docs grounding — no vector DB

`npm run docs:servicenow:detect` vendors the official [ServiceNow/ServiceNowDocs](https://github.com/ServiceNow/ServiceNowDocs) markdown (Apache-2.0) for **your instance's release family**, pinned in `servicenow-docs.lock.json`. Retrieval is deliberately agentic: read `llms.txt` → ripgrep the matched publication → read the page. The `servicenow-docs` skill enforces the discipline.

### Credentials

Layered resolution everywhere (`scripts/lib/sn-creds.js`): process env → repo `.env` (gitignored) → `~/.claude.json` `mcpServers.<name>.env`. Works regardless of how the MCP server was registered; corporate machines can keep passwords out of `~/.claude.json` entirely.

## MCP-first, Fluent opt-in

The kit works day one with only the MCP server (read, analyze, build via MCP power tools, verified by probes and read-backs). When the project is ready for source-controlled metadata, adopt the [Fluent SDK](https://developer.servicenow.com/dev.do#!/reference/next-experience/sdk) — `.claude/rules/fluent-metadata.md` carries the hard-won `$id`/ACL/deploy-path rules, and the quality gate picks up `now-sdk build` automatically.

## Roadmap

- **Wave 2** — build-skills: `create-dashboard` (Platform Analytics, with the pa_scripts/integer-id/frozen-value traps baked in) · `create-catalog-item` · `flows` (lifecycle + FlowAPI invocation; honest about the no-programmatic-authoring boundary) · `create-agentic-workflow` (sn_aia anatomy, stop conditions, dispatch verification via A2A).
- **Wave 3** — `a2a-usage` skill (decision tree + OAuth provisioning + smoke), `/deploy` + `/ship` release gate for Fluent-adopted projects.

## License

MIT. The vendored docs mirror remains Apache-2.0 (ServiceNow); it is gitignored and never redistributed by this repo.
