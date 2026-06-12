# sn_fd.FlowAPI invocation recipe

Live-verified round-trip (current release family): the OOTB read-only subflow `global.check_record_access_for_user`, invoked in foreground via the god-mode script endpoint, returned `{output: "true"}` in ~4s and left a `sys_flow_context` row at `state=COMPLETE`.

## 1. Pick the FQN

```
GET /api/now/table/sys_hub_flow?sysparm_query=active=true^status=published^type=subflow^nameLIKE<term>
       &sysparm_fields=sys_id,name,internal_name,sys_scope.scope&sysparm_limit=50
```

(Instances carry hundreds of OOTB flows — always narrow with `nameLIKE`/`sys_scope` and cap with `sysparm_limit` rather than pulling the whole table.)

FQN = `<sys_scope.scope>.<internal_name>` (e.g. `global.check_record_access_for_user`). The display `name` does not work.

## 2. Discover the input/output contract — never guess

```
GET /api/now/table/sys_hub_flow_input?sysparm_query=model=<flow_sys_id>&sysparm_fields=element,label,internal_type,mandatory,default_value
GET /api/now/table/sys_hub_flow_output?sysparm_query=model=<flow_sys_id>&sysparm_fields=element,label,internal_type
```

(`model` is the correct reference field on both tables — live-verified; a query on `flow` returns nothing.)

`element` values are the exact keys for `.withInputs({...})` and the keys you'll read off `getOutputs()`. A wrong/missing key does not error at the API boundary — it surfaces later as `FlowObjectAPIException: ... The undefined value has no properties` from whichever flow step first dereferences the absent input (production-verified failure mode; eight payload-shape guesses all produced the identical error).

## 3. Invoke

```js
// subflow, synchronous (blocks until the subflow completes, outputs available)
var r = sn_fd.FlowAPI.getRunner()
    .subflow('global.check_record_access_for_user')
    .inForeground()
    .withInputs({ table_name: 'sys_user', operation: 'read',
                  record_id: '<sys_id>', user_id: '<sys_id>' })
    .run();
var outs = r.getOutputs();           // map keyed by declared output elements
var o = {}; for (var k in outs) { o[k] = String(outs[k]); }
JSON.stringify(o);                   // last expression — see executor caveat in SKILL.md §5
```

- `.flow('<scope>.<internal_name>')` for trigger-style flows (no outputs contract); `.action(...)` for single actions.
- `.inBackground()` queues the run and returns immediately — no outputs; correlate later via `sys_flow_context`.
- Foreground runs are capped by the platform's transaction limits — keep them for short utility subflows and smokes.

## 4. Verify the run happened (don't trust the absence of an exception)

```
GET /api/now/table/sys_flow_context?sysparm_query=flow=<flow_sys_id>^ORDERBYDESCsys_created_on&sysparm_fields=sys_id,state,sys_created_on&sysparm_limit=3
```

`state=COMPLETE` with a fresh timestamp is the proof. `IN_PROGRESS` that never completes usually means a Wait step or an error swallowed by the engine — open the context in Flow Designer's execution view for the step trace.

## 5. Calling from a scoped app

`sn_fd.FlowAPI` is callable from scoped scripts, but the flow executes under the calling session's context; cross-scope flow access is governed by the flow's "Run with role/Accessible from" settings. When a scoped call mysteriously no-ops, re-run the same invocation via the god-mode endpoint (global scope) to separate a permissions problem from a payload problem.
