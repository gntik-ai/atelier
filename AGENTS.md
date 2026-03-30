# atelier Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-03-30

## Active Technologies
- Node.js 20+ (ESM modules), aligned with existing project standard (072-workflow-e2e-compensation)
- PostgreSQL (relational workflow/audit data), MongoDB (document state) (072-workflow-e2e-compensation)
- Node.js 20+ compatible ESM modules, JSON OpenAPI artifacts, Markdown planning assets + Node built-in `node:test`, existing public API contract generation/validation scripts, existing governed OpenWhisk helper modules (001-function-versioning-rollback)
- PostgreSQL access via `pg`, Kafka publication via `kafkajs`, OpenWhisk action wrappers for async operation lifecycle (073-async-job-status-model)

## Project Structure

```text
src/
tests/
services/provisioning-orchestrator/src/{models,repositories,events,actions,migrations}
```

## Commands

# Add commands for Node.js 20+ compatible ESM modules, JSON OpenAPI artifacts, Markdown planning assets

## Code Style

Node.js 20+ compatible ESM modules, JSON OpenAPI artifacts, Markdown planning assets: Follow standard conventions

## Recent Changes
- 073-async-job-status-model: Added async operation domain model, PostgreSQL persistence, Kafka event contract, and OpenWhisk action wrappers
- 072-workflow-e2e-compensation: Added Node.js 20+ (ESM modules), aligned with existing project standard
- 001-function-versioning-rollback: Added Node.js 20+ compatible ESM modules, JSON OpenAPI artifacts, Markdown planning assets + Node built-in `node:test`, existing public API contract generation/validation scripts, existing governed OpenWhisk helper modules

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
