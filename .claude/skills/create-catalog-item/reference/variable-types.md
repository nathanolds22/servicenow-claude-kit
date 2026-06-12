# Catalog variable type codes (`item_option_new.type`)

`item_option_new` extends `question`, and the `type` choice list lives on the **parent** table — query `sys_choice` with `name=question`, not `name=item_option_new` (the latter returns zero rows; live-verified):

```
GET /api/now/table/sys_choice?sysparm_query=name=question^element=type^inactive=false&sysparm_fields=value,label&sysparm_limit=100
```

Codes as read live from a current-family instance (re-run the query on yours before trusting an exotic one):

| Code | Label | Code | Label |
|---|---|---|---|
| 1 | Yes / No | 16 | Wide Single Line Text |
| 2 | Multi Line Text | 17 | Custom with Label |
| 3 | Multiple Choice | 18 | Lookup Select Box |
| 4 | Numeric Scale | 19 | Container Start |
| 5 | Select Box | 20 | Container End |
| 6 | Single Line Text | 21 | List Collector |
| 7 | CheckBox | 22 | Lookup Multiple Choice |
| 8 | Reference | 23 | HTML |
| 9 | Date | 24 | Container Split |
| 10 | Date/Time | 25 | Masked |
| 11 | Label | 26 | Email |
| 12 | Break | 27 | URL |
| 14 | Custom | 28 | IP Address |
| 15 | UI Page | 29 | Duration |
| | | 31 | Requested For |
| | | 32 | Rich Text Label |
| | | 33 | Attachment |

## Type-specific column wiring

- **Reference (8)**: the target table goes in `reference`; filter in `reference_qual` (encoded query) with `use_reference_qualifier=advanced` for scripted qualifiers.
- **Lookup Select Box (18) / Lookup Multiple Choice (22)**: driven by `lookup_table` + `lookup_value` / `lookup_label` — a different column set from Reference; don't mix them up.
- **Select Box (5) / Multiple Choice (3)**: each option is a `question_choice` row (`question` = the variable's sys_id, `text` = label, `value` = stored value, `order`). Create them after the variable; delete them with it.
- **CheckBox (7)**: `default_value` is the string `"true"`/`"false"`.
- **List Collector (21)**: `list_table` holds the source table.

## The MCP `type` parameter trap (live-verified)

`create_catalog_item_variable` accepts a friendly type string and maps it to a code. The mapping is **partial and unvalidated**: a name it doesn't recognise lands silently as code 6 (Single Line Text) — no error, no warning. Observed live: `type: "boolean"` → landed `type=6`; PATCHing `{ "type": "7" }` on the `item_option_new` row fixed it.

Rule: after creating any non-string variable, read back the row and assert the numeric `type`. Cheaper than debugging why the portal renders a text box where a checkbox should be.
