# Rules: AI agent tools (script tools called by sn_aia agents)

Applies to: any script tool an sn_aia agent invokes, and any Script Include that calls an LLM client directly.

## Circuit breaker first (for agent-only tools)

Every tool callable ONLY by an agent opens with a budget/circuit gate that returns a structured error when the service's spend ceiling has tripped. Dual-use tools (also called from UI approval paths) deliberately skip the gate — budget pressure must never block a human approving work. When adding a tool, ask: "is this callable from the UI today?" If yes, no gate; if no, gate.

## Usage logging on every LLM call

Wrap every direct LLM call with a usage-log write (service bucket, duration, cost estimate, parent record attribution) in a try/catch — the log is a nice-to-have; never let a logger failure break the primary write. Separate service buckets per pathway (agent vs direct-SI vs external-caller) so operators can budget-gate and attribute spend at a glance.

## Tool arg schema must match the tool body

If the tool body reads `inputs.query` but the agent-tool m2m `inputs[]` schema doesn't declare `query`, the LLM invents argument names at runtime and the tool fails. Author the schema with the tool; validate body reads against declarations; re-verify the live schema after every deploy path that rewrites m2m rows.

## Return a structured error shape on failure

`{ success: false, error: '<DOMAIN>_<CODE>', message: '<user-readable>', retryable: <bool> }` — SCREAMING_SNAKE codes, messages written for end-users, retryable accurate (a user-precondition failure is not retryable).

## Don't interpolate untrusted text into LLM prompts or generated script payloads

1. **Prompt injection via DB-sourced text**: knowledge articles, PDF-extracted bodies, and user-typed fields emitted into tool output reach the agent's scratchpad unfiltered. Bound output to a structured shape (named string fields, not freeform passages), document in the tool instructions that returned text is DATA not instructions, and give the consuming agent a STOP CONDITION rejecting instruction-marker content (`<system>`, `Ignore previous`, `New instructions:`).
2. **Script injection via generated payloads**: `JSON.stringify(untrusted)` into a generated `execute_script` body is safe only while the consumer treats the parsed result as data. Keep consumers pure (parse → field-by-field schema validation), cap input length at the boundary, and prefer Table API writes over generated scripts whenever the operation is a record write.

## GlideAggregate caution in scoped apps

COUNT/SUM from inside a scoped-app sandbox can silently cap (~1k rows) on some release families while `GlideRecord.getRowCount()` and row iteration return correct totals. Any aggregate feeding a cost ceiling, threshold, or compliance number must iterate GlideRecord. Re-test the cap on every major upgrade before reverting.

## Metadata operations don't belong in tool scripts

A tool that touches `sys_dictionary`, creates tables, or calls schema descriptors is doing metadata work — move it to source-controlled authoring (Fluent/update set). Tools operate on data in tables that already exist.
