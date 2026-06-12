# Variable sets and catalog UI policies (reference notes)

Status: doc-grounded notes (official docs mirror), **not yet live-validated by the kit** — confirm `getCapability('table_api.write')=true` before using these paths, read back every write, and promote anything surprising into the skill body. Claims below that are doc-only carry an inline **Verify first** instruction — run it on YOUR instance before building on the claim.

## Variable sets — reuse a question block across items

- Table: `item_option_new_set` (the set), `io_set_item` (m2m set↔item). Variables that belong to a set carry `variable_set=<set sys_id>` on `item_option_new` instead of `cat_item`.
- Two kinds: single-row (normal layout) and multi-row (grid; answers serialize to JSON on the generated request).
- Naming rules (docs): set internal names must be unique within an item, and a variable's name must not collide with a set's name/title — catalog client scripts and UI policies address the **internal name**.
- Order of operations: create the set → create variables with `variable_set` → m2m the set onto items via `io_set_item`.

## Catalog UI policies — declarative show/hide/mandatory, before client scripts

- Tables: `catalog_ui_policy` (header: `catalog_item` or `variable_set`, `catalog_conditions` — an encoded query over variables, `applies_to`), `catalog_ui_policy_action` (one row per affected variable: `catalog_variable` = `IO:<variable sys_id>`, plus `mandatory` / `visible` / `disabled` each `true`/`false`/`ignore`).
- The `IO:` prefix on `catalog_ui_policy_action.catalog_variable` is required — a bare sys_id silently matches nothing. **Verify first** (doc-only claim, read-only): `GET /api/now/table/catalog_ui_policy_action?sysparm_query=catalog_variableISNOTEMPTY&sysparm_fields=catalog_variable&sysparm_limit=3` and confirm OOTB rows on your instance actually carry the `IO:` prefix before authoring actions in that format.
- Prefer a UI policy over a catalog client script whenever the behaviour is "when X, show/require Y" — declarative, no script debugging, native reverse-on-false.
- Scope flags on the header (`applies_catalog`, `applies_req_item`, `applies_sc_task`) control where the policy runs (portal form vs generated RITM vs catalog task). **Verify first** (the Table-API defaults are doc-unstated and unverified): never rely on them — send all three flags explicitly on insert, then read all three back and assert they match what you sent.

## Ordering pitfall

Create variables BEFORE the UI policies that reference them; policy actions hold variable references that don't validate at insert time — a dangling action row just never fires.
