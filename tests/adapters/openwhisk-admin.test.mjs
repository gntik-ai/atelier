import test from 'node:test';
import assert from 'node:assert/strict';

import {
  OPENWHISK_ADMIN_CAPABILITY_MATRIX,
  OPENWHISK_MINIMUM_ENGINE_POLICY,
  SUPPORTED_OPENWHISK_VERSION_RANGES,
  buildOpenWhiskAdminAdapterCall,
  buildOpenWhiskAdminMetadataRecord,
  buildOpenWhiskInventorySnapshot,
  buildOpenWhiskServerlessContext,
  isOpenWhiskVersionSupported,
  normalizeOpenWhiskAdminError,
  normalizeOpenWhiskAdminResource,
  resolveOpenWhiskAdminProfile,
  validateOpenWhiskAdminRequest
} from '../../services/adapters/src/openwhisk-admin.mjs';

test('openwhisk admin adapter exports governed serverless capability and logical context baselines', () => {
  const growthProfile = resolveOpenWhiskAdminProfile({
    tenantId: 'ten_01growthalpha',
    workspaceId: 'wrk_01alphadev',
    workspaceSlug: 'alpha-dev',
    workspaceEnvironment: 'dev',
    planId: 'pln_01growth'
  });
  const enterpriseProfile = resolveOpenWhiskAdminProfile({
    tenantId: 'ten_01enterprisealpha',
    workspaceId: 'wrk_01alphaprod',
    workspaceSlug: 'alpha-prod',
    workspaceEnvironment: 'prod',
    planId: 'pln_01enterprise',
    providerVersion: '2.1.3'
  });

  assert.deepEqual(Object.keys(OPENWHISK_ADMIN_CAPABILITY_MATRIX), ['package', 'trigger', 'rule']);
  assert.deepEqual(OPENWHISK_ADMIN_CAPABILITY_MATRIX.package, ['list', 'get', 'create', 'update', 'delete']);
  assert.equal(SUPPORTED_OPENWHISK_VERSION_RANGES.length, 2);
  assert.equal(isOpenWhiskVersionSupported('2.0.9'), true);
  assert.equal(isOpenWhiskVersionSupported('2.1.3'), true);
  assert.equal(isOpenWhiskVersionSupported('1.26.0'), false);
  assert.equal(growthProfile.namespaceStrategy, 'logical_namespace_per_workspace');
  assert.equal(growthProfile.subjectProvisioning, 'internal_only');
  assert.equal(growthProfile.serverlessContext.namespaceName, 'ia-01growthalpha-alpha-dev-dev');
  assert.equal(growthProfile.serverlessContext.subjectRef, 'ia:01growthalpha:alpha-dev:dev');
  assert.equal(growthProfile.quotaGuardrails.maxPackagesPerWorkspace, 12);
  assert.equal(enterpriseProfile.quotaGuardrails.maxRulesPerWorkspace, 960);
  assert.equal(OPENWHISK_MINIMUM_ENGINE_POLICY.logical_namespace_subject.nativeAdminCrudExposed, false);
  assert.equal(OPENWHISK_MINIMUM_ENGINE_POLICY.logical_namespace_subject.forbiddenUserFields.includes('namespaceName'), true);
});

test('openwhisk admin adapter normalizes governed packages, triggers, and rules into workspace-safe resource shapes', () => {
  const pkg = normalizeOpenWhiskAdminResource(
    'package',
    {
      packageName: 'billing',
      visibility: 'workspace_shared',
      defaultParameters: { channel: 'billing' },
      annotations: { owner: 'finance' },
      actionCount: 2
    },
    {
      resourceId: 'res_01fnpkgbilling',
      tenantId: 'ten_01growthalpha',
      workspaceId: 'wrk_01alphadev',
      workspaceSlug: 'alpha-dev',
      workspaceEnvironment: 'dev',
      planId: 'pln_01growth'
    }
  );
  const trigger = normalizeOpenWhiskAdminResource(
    'trigger',
    {
      triggerName: 'billing-events',
      packageName: 'billing',
      sourceType: 'event_topic',
      sourceRef: 'topic:ia.01growthalpha.alpha.dev.dev.billing.events.v1'
    },
    {
      resourceId: 'res_01fntrgbilling',
      tenantId: 'ten_01growthalpha',
      workspaceId: 'wrk_01alphadev',
      workspaceSlug: 'alpha-dev',
      workspaceEnvironment: 'dev',
      planId: 'pln_01growth'
    }
  );
  const rule = normalizeOpenWhiskAdminResource(
    'rule',
    {
      ruleName: 'billing-dispatch',
      triggerName: 'billing-events',
      actionName: 'dispatch-billing',
      packageName: 'billing',
      activationState: 'active'
    },
    {
      resourceId: 'res_01fnrulebilling',
      tenantId: 'ten_01growthalpha',
      workspaceId: 'wrk_01alphadev',
      workspaceSlug: 'alpha-dev',
      workspaceEnvironment: 'dev',
      planId: 'pln_01growth'
    }
  );

  assert.equal(pkg.resourceType, 'function_package');
  assert.equal(pkg.physicalPackageName, 'pkg-alpha-dev-dev-billing');
  assert.equal(pkg.namespaceName, 'ia-01growthalpha-alpha-dev-dev');
  assert.equal(pkg.packageBindingRef, 'pkgctx:ia-01growthalpha-alpha-dev-dev');
  assert.equal(pkg.visibility, 'workspace_shared');

  assert.equal(trigger.resourceType, 'function_trigger');
  assert.equal(trigger.physicalTriggerName, 'trg-alpha-dev-dev-billing-events');
  assert.equal(trigger.sourceType, 'event_topic');
  assert.equal(trigger.tenantIsolation.crossTenantAccessPrevented, true);

  assert.equal(rule.resourceType, 'function_rule');
  assert.equal(rule.physicalRuleName, 'rul-alpha-dev-dev-billing-dispatch');
  assert.equal(rule.physicalTriggerName, 'trg-alpha-dev-dev-billing-events');
  assert.equal(rule.actionName, 'dispatch-billing');
  assert.equal(rule.providerCompatibility.provider, 'openwhisk');
});

test('openwhisk admin adapter blocks unsafe native admin fields and respects quota and reference guardrails', () => {
  const okValidation = validateOpenWhiskAdminRequest({
    resourceKind: 'trigger',
    action: 'create',
    context: {
      tenantId: 'ten_01growthalpha',
      workspaceId: 'wrk_01alphadev',
      workspaceSlug: 'alpha-dev',
      workspaceEnvironment: 'dev',
      planId: 'pln_01growth',
      currentInventory: {
        counts: {
          triggers: 4
        }
      }
    },
    payload: {
      triggerName: 'billing-events',
      packageName: 'billing',
      sourceType: 'event_topic',
      sourceRef: 'topic:ia.01growthalpha.alpha.dev.dev.billing.events.v1'
    }
  });
  const badValidation = validateOpenWhiskAdminRequest({
    resourceKind: 'package',
    action: 'create',
    context: {
      tenantId: 'ten_01growthalpha',
      workspaceId: 'wrk_01alphadev',
      workspaceSlug: 'alpha-dev',
      workspaceEnvironment: 'dev',
      planId: 'pln_01growth',
      providerVersion: '1.26.0',
      currentInventory: {
        counts: {
          packages: 12
        }
      }
    },
    payload: {
      packageName: 'pkg-alpha-dev-dev-billing',
      namespaceName: 'user-supplied-namespace',
      visibility: 'public'
    }
  });
  const badRule = validateOpenWhiskAdminRequest({
    resourceKind: 'rule',
    action: 'create',
    context: {
      tenantId: 'ten_01growthalpha',
      workspaceId: 'wrk_01alphadev',
      workspaceSlug: 'alpha-dev',
      workspaceEnvironment: 'dev',
      planId: 'pln_01growth'
    },
    payload: {
      ruleName: 'billing-dispatch',
      triggerName: 'billing-events',
      activationState: 'enabled'
    }
  });

  assert.equal(okValidation.ok, true);
  assert.deepEqual(okValidation.violations, []);

  assert.equal(badValidation.ok, false);
  assert.equal(
    badValidation.violations.includes('namespaceName is internal-only and cannot be supplied through the governed functions surface.'),
    true
  );
  assert.equal(
    badValidation.violations.includes('packageName must stay logical; the physical OpenWhisk package prefix is generated by the control plane.'),
    true
  );
  assert.equal(
    badValidation.violations.includes('visibility public is unsupported for governed OpenWhisk packages.'),
    true
  );
  assert.equal(
    badValidation.violations.includes('Quota workspace.functions.packages.max would be exceeded by creating another package.'),
    true
  );
  assert.equal(
    badValidation.violations.includes('OpenWhisk provider version 1.26.0 is outside the supported compatibility matrix.'),
    true
  );

  assert.equal(badRule.ok, false);
  assert.equal(badRule.violations.some((violation) => violation.includes('actionName is required')), true);
  assert.equal(badRule.violations.some((violation) => violation.includes('activationState enabled is unsupported')), true);
});

test('openwhisk admin adapter builds contract-rich adapter calls, metadata, inventory snapshots, and multi-tenant isolation projections', () => {
  const adapterCall = buildOpenWhiskAdminAdapterCall({
    resourceKind: 'package',
    action: 'create',
    callId: 'cmd_01fnowadmin',
    tenantId: 'ten_01growthalpha',
    workspaceId: 'wrk_01alphadev',
    planId: 'pln_01growth',
    correlationId: 'corr_01fnowadmin',
    authorizationDecisionId: 'authz_01fnowadmin',
    idempotencyKey: 'idem_fn_ow_admin_01',
    context: {
      resourceId: 'res_01fnpkgbilling',
      tenantId: 'ten_01growthalpha',
      workspaceId: 'wrk_01alphadev',
      workspaceSlug: 'alpha-dev',
      workspaceEnvironment: 'dev',
      planId: 'pln_01growth',
      providerVersion: '2.1.3'
    },
    payload: {
      packageName: 'billing',
      visibility: 'private',
      defaultParameters: { channel: 'billing' }
    },
    scopes: ['functions:admin'],
    effectiveRoles: ['workspace_admin'],
    actorId: 'usr_01alice',
    actorType: 'user',
    originSurface: 'control_api',
    requestedAt: '2026-03-25T13:00:00Z'
  });
  const metadata = buildOpenWhiskAdminMetadataRecord({
    resourceKind: 'package',
    action: 'create',
    resource: adapterCall.payload.normalizedResource,
    serverlessContext: adapterCall.payload.serverlessContext,
    namingPolicy: adapterCall.payload.namingPolicy,
    provisioningState: adapterCall.payload.provisioningState,
    auditSummary: adapterCall.payload.auditSummary,
    tenantId: 'ten_01growthalpha',
    workspaceId: 'wrk_01alphadev',
    observedAt: '2026-03-25T13:00:01Z'
  });
  const alphaInventory = buildOpenWhiskInventorySnapshot({
    snapshotId: 'snap_01fnalpha',
    tenantId: 'ten_01growthalpha',
    workspaceId: 'wrk_01alphadev',
    planId: 'pln_01growth',
    context: {
      workspaceSlug: 'alpha-dev',
      workspaceEnvironment: 'dev'
    },
    packages: [adapterCall.payload.normalizedResource],
    triggers: [
      normalizeOpenWhiskAdminResource(
        'trigger',
        {
          triggerName: 'billing-events',
          packageName: 'billing',
          sourceType: 'event_topic',
          sourceRef: 'topic:ia.01growthalpha.alpha.dev.dev.billing.events.v1'
        },
        {
          resourceId: 'res_01fntrgbilling',
          tenantId: 'ten_01growthalpha',
          workspaceId: 'wrk_01alphadev',
          workspaceSlug: 'alpha-dev',
          workspaceEnvironment: 'dev',
          planId: 'pln_01growth'
        }
      )
    ],
    rules: [
      normalizeOpenWhiskAdminResource(
        'rule',
        {
          ruleName: 'billing-dispatch',
          triggerName: 'billing-events',
          actionName: 'dispatch-billing',
          packageName: 'billing'
        },
        {
          resourceId: 'res_01fnrulebilling',
          tenantId: 'ten_01growthalpha',
          workspaceId: 'wrk_01alphadev',
          workspaceSlug: 'alpha-dev',
          workspaceEnvironment: 'dev',
          planId: 'pln_01growth'
        }
      )
    ],
    observedAt: '2026-03-25T13:00:01Z'
  });
  const betaContext = buildOpenWhiskServerlessContext({
    tenantId: 'ten_01growthbeta',
    workspaceId: 'wrk_01betadev',
    workspaceSlug: 'beta-dev',
    workspaceEnvironment: 'dev'
  });
  const betaInventory = buildOpenWhiskInventorySnapshot({
    snapshotId: 'snap_01fnbeta',
    tenantId: 'ten_01growthbeta',
    workspaceId: 'wrk_01betadev',
    planId: 'pln_01growth',
    context: {
      workspaceSlug: 'beta-dev',
      workspaceEnvironment: 'dev'
    },
    packages: [
      normalizeOpenWhiskAdminResource(
        'package',
        {
          packageName: 'catalog'
        },
        {
          resourceId: 'res_01fnpkgbeta',
          tenantId: 'ten_01growthbeta',
          workspaceId: 'wrk_01betadev',
          workspaceSlug: 'beta-dev',
          workspaceEnvironment: 'dev',
          planId: 'pln_01growth'
        }
      )
    ]
  });
  const error = normalizeOpenWhiskAdminError(
    {
      status: 422,
      message: 'OpenWhisk package quota exceeded.',
      providerError: 'namespace quota reached'
    },
    {
      resourceKind: 'package',
      action: 'create',
      targetRef: 'namespace:ia-01growthalpha-alpha-dev-dev/package:pkg-alpha-dev-dev-billing',
      namespaceName: 'ia-01growthalpha-alpha-dev-dev'
    }
  );

  assert.equal(adapterCall.adapter_id, 'openwhisk');
  assert.equal(adapterCall.contract_version, '2026-03-25');
  assert.equal(adapterCall.capability, 'openwhisk_package_create');
  assert.equal(adapterCall.target_ref, 'namespace:ia-01growthalpha-alpha-dev-dev/package:pkg-alpha-dev-dev-billing');
  assert.equal(adapterCall.payload.serverlessContext.namespaceName, 'ia-01growthalpha-alpha-dev-dev');
  assert.equal(adapterCall.payload.subjectBinding.exposure, 'internal_only');
  assert.equal(adapterCall.payload.provisioningState.nativeAdminCrudExposed, false);

  assert.equal(metadata.metadata.primaryRef, 'pkg-alpha-dev-dev-billing');
  assert.equal(metadata.metadata.namespaceName, 'ia-01growthalpha-alpha-dev-dev');

  assert.equal(alphaInventory.contractVersion, '2026-03-25');
  assert.equal(alphaInventory.counts.packages, 1);
  assert.equal(alphaInventory.counts.triggers, 1);
  assert.equal(alphaInventory.counts.rules, 1);
  assert.equal(alphaInventory.tenantIsolation.crossTenantAccessPrevented, true);
  assert.equal(alphaInventory.packageRefs[0], 'pkg-alpha-dev-dev-billing');

  assert.equal(betaContext.namespaceName, 'ia-01growthbeta-beta-dev-dev');
  assert.equal(betaInventory.serverlessContext.namespaceName, 'ia-01growthbeta-beta-dev-dev');
  assert.notEqual(alphaInventory.serverlessContext.namespaceName, betaInventory.serverlessContext.namespaceName);
  assert.notEqual(alphaInventory.serverlessContext.subjectRef, betaInventory.serverlessContext.subjectRef);
  assert.notEqual(alphaInventory.packageRefs[0], betaInventory.packageRefs[0]);

  assert.equal(error.code, 'FN_OW_QUOTA_EXCEEDED');
  assert.equal(error.retryable, false);
});
