# US-PGADM-04 — Gobernanza PostgreSQL declarativa, inventario ampliado y pruebas de seguridad

## Scope delivered

- PostgreSQL admin now covers declarative table-level RLS posture, bounded row-level-security policy management, and privilege grants across schema, table, sequence, and function targets.
- Workspace and database governance now include authorized extension enablement plus reusable database/schema onboarding templates.
- PostgreSQL metadata inventory now tracks sequences, table-security posture, policies, grants, extensions, templates, and documentation coverage in addition to the earlier structural objects.
- Database and schema resources now carry comment/documentation/template binding fields, while structural SQL planning now renders documentation-backed comments for tables, columns, indexes, views, materialized views, functions, and procedures.
- Reference resilience coverage now simulates Data API access decisions so effective grants and tenant RLS behavior stay testable before full runtime wiring lands.

## Contract changes

- OpenAPI bumped to `1.14.0` with PostgreSQL routes for table security, policies, grants, extensions, and templates.
- PostgreSQL component schemas now include `PostgresTableSecurity`, `PostgresPolicy`, `PostgresGrant`, `PostgresExtension`, `PostgresTemplate`, `PostgresTemplateBinding`, and expanded inventory reference models.
- Public route catalog and taxonomy now expose `postgres_table_security`, `postgres_policy`, `postgres_grant`, `postgres_extension`, and `postgres_template` resource families.
- Internal PostgreSQL adapter capabilities now advertise the new governance CRUD surface alongside the existing structural administration endpoints.

## Validation intent

- Keep RLS weakening guarded by explicit acknowledgements and prevent accidental disablement on tenant-scoped shared tables.
- Bound grants and policy expressions to a deterministic subset so later provider execution cannot smuggle arbitrary DDL or privilege escalation.
- Ensure extension activation remains allow-list driven and placement-aware.
- Preserve tenant-isolated Data API semantics by verifying both grants and RLS predicates in resilience coverage.
