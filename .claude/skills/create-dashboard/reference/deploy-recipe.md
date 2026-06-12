# PA deploy recipe — exact payloads (Table API, basic auth)

Every payload below deployed and verified live. Use deterministic naming; if this is a test build, prefix every `name` with your sentinel marker.

## 1. Cube — `pa_cubes`

The cube owns the facts table; on recent families `pa_indicators` has **no** `facts_table` column.

```json
POST /api/now/table/pa_cubes
{ "name": "<name>", "description": "<why>", "facts_table": "<table>",
  "frequency": "10", "calendar": "standard" }
```

One scripted indicator per cube (broadcast quirk — see traps). Aggregate indicators can share a cube.

## 2. Script row — `pa_scripts` (scripted indicators only)

The JS body lives HERE, not on the indicator. Shape: an IIFE returning a number; `table` must match the cube's `facts_table`.

```json
POST /api/now/table/pa_scripts
{ "name": "<mirror indicator name>", "script": "(function(){ /* GlideAggregate etc. */ return <number>; })()",
  "table": "<same facts_table>", "description": "<what it computes>" }
```

**GlideAggregate caution**: COUNT/SUM can silently cap at ~1k rows in scoped contexts on some release families (traps.md §6, `.team/LESSONS.md`). Any aggregate feeding a KPI or compliance number must be spot-checked against `GlideRecord` iteration on a dataset known to exceed 1k rows — a capped count looks healthy and is wrong.

## 3. Indicator — `pa_indicators`

```json
POST /api/now/table/pa_indicators
{ "name": "<name>", "cube": "<pa_cubes sys_id>",
  "frequency": "10", "direction": "3", "precision": "2",
  "aggregate": "1", "field": "", "conditions": "<encoded query>" }
```

- Scripted variant: add `"scripted": "true", "script": "<pa_scripts sys_id>"` (a REFERENCE — inline JS gets a 403 from the "PA Validate Indicator Script" BR).
- Aggregate codes (live `sys_choice`): 1=Count 2=Sum 3=Average 4=Minimum 5=Maximum 6=Count Distinct. Count ignores `field`; the rest need it.
- Frequency codes: 10=Daily 20=Weekly 30=Bi-weekly 35=4-Weeks 40=Monthly 50=Bi-Monthly 60=Quarterly 65=Fiscal quarterly 70=6-Months 80=Yearly 85=Fiscal yearly.
- Direction: 1=None 2=Minimize 3=Maximize.
- There is no `pa_indicators.active` on recent families — `pa_job_indicators.collect_indicator` decides what collects.
- **Immediately read back `sys_id,id`** — the integer `id` is the `pa_scores_l1` join key.
- UPDATEs that change `cube` or `frequency` are 403-rejected by "PA Validate Update Frequency and Source"; migrations go through god-mode `setWorkflow(false)` — gate on `getCapability('execute_script.available')=true`, else delete-and-recreate. INSERTs stay on plain REST so the platform mints the integer `id`.

## 4. Collection job — `sysauto_pa` + `pa_job_indicators`

```json
POST /api/now/table/sysauto_pa
{ "name": "<name>", "active": "true", "run_type": "periodically",
  "run_period": "1970-01-01 04:00:00", "run_start": "<today> 00:00:00",
  "run_dayofweek": "1", "run_dayofmonth": "1", "run_time": "1970-01-01 08:00:00",
  "collect": "scores", "advanced": "true",
  "score_operator": "relative",
  "score_relative_start": "30", "score_relative_start_interval": "days",
  "score_relative_end": "0", "score_relative_end_interval": "days",
  "score_fixed_start": "00000000", "score_fixed_end": "00000000" }
```

```json
POST /api/now/table/pa_job_indicators
{ "job": "<sysauto_pa sys_id>", "indicator": "<pa_indicators sys_id>",
  "active": "true", "collect_indicator": "true", "display": "<job> - <indicator>" }
```

Without the `pa_job_indicators` row the job runs and skips your indicator — scores stay empty with zero errors.

## 5. Force a collection run (the verified mechanism)

Direct `sys_trigger.next_action` PATCHes do NOT work: a BR snaps the value back to the job's schedule grid, and updating the job recreates the trigger row under a **new sys_id** (never cache trigger sys_ids). `SncTriggerSynchronizer.executeNow(job)` via script also produced no run on the probed family. What works:

**Read and record the job's current `run_period` BEFORE shrinking it** — the restore value comes from that read-back, not from this doc's example.

```json
PATCH /api/now/table/sysauto_pa/<job_sys_id>   { "run_period": "1970-01-01 00:01:00" }
```

The resynced trigger fires within ~1 minute. Then **restore the recorded period unconditionally — treat it as a `finally`**, not a success step: restore even if the forced run never appears, verification fails, or the session is being abandoned mid-way. A job left at 1-minute cadence keeps collecting every minute indefinitely, and nothing on the platform will ever flag it.

```json
PATCH /api/now/table/sysauto_pa/<job_sys_id>   { "run_period": "<recorded original, e.g. 1970-01-01 04:00:00>" }
```

Read back `run_period` after the restore to prove it landed.

Note: a brand-new job whose `run_start` is in the past fires once on creation within the next scheduler sweep — don't mistake that for your forced run.

## 6. Verify from evidence tables

```
GET /api/now/table/pa_job_logs?sysparm_query=job=<job_sys_id>^ORDERBYDESCsys_created_on&sysparm_fields=sys_created_on,state,inserts,updates,deletes&sysparm_limit=5
GET /api/now/table/pa_scores_l1?sysparm_query=indicator=<INTEGER id>^ORDERBYDESCstart_at&sysparm_fields=value,start_at&sysparm_limit=35
```

- Healthy run: `state=collected_ok`, `inserts` = periods × indicators in the window.
- Healthy RE-collection: `deletes` > 0 and `inserts` > 0 (`updates` stays 0 — PA replaces, it doesn't patch).
- Non-frozen proof: force a second run, assert the current-period `value` changed (use a time-varying probe script for sentinels).
- Other jobs (e.g. the OOTB Now Assist PA job, 15-min cadence) write `pa_job_logs` too — filter by YOUR job sys_id before celebrating.

## 7. Dashboard shell — `pa_dashboards`

```json
POST /api/now/table/pa_dashboards
{ "name": "<name>", "description": "<desc>", "active": "true" }
```

Then the Workspace boundary applies (see SKILL.md §3): compose widgets in the Platform Analytics Workspace UI; sync `par_dashboard.name` once `experience_dashboard` is populated.
