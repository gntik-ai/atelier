import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import SwaggerParser from '@apidevtools/swagger-parser';

const CONTRACT_PATH = resolve('specs/118-export-conflict-prechecks/contracts/tenant-config-preflight.json');

let document;

test('tenant-config-preflight contract: is a valid OpenAPI document', async () => {
  document = await SwaggerParser.validate(CONTRACT_PATH);
  assert.ok(document);
  assert.equal(document.openapi, '3.1.0');
});

test('tenant-config-preflight contract: POST route exists', async () => {
  if (!document) document = await SwaggerParser.validate(CONTRACT_PATH);
  const path = document.paths['/v1/admin/tenants/{tenant_id}/config/reprovision/preflight'];
  assert.ok(path, 'Preflight route must exist');
  assert.ok(path.post, 'POST method must exist');
});

test('tenant-config-preflight contract: security scope declared', async () => {
  if (!document) document = await SwaggerParser.validate(CONTRACT_PATH);
  const securitySchemes = document.components?.securitySchemes;
  assert.ok(securitySchemes?.keycloak, 'keycloak security scheme must exist');
  const post = document.paths['/v1/admin/tenants/{tenant_id}/config/reprovision/preflight'].post;
  const security = post.security;
  assert.ok(security, 'security must be defined on POST');
  const kcScopes = security.find(s => s.keycloak);
  assert.ok(kcScopes, 'keycloak security must be present');
  assert.ok(kcScopes.keycloak.includes('platform:admin:config:reprovision'), 'scope must include reprovision');
});

test('tenant-config-preflight contract: required schemas exist', async () => {
  if (!document) document = await SwaggerParser.validate(CONTRACT_PATH);
  const schemas = document.components?.schemas;
  assert.ok(schemas.PreflightRequest, 'PreflightRequest schema must exist');
  assert.ok(schemas.PreflightReport, 'PreflightReport schema must exist');
  assert.ok(schemas.PreflightSummary, 'PreflightSummary schema must exist');
  assert.ok(schemas.DomainAnalysisResult, 'DomainAnalysisResult schema must exist');
  assert.ok(schemas.ConflictEntry, 'ConflictEntry schema must exist');
});

test('tenant-config-preflight contract: PreflightReport required fields', async () => {
  if (!document) document = await SwaggerParser.validate(CONTRACT_PATH);
  const required = document.components.schemas.PreflightReport.required;
  assert.ok(required.includes('correlation_id'));
  assert.ok(required.includes('source_tenant_id'));
  assert.ok(required.includes('target_tenant_id'));
  assert.ok(required.includes('analyzed_at'));
  assert.ok(required.includes('summary'));
  assert.ok(required.includes('domains'));
});

test('tenant-config-preflight contract: PreflightSummary required fields', async () => {
  if (!document) document = await SwaggerParser.validate(CONTRACT_PATH);
  const required = document.components.schemas.PreflightSummary.required;
  assert.ok(required.includes('risk_level'));
  assert.ok(required.includes('total_resources_analyzed'));
  assert.ok(required.includes('incomplete_analysis'));
});

test('tenant-config-preflight contract: ConflictEntry required fields', async () => {
  if (!document) document = await SwaggerParser.validate(CONTRACT_PATH);
  const required = document.components.schemas.ConflictEntry.required;
  assert.ok(required.includes('resource_type'));
  assert.ok(required.includes('resource_name'));
  assert.ok(required.includes('severity'));
  assert.ok(required.includes('recommendation'));
});
