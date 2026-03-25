# US-MGDATA-02 — MongoDB Data API advanced operations

## Scope

Extend the MongoDB Data API surface introduced in US-MGDATA-01 with:

- controlled aggregation pipelines
- JSON import and export contracts
- topology-aware multi-collection transactions
- change-stream bridge registration for the realtime/event gateway

## Delivered increment

### Contract and service map

- Extended `mongo_data_request` / `mongo_data_result` so advanced planner metadata is explicit and additive.
- Published new MongoDB adapter capabilities for aggregation, import, export, transactions, and change streams.
- Extended the Mongo interaction flow to describe topology-aware advanced data operations and event-gateway delivery.

### Public API

Added five new Mongo routes:

- `aggregateMongoDataDocuments`
- `importMongoDataDocuments`
- `exportMongoDataDocuments`
- `executeMongoDataTransaction`
- `createMongoDataChangeStream`

New resource types:

- `mongo_data_aggregation`
- `mongo_data_import`
- `mongo_data_export`
- `mongo_data_transaction`
- `mongo_data_change_stream`

### Planner / adapter safeguards

- Aggregation stage allowlist with blocked write-style stages.
- Import/export size and document-count ceilings.
- Transaction limits, tenant scoping, collection validation, and unique-index conflict detection.
- Change-stream compatibility checks for topology and realtime bridge availability.

### Documentation and validation

- Expanded MongoDB Data API reference docs.
- Added unit, adapter, contract, admin-compatibility, and resilience coverage for the new surface.

## Known risk carried forward

US-DX-01 is still pending, so change streams stop at a normalized bridge-ready contract plus compatibility reporting. Delivery semantics beyond that bridge contract remain dependent on the downstream realtime implementation.
