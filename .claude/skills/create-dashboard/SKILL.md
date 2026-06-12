---
name: create-dashboard
description: Build a Platform Analytics dashboard on the connected ServiceNow instance — cube, indicator (aggregate or scripted), collection job, forced collection, score verification, dashboard shell. Use when asked to "create a dashboard", "add a PA indicator", "build a KPI/scorecard/trend", "set up Platform Analytics", or when pa_scores are empty/stale/frozen. Table API authoring (the Fluent SDK does not model pa_* records).
---

# Create a Platform Analytics dashboard

The record chain, in dependency order (full payloads: [reference/deploy-recipe.md](reference/deploy-recipe.md)):

```
pa_cubes → pa_scripts (scripted only) → pa_indicators → sysauto_pa + pa_job_indicators
        → force a collection → verify pa_scores_l1 → pa_dashboards shell
```

An indicator with no collection-job linkage produces a no-data dashboard with zero errors anywhere — wire the job in the same change, never "later".

## 0. Gate

`getCapability('pa.plugin_active')` must be `true`. PA authoring is Table API territory: the Fluent SDK has no pa_* coverage, and the `sn_pa` script namespace is blocked inside scoped-app sandboxes — automate via REST, not scoped scripts. The god-mode migration path in trap 5 additionally requires `getCapability('execute_script.available')` to be `true` — when it isn't (or is `unknown`), delete-and-recreate is the only safe reconfiguration path.

## 1. The five traps that cost real debugging time

All live-verified on a current release family ([reference/traps.md](reference/traps.md) carries the evidence):

1. **`pa_indicators.script` is a REFERENCE to `pa_scripts`**, not inline JS. PATCHing JS text into it returns 403 from the "PA Validate Indicator Script" BR. Deploy the `pa_scripts` row first, reference its sys_id.
2. **`pa_scores_l1.indicator` stores the INTEGER `pa_indicators.id`**, not the sys_id. Read `id` back after the indicator insert and query scores with it.
3. **You cannot force a run by PATCHing `sys_trigger.next_action`** — a BR recalculates it from the job's schedule grid, and any `sysauto_pa` update silently **recreates the trigger with a new sys_id**. Verified force mechanism: shrink the job's `run_period` to 1 minute, wait one fire, restore. Prove the run from `pa_job_logs`, never from the absence of errors.
4. **Frozen / broadcast values**: a value identical across two collections means the second run never re-evaluated (check `pa_job_logs` `inserts`/`deletes` — healthy re-collection deletes and re-inserts the window). And one cube evaluates ONE scripted indicator and can broadcast its result to every indicator on that cube — give each scripted indicator its own `pa_cubes` row.
5. **Post-creation edits to `cube` or `frequency` are rejected (403)** by the "PA Validate Update Frequency and Source" BR — route reconfigurations through a god-mode `GlideRecord.setWorkflow(false).update()` (only if `getCapability('execute_script.available')=true`), or delete-and-recreate the indicator.

## 2. Verify (the scores, not the records)

- Indicator read-back: `scripted`, `script` (reference value), `cube`, `frequency`, and the integer `id`.
- Force a collection; assert a `pa_job_logs` row for YOUR job with `state=collected_ok` and `inserts > 0`.
- `GET pa_scores_l1?sysparm_query=indicator=<integer id>` returns rows for the window.
- Force a second collection and assert the current-period value **changed** (for time-varying data) — this is the only proof the pipeline recomputes rather than carries forward.

## 3. Dashboard shell and the Workspace boundary

`pa_dashboards` (name, active) is the scriptable end of the line. Widget composition happens in the Platform Analytics Workspace UI (operator step, ~5 min): the "Saved Visualization" library reads `par_visualization`, NOT the legacy `pa_widgets` — pre-provisioning `pa_widgets` rows is wasted effort. The Workspace title bar reads `par_dashboard.name` (lazy-created on first view, bridged via `pa_dashboards.experience_dashboard`) — sync it after first open or operators see a stale title.

## Cleanup discipline (sentinel builds)

Delete in reverse order: dashboard → job link → job → indicator → script → cube. Deleting the job cascade-deletes its `sys_trigger`; deleting the indicator cascade-deletes its scores (`pa_scores_l1` exposes encoded view sys_ids — you cannot delete score rows directly; cascade is the path). Sweep every table for your sentinel prefix afterwards.
