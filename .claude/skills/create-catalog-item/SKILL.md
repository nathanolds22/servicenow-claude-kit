---
name: create-catalog-item
description: Build a Service Catalog item end-to-end on the connected ServiceNow instance — category, orderable item, variables, verification. Use when asked to "create a catalog item", "add a service catalog request", "make an orderable item", "add catalog variables", or to wire a record producer's question set. MCP-first (create_catalog_category / create_catalog_item / create_catalog_item_variable) with Table API fallback.
---

# Create a Service Catalog item

Authoring order is fixed — each step references the previous one:

**catalog (lookup) → category → item → variables → audience → verify**

Variable sets and catalog UI policies come after the basics work; see [reference/variables-and-policies.md](reference/variables-and-policies.md).

## 0. Gate

`getCapability('catalog.read')` and (for authoring) `getCapability('catalog.writable')` must each return `true`. `unknown` → run `npm run probe:full` first, don't assume. Always go through `getCapability()` — never read the report JSON directly.

`catalog.writable` proves only `sc_cat_item` insert/delete. The plain Table-API PATCH steps below (`sc_category` binding, `item_option_new` type fixes, user-criteria m2m rows) additionally need `getCapability('table_api.write')=true` — don't infer one from the other.

## 1. Look up the catalog — never hard-code its sys_id

```
GET /api/now/table/sc_catalog?sysparm_query=title=Service Catalog&sysparm_fields=sys_id,title&sysparm_limit=2
```

(Limit 2, not 1 — a second row means the title is ambiguous on this instance; resolve that instead of taking the first hit.)

Even "well-known" OOTB sys_ids are a portability trap across instances; resolve by title once and reuse the sys_id within the session.

## 2. Category

`create_catalog_category` with `title` (+ `description`). **Trap (live-verified):** the MCP tool does not set `sc_category.sc_catalog` — the category lands unbound and will never appear in the portal hierarchy. PATCH it immediately:

```
PATCH /api/now/table/sc_category/<category_sys_id>   { "sc_catalog": "<catalog_sys_id>" }
```

## 3. Item

`create_catalog_item` with `name`, `short_description`, `category` (sys_id from step 2), `sc_catalogs` (sys_id from step 1). Setting `sc_catalogs` auto-maintains the `sc_cat_item_catalog` m2m — do **not** insert m2m rows by hand (and deleting the item cascade-deletes them).

## 4. Variables

`create_catalog_item_variable` with `catalog_item_id`, `name` (internal), `label`, `type`, `order` (gap-number: 100, 200, …), `mandatory`, `help_text`.

**Trap (live-verified):** the tool's `type` parameter is a friendly string with a partial mapping. An unmapped name (e.g. `boolean`) does **not** error — it silently lands as code 6 (Single Line Text). Always read back `item_option_new.type` and compare against the intended numeric code; PATCH the row if wrong. Full code table + live lookup query: [reference/variable-types.md](reference/variable-types.md).

Variables live on `item_option_new` (extends `question`): `question_text` is the user-facing label, `name` is the internal name fulfilment scripts read.

## 5. Audience — a new item is visible to EVERYONE who can browse the catalog

An item bound to a catalog with no user criteria is orderable by every portal user — there is no safe-by-default here. Decide the audience in the same change as the item, never "later":

- **Restrict** via user criteria m2m rows (table names + columns live-verified on a current family): `sc_cat_item_user_criteria_mtom` ("Available for") / `sc_cat_item_user_criteria_no_mtom` ("Not available for"), each row `{ "sc_cat_item": "<item_sys_id>", "user_criteria": "<user_criteria sys_id>" }`. Look up existing criteria on `user_criteria` by name before minting new ones — instances accumulate near-duplicates.
- **Intentionally public** is acceptable for genuinely all-staff items — record that decision in the change/PR description so a reviewer sees it was chosen, not forgotten.

Verify: `GET sc_cat_item_user_criteria_mtom?sysparm_query=sc_cat_item=<item_sys_id>&sysparm_fields=user_criteria&sysparm_limit=20` returns the rows you wrote, and an impersonated out-of-audience user cannot see the item in the portal.

## 6. Verify (never trust the writes)

- `get_catalog_item(<item_sys_id>)` — one call returns the item with category resolved and every variable with its type label. Assert: name, category, each variable's `type`, `mandatory`, `order`, `default_value`.
- `GET sc_category/<sys_id>?sysparm_fields=sc_catalog` — binding non-empty.
- `GET sc_cat_item_catalog?sysparm_query=sc_cat_item=<item_sys_id>&sysparm_limit=10` — exactly one row per catalog.
- Audience rows present (or the public choice recorded) per §5.

If this is a test/sentinel build: prefix every record name with your sentinel marker, delete in reverse order (variables → item → category), and prove zero leftovers with a query per touched table.
