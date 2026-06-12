# PA trap catalogue — evidence and detection

Each trap below was verified against a live current-family instance (marked **live**) or carried over from a hardened production project on the same family (marked **prod**). Re-verify prod-tier traps once per release upgrade.

## 1. `pa_indicators.script` is a reference, not a script field — **live**

`sys_dictionary[name=pa_indicators, element=script]` is `internal_type=reference → pa_scripts` on recent families. PATCHing JS text into it returns:

```
403 — Operation against file 'pa_indicators' was aborted by Business Rule 'PA Validate Indicator Script'
```

Fix: deploy the `pa_scripts` row first (script body + `table` matching the cube's facts table), then set `pa_indicators.script = <pa_scripts sys_id>` with `scripted=true`.

## 2. `pa_scores_l1.indicator` is the integer `pa_indicators.id` — **live**

The scores surface joins on the indicator's auto-numbered integer `id` (a small platform-minted integer, not a GUID), not the sys_id. Querying scores by sys_id silently returns zero rows. Also: `pa_scores_l1` returns **encoded** sys_ids (`__ENC__...`) — it's a view-shaped surface; you can't DELETE its rows directly. Score cleanup = delete the indicator (cascade, verified live).

## 3. Forcing a collection run — **live, corrects an earlier recipe**

Three mechanisms tested on the same sentinel job:

| Mechanism | Result |
|---|---|
| PATCH `sys_trigger.next_action` to now | **Fails silently** — a BR snaps the value back to the job's schedule grid (the PATCH response already shows the recalculated value) |
| `SncTriggerSynchronizer.executeNow(job)` via god-mode script | Returned success but produced **no** `pa_job_logs` run on this family |
| PATCH `sysauto_pa.run_period` to `1970-01-01 00:01:00` | **Works** — trigger resyncs and fires within ~1 min; restore the period afterwards |

Two side-facts, both live: (a) any `sysauto_pa` update **recreates** the bound `sys_trigger` under a new sys_id — never cache trigger sys_ids; (b) a new job whose `run_start` is past-due fires once on creation.

## 4. Frozen-value and broadcast detection — **live (frozen) / prod (broadcast)**

- **Frozen**: a score identical across two collection runs means the second run never recomputed. Healthy re-collection shows `deletes>0, inserts>0, updates=0` in `pa_job_logs` (PA replaces score rows, it doesn't patch them). When validating a new scripted indicator, use a time-varying script body so two runs MUST differ.
- **Broadcast**: the collector evaluates ONE scripted indicator per cube and can copy that result to every indicator linked to the same cube, even when each points at a distinct `pa_scripts` row. Detection: two scripted indicators on one cube showing byte-identical scores. Fix: one `pa_cubes` row per scripted indicator (same `facts_table` is fine).
- Beware false alarms: other PA jobs (e.g. the OOTB Now Assist collection, 15-min cadence) write `pa_job_logs` rows continuously — always filter by your job's sys_id.

## 5. Locked-down indicator updates — **prod, BR name confirmed live**

The "PA Validate Update Frequency and Source" BR 403-rejects UPDATEs that change `cube` or `frequency` on an existing indicator. Migrations (e.g. moving an indicator to its own cube to break a broadcast) go through god-mode `GlideRecord.setWorkflow(false).update()` — only with `getCapability('execute_script.available')=true`; otherwise delete-and-recreate. INSERTs stay on the normal POST path so the platform mints the integer `id` correctly.

## 6. Scoped-sandbox limits — **prod**

The `sn_pa` script namespace is blocked inside scoped-app script sandboxes. PA automation belongs in admin basic-auth REST — or global-scope god-mode scripts only where `getCapability('execute_script.available')=true`; with the capability `false`/`unknown`, Table API REST is the only automation path. Related: GlideAggregate inside scoped apps can silently cap at ~1k rows (see `.team/LESSONS.md`) — pa_scripts bodies run in PA's collector context, but any aggregate feeding a compliance number should be spot-checked against `GlideRecord` iteration.

## 7. Schema facts that differ from older docs — **live/prod**

- `pa_indicators` has **no** `facts_table` column — the cube carries it (`pa_cubes.facts_table`).
- `pa_indicators` has **no** `active` column — `pa_job_indicators.collect_indicator` controls collection.
- `pa_job_indicators.collect` is about **breakdowns** (1=All, 2=Exclude these, 3=No breakdowns), not score overwrite.
- Workspace dashboards: the "Saved Visualization" library reads `par_visualization`, not `pa_widgets`; the rendered title is `par_dashboard.name` (bridge: `pa_dashboards.experience_dashboard`, lazy-created on first view).
