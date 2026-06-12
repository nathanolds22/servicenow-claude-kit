# 2026-06-12 — `sn_aia.agent_crud_available` false NO: orphaned probe sentinel vs unique `internal_name` index

## Symptom

`npm run probe:full` flipped `sn_aia.agent_crud_available` OK→NO between 12:09 and 12:39 UTC.
Table API POST to `sn_aia_agent` returned `403 {"error":{"message":"Operation Failed","detail":"Error during insert of sn_aia_agent (KIT_PROBE_DELETE_ME agent)"}}`.
Reproduced on two consecutive probe runs — looked like a genuine instance regression (ACL/role/plugin change).

## Hypotheses falsified

- **ACL / role change**: integration user still held `sn_aia.admin` + `sn_aia.integration`; zero `sn_aia*` ACL updates and zero role grants/revocations audited today.
- **Business-rule abort**: a god-mode script-path `GlideRecord.insert()` with a *different* sentinel name succeeded (and deleted) — BRs run on the script path too, so no BR was aborting inserts.
- **Plugin/app upgrade**: ~90 AI-related store apps were batch-updated at 10:23, but the 12:09 probe run inserted fine *after* that, so the upgrade window doesn't bracket the flip.

## Verified mechanism

`syslog` for the failing transaction shows the real error, swallowed by the generic 403:

```
java.sql.BatchUpdateException: Duplicate entry 'global.global.KIT_PROBE_DELETE_ME agent' for key 'internal_name'
```

- `sn_aia_agent` has a **unique DB index on `internal_name`**, auto-derived as `<scope>.<scope>.<name>`.
- An orphaned sentinel row (`c2ad3c3b2b99c3106b03fe886e91bf5f`, created 12:37:23, same integration user) was sitting in the table — a probe/build process was interrupted between its sentinel POST and DELETE (the probe had no crash-safe cleanup).
- Every subsequent insert of the fixed sentinel name then collided at the database layer → Table API 403 "Operation Failed" → **the probe DoS'd itself** and reported a false NO.

## Fix

1. Deleted the orphan (script path, read-back confirmed gone); REST insert/delete/read-back then passed 201/204/404 — capability is genuinely OK.
2. Hardened the probe: `cleanStraySentinels(table)` sweeps `KIT_PROBE_DELETE_ME*` rows before each sentinel insert (`table_api.write`, `sn_aia.agent_crud_available`, `catalog.writable`); success evidence records `strays_cleaned`; the sn_aia failure path now hints at the duplicate-internal_name cause.

## Retire-when

Permanent defence, not a workaround — interrupted `--full` runs will always be possible. If the platform ever drops the unique `internal_name` index the pre-clean is still correct (orphan hygiene).

## Reusable lesson

Distilled to [.team/LESSONS.md](../LESSONS.md) §"Table API and metadata writes": a Table-API 403 "Operation Failed / Error during insert" can be a **unique-index collision**, not ACL — read the `syslog` `FAILED TRYING TO EXECUTE` row for the underlying `BatchUpdateException` before debugging security.
