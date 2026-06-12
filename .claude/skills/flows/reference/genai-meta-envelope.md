# GenAI capability subflows — the `_meta` envelope and model routing

Production-verified on a current release family (direct-LLM pivot work in the source project; mechanism confirmed for all five OOTB model variants). Re-verify the table/SI names on your instance before relying on exact identifiers — this layer is platform-managed and release-sensitive.

## The shape of the problem

The OOTB "Generic Prompt" capability is ONE capability (`sys_one_extend_capability_definition` rows discriminate model variants via `filter_properties`). Each variant's `api` is a Flow Designer subflow with a single declared input: `input` (type json). The subflow's first action — the GenAI Preprocessor — hard-requires:

```js
input._meta = {
  capability:    '<sys_one_extend capability sys_id>',
  definition:    '<variant definition sys_id>',   // ← the model-routing knob
  transactionId: '<any unique string>'
}
```

A bare `{ prompt: "..." }` (or any wrapper without `_meta`) makes the preprocessor return an error object that a downstream step dereferences, so every wrong shape fails with the **same** message:

```
FlowObjectAPIException: The current operation ended in state: ERROR.
Detail: The undefined value has no properties.
```

Do not iterate payload guesses against that error — it carries zero information about which key was wrong. Read the preprocessor's contract instead.

## Working invocation

```js
var r = sn_fd.FlowAPI.getRunner().subflow('<genai_subflow_fqn>').inForeground()
    .withInputs({
        input: {
            _meta: { capability: '<capability_sys_id>', definition: '<definition_sys_id>',
                     transactionId: 'kit-smoke-' + new GlideDateTime().getNumericValue() },
            prompt: '<prompt text>',
            isStream: false
        }
    }).run();
```

`_meta.definition` forces the chosen model variant regardless of the platform's default routing — note that the higher-level `LLMClient.call({capability})` ignores the capability argument on some families and always routes to the platform default; the `_meta` envelope at subflow level is the reliable knob.

## Verify routing — then separate routing from provider health

After each call, read the GenAI log tables:

```
GET /api/now/table/sys_gen_ai_log_metadata?sysparm_query=ORDERBYDESCsys_created_on&sysparm_fields=definition,status&sysparm_limit=3
```

- `definition` equals the `_meta.definition` you sent → routing works.
- `status=error` with routing correct → a **provider** problem (entitlement not purchased, `sys_connection` alias unconfigured, credentials absent). Routing and provisioning are independent layers; proving the first does not grant the second, and no payload change fixes the second.
- The parent `sys_generative_ai_log.response` / `.error` carries the response text or the provider error detail.
