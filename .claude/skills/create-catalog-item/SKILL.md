---
name: create-catalog-item
description: Build a Service Catalog item end-to-end on the connected ServiceNow instance — category, orderable item, variables, verification. Use when asked to "create a catalog item", "add a service catalog request", "make an orderable item", "add catalog variables", or to wire a record producer's question set. MCP-first (create_catalog_category / create_catalog_item / create_catalog_item_variable) with Table API fallback.
---

# Create a Service Catalog item

Authoring order is fixed — each step references the previous one:

**catalog (lookup) → category → item → variables → verify**

Variable sets and catalog UI policies come after the basics work; see [reference/variables-and-policies.md](reference/variables-and-policies.md).

## 0. Gate

`getCapability('catalog.read')` and (for authoring) `catalog.writable` must be `true`. `unknown` → run `npm run probe:full` first, don't assume.

## 1. Look up the catalog — never hard-code its sys_id

```
GET /api/now/table/sc_catalog?sysparm_query=title=Service Catalog&sysparm_fields=sys_id,title
```

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

## 5. Verify (never trust the writes)

- `get_catalog_item(<item_sys_id>)` — one call returns the item with category resolved and every variable with its type label. Assert: name, category, each variable's `type`, `mandatory`, `order`, `default_value`.
- `GET sc_category/<sys_id>?sysparm_fields=sc_catalog` — binding non-empty.
- `GET sc_cat_item_catalog?sysparm_query=sc_cat_item=<item_sys_id>` — exactly one row per catalog.

If this is a test/sentinel build: prefix every record name with your sentinel marker, delete in reverse order (variables → item → category), and prove zero leftovers with a query per touched table.
