---
name: flows
description: Work with Flow Designer flows on the connected ServiceNow instance — verify/publish/health-check flows, invoke flows and subflows programmatically via sn_fd.FlowAPI, and route platform-managed GenAI capability subflows. Use when asked to "run a flow", "invoke a subflow", "check why a flow didn't fire", "call FlowAPI", "health-check flows after a deploy", or to wire a GenAI Generic Prompt subflow. NOT for authoring flow logic — there is no supported programmatic path (see §1).
---

# Flows — lifecycle and invocation (not authoring)

## 1. The honest boundary: you cannot author a flow programmatically

A flow's executable logic lives in an opaque **compiled snapshot** (`sys_hub_flow.latest_snapshot` / `master_snapshot` → `sys_hub_flow_snapshot`), generated only by Flow Designer / Studio publish actions. Writing `sys_hub_flow` rows via REST produces a record with no working snapshot — the engine reads the snapshot, not the live row. Restoring a broken flow's `active`/`status` fields does **not** regenerate its snapshot either (production-verified: a flow restored to `active=1, published` after a bad regen still failed to dispatch until a manual Studio Publish rebuilt the snapshot).

Authoring is operator UI work. Give the operator this checklist:

1. Flow Designer (or Agent Studio for sn_aia trigger flows) → create/edit the flow.
2. **Publish** (not just Save) — publish compiles the snapshot.
3. Read back `active=true, status=published` via Table API (step §2 below) — the UI lies less than memory, but the Table API doesn't lie at all.
4. If the flow is bound to an sn_aia trigger config: re-assert trigger `run_as`/`run_as_user`/`channel` afterwards — Studio Publish wipes them (see `.claude/rules/ai-agents.md`).

What IS automatable: health checks, publishing-state assertions, invocation, and input/output schema discovery — the rest of this skill.

## 2. Flow health check (run after every deploy that touches flows or triggers)

```
GET /api/now/table/sys_hub_flow?sysparm_query=sys_id=<flow>&sysparm_fields=name,active,status,master_snapshot,latest_snapshot
```

Healthy = `active=true`, `status=published`, snapshot fields non-empty. Check **every** flow your change could have touched, not just the one you edited:

- REST updates to `sn_aia_trigger_configuration` fire `async_always` BRs that regenerate the bound flow and can leave it `active=false, status=draft` — **non-deterministically per flow**, so three of five may survive and two break (production-verified). Route trigger UPDATEs through god-mode `GlideRecord.setWorkflow(false).update()`; brand-new trigger INSERTs still need one manual Studio Publish. Full rule: `.claude/rules/fluent-metadata.md`.
- Execution evidence: `sys_flow_context` rows (`state=COMPLETE`) — query by `flow=<sys_id>` ordered by `sys_created_on` to prove a flow actually ran.

## 3. Invoke programmatically — `sn_fd.FlowAPI`

Full recipe with live-verified examples: [reference/flowapi-invocation.md](reference/flowapi-invocation.md).

The 30-second version (server-side, global scope):

```js
var r = sn_fd.FlowAPI.getRunner()
    .subflow('<scope>.<internal_name>')   // FQN, not the display name
    .inForeground()                        // or .inBackground() for async
    .withInputs({ /* keys = DECLARED input names */ })
    .run();
var outputs = r.getOutputs();
```

**Discover the declared input names first** — guessing produces "The undefined value has no properties" deep in the flow engine:

```
GET /api/now/table/sys_hub_flow_input?sysparm_query=model=<flow_sys_id>&sysparm_fields=element,label,internal_type,mandatory
```

`element` is the key `.withInputs()` expects. Outputs schema: same query against `sys_hub_flow_output`.

## 4. GenAI capability subflows — the `_meta` envelope

Platform-managed "Generic Prompt" model variants are Flow Designer subflows with ONE declared input (`input`, type json) whose first consumer hard-requires a `_meta` envelope. Bare `{prompt}` payloads fail with the same undefined-value error for every shape you try. The envelope and the model-routing knob (`_meta.definition`), plus how to verify routing from `sys_gen_ai_log_metadata`: [reference/genai-meta-envelope.md](reference/genai-meta-envelope.md).

## 5. Executor caveat (live-verified)

The kit's god-mode REST endpoint (`scripts/lib/sn-rest.js executeScript`) surfaces the value of the script's **last expression**; a top-level `return` yields `result: null` with `success: true`. The MCP `execute_script` tool wraps scripts in an IIFE, so `return` works there. End REST-path scripts with a bare expression (e.g. `JSON.stringify(o);`).
