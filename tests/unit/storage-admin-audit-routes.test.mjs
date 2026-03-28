import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STORAGE_AUDIT_COVERAGE_CATEGORIES,
  STORAGE_AUDIT_COVERAGE_CATEGORY_CATALOG,
  STORAGE_AUDIT_ERROR_CATALOG,
  STORAGE_AUDIT_OPERATION_CATEGORIES,
  STORAGE_AUDIT_OPERATION_CATEGORY_CATALOG,
  STORAGE_AUDIT_OPERATION_TYPES,
  STORAGE_AUDIT_OPERATION_TYPE_CATALOG,
  STORAGE_AUDIT_TOPIC,
  STORAGE_AUDIT_TOPIC_CATALOG,
  getStorageAdminRoute,
  listStorageAdminRoutes,
  listStorageAuditRoutes
} from '../../apps/control-plane/src/storage-admin.mjs';

test('storage admin re-exports the storage audit catalogs without mutation', () => {
  assert.equal(STORAGE_AUDIT_TOPIC_CATALOG, STORAGE_AUDIT_TOPIC);
  assert.equal(STORAGE_AUDIT_OPERATION_CATEGORY_CATALOG, STORAGE_AUDIT_OPERATION_CATEGORIES);
  assert.equal(STORAGE_AUDIT_OPERATION_TYPE_CATALOG, STORAGE_AUDIT_OPERATION_TYPES);
  assert.equal(STORAGE_AUDIT_COVERAGE_CATEGORY_CATALOG, STORAGE_AUDIT_COVERAGE_CATEGORIES);
  assert.equal(Object.isFrozen(STORAGE_AUDIT_ERROR_CATALOG), true);
});

test('storage admin exposes audit routes and keeps them discoverable through the aggregate route list', () => {
  const auditRoutes = listStorageAuditRoutes();
  const allRoutes = listStorageAdminRoutes();
  const trailRoute = getStorageAdminRoute('listStorageAuditTrail');
  const coverageRoute = getStorageAdminRoute('getStorageAuditCoverage');

  assert.deepEqual(auditRoutes.map((route) => route.operationId), ['listStorageAuditTrail', 'getStorageAuditCoverage']);
  assert.equal(allRoutes.some((route) => route.operationId === 'listStorageAuditTrail'), true);
  assert.equal(allRoutes.some((route) => route.operationId === 'getStorageAuditCoverage'), true);
  assert.equal(trailRoute.resourceType, 'storage_audit_event');
  assert.equal(coverageRoute.resourceType, 'storage_audit_coverage_report');
});
