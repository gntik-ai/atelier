import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  OBSERVABILITY_QUOTA_USAGE_VIEW_VERSION,
  getProvisioningComponent,
  getProvisioningStateSummary,
  getQuotaUsageViewAccessAuditContract,
  getQuotaUsageViewScope,
  getQuotaUsageVisualState,
  listProvisioningComponents,
  listProvisioningStateSummaries,
  listQuotaUsageViewScopes,
  listQuotaUsageVisualStates,
  readPublicApiTaxonomy,
  readPublicRouteCatalog
} from '../../services/internal-contracts/src/index.mjs';
import {
  collectObservabilityQuotaUsageViewViolations,
  readObservabilityQuotaPolicies,
  readObservabilityQuotaUsageView,
  readObservabilityUsageConsumption
} from '../../scripts/lib/observability-quota-usage-view.mjs';

test('quota usage view readers and accessors expose the published contract', () => {
  const contract = readObservabilityQuotaUsageView();

  assert.equal(OBSERVABILITY_QUOTA_USAGE_VIEW_VERSION, '2026-03-28');
  assert.equal(contract.version, '2026-03-28');
  assert.equal(listQuotaUsageViewScopes().length, 2);
  assert.equal(getQuotaUsageViewScope('tenant_overview').required_permission, 'tenant.overview.read');
  assert.equal(listQuotaUsageVisualStates().some((state) => state.id === 'critical'), true);
  assert.equal(getQuotaUsageVisualState('warning').id, 'warning');
  assert.equal(listProvisioningStateSummaries().some((state) => state.id === 'degraded'), true);
  assert.equal(getProvisioningStateSummary('active').visual_state, 'healthy');
  assert.equal(listProvisioningComponents().some((component) => component.id === 'messaging'), true);
  assert.equal(getProvisioningComponent('storage').display_name, 'Storage');
  assert.equal(getQuotaUsageViewAccessAuditContract().event_type, 'quota.overview.read');
});

test('quota usage view contract stays aligned with routes, resource taxonomy, and upstream dimensions', () => {
  const contract = readObservabilityQuotaUsageView();
  const usage = readObservabilityUsageConsumption();
  const quota = readObservabilityQuotaPolicies();
  const routeCatalog = readPublicRouteCatalog();
  const taxonomy = readPublicApiTaxonomy();
  const violations = collectObservabilityQuotaUsageViewViolations(contract);

  assert.deepEqual(violations, []);
  assert.equal(contract.source_usage_contract, usage.version);
  assert.equal(contract.source_quota_policy_contract, quota.version);
  assert.equal(routeCatalog.routes.some((route) => route.operationId === 'getTenantQuotaUsageOverview'), true);
  assert.equal(routeCatalog.routes.some((route) => route.operationId === 'getWorkspaceQuotaUsageOverview'), true);
  assert.equal(taxonomy.resource_taxonomy.some((entry) => entry.resource_type === 'tenant_quota_usage_view'), true);
  assert.equal(taxonomy.resource_taxonomy.some((entry) => entry.resource_type === 'workspace_quota_usage_view'), true);
});

test('quota usage view docs and task summaries remain discoverable', () => {
  const architectureIndex = readFileSync(new URL('../../docs/reference/architecture/README.md', import.meta.url), 'utf8');
  const taskSummary = readFileSync(new URL('../../docs/tasks/us-obs-03.md', import.meta.url), 'utf8');

  assert.match(architectureIndex, /observability-quota-usage-view\.json/);
  assert.match(architectureIndex, /observability-quota-usage-view\.md/);
  assert.match(taskSummary, /US-OBS-03-T05/);
  assert.match(taskSummary, /quota-usage overview/i);
});
