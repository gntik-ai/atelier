import test from 'node:test';
import assert from 'node:assert/strict';

import {
  OPENWHISK_ACTION_SOURCE_KINDS,
  OPENWHISK_ADMIN_CAPABILITY_MATRIX,
  OPENWHISK_ALLOWED_ACTIVATION_STATUSES,
  OPENWHISK_MINIMUM_ENGINE_POLICY,
  OPENWHISK_SUPPORTED_ACTION_RUNTIMES,
  OPENWHISK_SUPPORTED_TRIGGER_KINDS,
  SUPPORTED_OPENWHISK_VERSION_RANGES,
  buildOpenWhiskActivationPolicy,
  buildOpenWhiskActivationProjection,
  buildOpenWhiskAdminAdapterCall,
  buildOpenWhiskAdminMetadataRecord,
  buildOpenWhiskCronTrigger,
  buildOpenWhiskFunctionRollbackAccepted,
  buildOpenWhiskFunctionVersion,
  buildOpenWhiskFunctionVersionCollection,
  buildOpenWhiskHttpExposure,
  buildOpenWhiskInventorySnapshot,
  buildOpenWhiskInvocationRequest,
  buildOpenWhiskRuntimeCoverageSummary,
  buildOpenWhiskServerlessContext,
  buildOpenWhiskStorageTrigger,
  isOpenWhiskVersionSupported,
  normalizeOpenWhiskAdminError,
  normalizeOpenWhiskAdminResource,
  resolveOpenWhiskAdminProfile,
  validateOpenWhiskAdminRequest,
  validateOpenWhiskFunctionRollback
} from '../../services/adapters/src/openwhisk-admin.mjs';

test('openwhisk admin adapter exports governed serverless capability, runtime, and logical context baselines', () => {
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

  assert.deepEqual(Object.keys(OPENWHISK_ADMIN_CAPABILITY_MATRIX), ['action', 'package', 'trigger', 'rule']);
  assert.deepEqual(OPENWHISK_ADMIN_CAPABILITY_MATRIX.action, ['list', 'get', 'create', 'update', 'delete', 'invoke']);
  assert.deepEqual(OPENWHISK_ACTION_SOURCE_KINDS, ['inline_code', 'packaged_artifact', 'stored_reference', 'runtime_image']);
  assert.deepEqual(OPENWHISK_SUPPORTED_TRIGGER_KINDS, ['http', 'kafka', 'storage', 'cron']);
  assert.equal(OPENWHISK_SUPPORTED_ACTION_RUNTIMES.some((entry) => entry.runtime === 'container:image'), true);
  assert.equal(SUPPORTED_OPENWHISK_VERSION_RANGES.length, 2);
  assert.equal(isOpenWhiskVersionSupported('2.0.9'), true);
  assert.equal(isOpenWhiskVersionSupported('2.1.3'), true);
  assert.equal(isOpenWhiskVersionSupported('1.26.0'), false);
  assert.equal(growthProfile.namespaceStrategy, 'logical_namespace_per_workspace');
  assert.equal(growthProfile.subjectProvisioning, 'internal_only');
  assert.equal(growthProfile.serverlessContext.namespaceName, 'ia-01growthalpha-alpha-dev-dev');
  assert.equal(growthProfile.serverlessContext.subjectRef, 'ia:01growthalpha:alpha-dev:dev');
  assert.equal(growthProfile.serverlessContext.actionPrefix, 'act-alpha-dev-dev');
  assert.equal(growthProfile.quotaGuardrails.maxActionsPerWorkspace, 24);
  assert.equal(growthProfile.quotaGuardrails.maxHttpExposuresPerWorkspace, 12);
  assert.equal(enterpriseProfile.quotaGuardrails.maxRulesPerWorkspace, 960);
  assert.equal(OPENWHISK_MINIMUM_ENGINE_POLICY.logical_namespace_subject.nativeAdminCrudExposed, false);
  assert.equal(OPENWHISK_MINIMUM_ENGINE_POLICY.logical_namespace_subject.forbiddenUserFields.includes('physicalActionName'), true);
});

test('openwhisk admin adapter normalizes governed actions, packages, triggers, and rules into workspace-safe resource shapes', () => {
  const action = normalizeOpenWhiskAdminResource(
    'action',
    {
      actionName: 'dispatch-billing',
      packageName: 'billing',
      source: {
        kind: 'inline_code',
        language: 'javascript',
        inlineCode: 'function main(params) { return params; }'
      },
      execution: {
        runtime: 'nodejs:20',
        entrypoint: 'main',
        parameters: { channel: 'billing' },
        environment: { LOG_LEVEL: 'info' },
        limits: { timeoutSeconds: 90, memoryMb: 256 },
        webAction: { enabled: true, requireAuthentication: true, rawHttpResponse: false }
      },
      activationPolicy: {
        logsAccess: 'workspace_developers',
        resultAccess: 'workspace_developers',
        rerunPolicy: 'manual_only',
        retentionHours: 72,
        redactionMode: 'metadata_only'
      },
      httpExposure: {
        authMode: 'workspace_token',
        methods: ['POST'],
        path: '/functions/dispatch-billing'
      },
      storageTriggers: [{ bucketRef: 'bucket:tenant-alpha/invoices', eventTypes: ['object_created'] }],
      cronTriggers: [{ schedule: '*/5 * * * *', timezone: 'UTC' }]
    },
    {
      resourceId: 'res_01fnactionbilling',
      tenantId: 'ten_01growthalpha',
      workspaceId: 'wrk_01alphadev',
      workspaceSlug: 'alpha-dev',
      workspaceEnvironment: 'dev',
      planId: 'pln_01growth'
    }
  );
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

  assert.equal(action.resourceType, 'function_action');
  assert.equal(action.physicalActionName, 'act-alpha-dev-dev-dispatch-billing');
  assert.equal(action.namespaceName, 'ia-01growthalpha-alpha-dev-dev');
  assert.equal(action.execution.runtime, 'nodejs:20');
  assert.equal(action.httpExposure.apisixRouteRef, 'apisix:functions:dispatch-billing');
  assert.equal(action.storageTriggers[0].deliveryMode, 'managed_bridge');
  assert.equal(action.cronTriggers[0].overlapPolicy, 'skip');
  assert.equal(action.activationPolicy.retentionHours, 72);

  assert.equal(pkg.resourceType, 'function_package');
  assert.equal(pkg.physicalPackageName, 'pkg-alpha-dev-dev-billing');
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

test('openwhisk admin adapter blocks unsafe native admin fields and respects quota, runtime, and source guardrails', () => {
  const okValidation = validateOpenWhiskAdminRequest({
    resourceKind: 'action',
    action: 'create',
    context: {
      tenantId: 'ten_01growthalpha',
      workspaceId: 'wrk_01alphadev',
      workspaceSlug: 'alpha-dev',
      workspaceEnvironment: 'dev',
      planId: 'pln_01growth',
      currentInventory: {
        counts: {
          actions: 4,
          httpExposures: 1
        }
      }
    },
    payload: {
      actionName: 'dispatch-billing',
      source: {
        kind: 'inline_code',
        language: 'javascript',
        inlineCode: 'function main(params) { return params; }'
      },
      execution: {
        runtime: 'nodejs:20',
        entrypoint: 'main',
        parameters: {},
        environment: { LOG_LEVEL: 'info' },
        limits: { timeoutSeconds: 90, memoryMb: 256 },
        webAction: { enabled: true, requireAuthentication: true, rawHttpResponse: false }
      },
      activationPolicy: buildOpenWhiskActivationPolicy()
    }
  });
  const badValidation = validateOpenWhiskAdminRequest({
    resourceKind: 'action',
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
          actions: 24
        }
      }
    },
    payload: {
      actionName: 'act-alpha-dev-dev-billing',
      namespaceName: 'user-supplied-namespace',
      source: {
        kind: 'runtime_image',
        imageRef: 'ghcr.io/example/billing:latest'
      },
      execution: {
        runtime: 'nodejs:20',
        entrypoint: 'main',
        parameters: {},
        environment: {},
        limits: { timeoutSeconds: 901, memoryMb: 4096 },
        webAction: { enabled: true, requireAuthentication: true, rawHttpResponse: false }
      },
      activationPolicy: {
        logsAccess: 'disabled',
        resultAccess: 'workspace_developers'
      }
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
    badValidation.violations.includes('actionName must stay logical; the physical OpenWhisk action prefix is generated by the control plane.'),
    true
  );
  assert.equal(
    badValidation.violations.includes('Quota workspace.functions.actions.max would be exceeded by creating another action.'),
    true
  );
  assert.equal(
    badValidation.violations.includes('runtime nodejs:20 does not support source kind runtime_image.'),
    true
  );
  assert.equal(
    badValidation.violations.includes('timeoutSeconds must be 900 seconds or lower for governed OpenWhisk actions.'),
    true
  );
  assert.equal(
    badValidation.violations.includes('memoryMb must be 2048 MB or lower for governed OpenWhisk actions.'),
    true
  );
  assert.equal(
    badValidation.violations.includes('resultAccess cannot remain enabled when logsAccess is disabled for the governed activation policy.'),
    true
  );
  assert.equal(
    badValidation.violations.includes('OpenWhisk provider version 1.26.0 is outside the supported compatibility matrix.'),
    true
  );
});

test('openwhisk admin adapter builds contract-rich adapter calls, metadata, inventory snapshots, and execution projections', () => {
  const adapterCall = buildOpenWhiskAdminAdapterCall({
    resourceKind: 'action',
    action: 'create',
    callId: 'cmd_01fnowadmin',
    tenantId: 'ten_01growthalpha',
    workspaceId: 'wrk_01alphadev',
    planId: 'pln_01growth',
    correlationId: 'corr_01fnowadmin',
    authorizationDecisionId: 'authz_01fnowadmin',
    idempotencyKey: 'idem_fn_ow_admin_01',
    context: {
      resourceId: 'res_01fnactionbilling',
      tenantId: 'ten_01growthalpha',
      workspaceId: 'wrk_01alphadev',
      workspaceSlug: 'alpha-dev',
      workspaceEnvironment: 'dev',
      planId: 'pln_01growth',
      providerVersion: '2.1.3'
    },
    payload: {
      actionName: 'dispatch-billing',
      packageName: 'billing',
      source: {
        kind: 'inline_code',
        language: 'javascript',
        inlineCode: 'function main(params) { return params; }'
      },
      execution: {
        runtime: 'nodejs:20',
        entrypoint: 'main',
        parameters: { channel: 'billing' },
        environment: { LOG_LEVEL: 'info' },
        limits: { timeoutSeconds: 90, memoryMb: 256 },
        webAction: { enabled: true, requireAuthentication: true, rawHttpResponse: false }
      },
      activationPolicy: buildOpenWhiskActivationPolicy(),
      httpExposure: {
        authMode: 'workspace_token',
        methods: ['POST'],
        path: '/functions/dispatch-billing'
      }
    },
    scopes: ['functions:admin'],
    effectiveRoles: ['workspace_admin'],
    actorId: 'usr_01alice',
    actorType: 'user',
    originSurface: 'control_api',
    requestedAt: '2026-03-25T13:00:00Z'
  });
  const metadata = buildOpenWhiskAdminMetadataRecord({
    resourceKind: 'action',
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
  const exposure = buildOpenWhiskHttpExposure({ authMode: 'workspace_token', methods: ['POST'], path: '/functions/dispatch-billing' }, { actionName: 'dispatch-billing' });
  const alphaInventory = buildOpenWhiskInventorySnapshot({
    snapshotId: 'snap_01fnalpha',
    tenantId: 'ten_01growthalpha',
    workspaceId: 'wrk_01alphadev',
    planId: 'pln_01growth',
    context: {
      workspaceSlug: 'alpha-dev',
      workspaceEnvironment: 'dev'
    },
    actions: [adapterCall.payload.normalizedResource],
    packages: [
      normalizeOpenWhiskAdminResource(
        'package',
        {
          packageName: 'billing',
          visibility: 'private'
        },
        {
          resourceId: 'res_01fnpkgbilling',
          tenantId: 'ten_01growthalpha',
          workspaceId: 'wrk_01alphadev',
          workspaceSlug: 'alpha-dev',
          workspaceEnvironment: 'dev',
          planId: 'pln_01growth'
        }
      )
    ],
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
    httpExposures: [exposure],
    observedAt: '2026-03-25T13:00:01Z'
  });
  const invocation = buildOpenWhiskInvocationRequest({}, { resourceId: 'res_01fnactionbilling', actionName: 'dispatch-billing', activationPolicy: buildOpenWhiskActivationPolicy() });
  const activation = buildOpenWhiskActivationProjection({ invocationId: invocation.invocationId, triggerKind: 'http', status: 'succeeded', durationMs: 34 }, { resourceId: 'res_01fnactionbilling', actionName: 'dispatch-billing', activationPolicy: buildOpenWhiskActivationPolicy() });
  const error = normalizeOpenWhiskAdminError(
    {
      status: 422,
      message: 'OpenWhisk action quota exceeded.',
      providerError: 'namespace quota reached'
    },
    {
      resourceKind: 'action',
      action: 'create',
      targetRef: 'namespace:ia-01growthalpha-alpha-dev-dev/action:act-alpha-dev-dev-dispatch-billing',
      namespaceName: 'ia-01growthalpha-alpha-dev-dev'
    }
  );

  assert.equal(adapterCall.adapter_id, 'openwhisk');
  assert.equal(adapterCall.contract_version, '2026-03-25');
  assert.equal(adapterCall.capability, 'openwhisk_action_create');
  assert.equal(adapterCall.target_ref, 'namespace:ia-01growthalpha-alpha-dev-dev/action:act-alpha-dev-dev-dispatch-billing');
  assert.equal(adapterCall.payload.serverlessContext.namespaceName, 'ia-01growthalpha-alpha-dev-dev');
  assert.equal(adapterCall.payload.subjectBinding.exposure, 'internal_only');
  assert.equal(adapterCall.payload.provisioningState.nativeAdminCrudExposed, false);

  assert.equal(metadata.metadata.primaryRef, 'act-alpha-dev-dev-dispatch-billing');
  assert.equal(metadata.metadata.namespaceName, 'ia-01growthalpha-alpha-dev-dev');

  assert.equal(alphaInventory.contractVersion, '2026-03-25');
  assert.equal(alphaInventory.counts.actions, 1);
  assert.equal(alphaInventory.counts.packages, 1);
  assert.equal(alphaInventory.counts.triggers, 1);
  assert.equal(alphaInventory.counts.rules, 1);
  assert.equal(alphaInventory.counts.httpExposures, 1);
  assert.equal(alphaInventory.tenantIsolation.crossTenantAccessPrevented, true);
  assert.equal(alphaInventory.actionRefs[0], 'act-alpha-dev-dev-dispatch-billing');
  assert.equal(alphaInventory.httpExposureRefs[0], 'apisix:functions:dispatch-billing');

  assert.equal(invocation.status, 'accepted');
  assert.equal(activation.status, 'succeeded');
  assert.equal(activation.triggerKind, 'http');
  assert.equal(activation.policy.rerunPolicy, 'manual_only');

  assert.equal(error.code, 'FN_OW_QUOTA_EXCEEDED');
  assert.equal(error.retryable, false);
});

test('openwhisk execution helpers preserve activation policy, trigger constraints, and supported runtime coverage', () => {
  const activationPolicy = buildOpenWhiskActivationPolicy({ retentionHours: 24, rerunPolicy: 'idempotent_only' });
  const httpExposure = buildOpenWhiskHttpExposure({ authMode: 'signed_url', methods: ['GET', 'POST'] }, { actionName: 'image-resizer' });
  const storageTrigger = buildOpenWhiskStorageTrigger({ bucketRef: 'bucket:tenant-alpha/assets', eventTypes: ['object_created', 'object_deleted'] }, { resourceId: 'res_01fnimg' });
  const cronTrigger = buildOpenWhiskCronTrigger({ schedule: '0 * * * *', timezone: 'Europe/Madrid', overlapPolicy: 'queue_one' }, { resourceId: 'res_01fnimg' });
  const runtimeCoverage = buildOpenWhiskRuntimeCoverageSummary();
  const context = buildOpenWhiskServerlessContext({
    tenantId: 'ten_01growthalpha',
    workspaceId: 'wrk_01alphadev',
    workspaceSlug: 'alpha-dev',
    workspaceEnvironment: 'dev'
  });

  assert.equal(activationPolicy.retentionHours, 24);
  assert.equal(httpExposure.authMode, 'signed_url');
  assert.deepEqual(httpExposure.methods, ['GET', 'POST']);
  assert.deepEqual(storageTrigger.eventTypes, ['object_created', 'object_deleted']);
  assert.equal(cronTrigger.overlapPolicy, 'queue_one');
  assert.equal(runtimeCoverage.find((entry) => entry.runtime === 'nodejs:20').webActionSupported, true);
  assert.equal(runtimeCoverage.find((entry) => entry.runtime === 'go:1.22').sourceKinds.includes('inline_code'), false);
  assert.equal(context.namingPolicy.actionPrefix, 'act-alpha-dev-dev');
  assert.equal(OPENWHISK_ALLOWED_ACTIVATION_STATUSES.includes('timed_out'), true);
});

test('openwhisk lifecycle helpers build immutable function versions and accepted rollback envelopes', () => {
  const version = buildOpenWhiskFunctionVersion(
    {
      actionName: 'dispatch-billing',
      versionNumber: 3,
      status: 'rollback_target',
      rollbackEligible: true,
      deploymentDigest: 'sha256:abcdef1234567890',
      source: {
        kind: 'inline_code',
        language: 'javascript',
        inlineCode: 'function main(params) { return params; }'
      },
      execution: {
        runtime: 'nodejs:20',
        entrypoint: 'main',
        parameters: { channel: 'billing' },
        environment: { LOG_LEVEL: 'info' },
        limits: { timeoutSeconds: 90, memoryMb: 256 },
        webAction: { enabled: false, requireAuthentication: true, rawHttpResponse: false }
      },
      activationPolicy: buildOpenWhiskActivationPolicy({ retentionHours: 72 }),
      timestamps: {
        createdAt: '2026-03-27T10:00:00Z',
        updatedAt: '2026-03-27T10:00:00Z'
      }
    },
    {
      resourceId: 'res_01fnactionbilling',
      tenantId: 'ten_01growthalpha',
      workspaceId: 'wrk_01alphadev',
      workspaceSlug: 'alpha-dev',
      workspaceEnvironment: 'dev',
      planId: 'pln_01growth'
    }
  );
  const collection = buildOpenWhiskFunctionVersionCollection({ items: [version], size: 1 });
  const accepted = buildOpenWhiskFunctionRollbackAccepted(
    {
      versionId: version.versionId,
      requestId: 'request-rollback-01',
      correlationId: 'corr-rollback-01',
      acceptedAt: '2026-03-27T10:05:00Z'
    },
    {
      resourceId: 'res_01fnactionbilling'
    }
  );

  assert.match(version.versionId, /^fnv_[0-9a-z]+$/);
  assert.equal(version.resourceId, 'res_01fnactionbilling');
  assert.equal(version.versionNumber, 3);
  assert.equal(version.status, 'rollback_target');
  assert.equal(version.rollbackEligible, true);
  assert.equal(version.execution.runtime, 'nodejs:20');
  assert.equal(collection.page.size, 1);
  assert.equal(collection.items[0].versionId, version.versionId);
  assert.equal(accepted.resourceId, 'res_01fnactionbilling');
  assert.equal(accepted.requestedVersionId, version.versionId);
  assert.equal(accepted.status, 'accepted');
});

test('openwhisk lifecycle helpers reject rollback requests that are unauthorized, cross-scope, ineligible, or already active', () => {
  const invalidRollback = validateOpenWhiskFunctionRollback({
    context: {
      tenantId: 'ten_01growthalpha',
      workspaceId: 'wrk_01alphadev',
      workspaceSlug: 'alpha-dev',
      workspaceEnvironment: 'dev',
      planId: 'pln_01growth',
      resourceId: 'res_01fnactionbilling',
      activeVersionId: 'fnv_activeversion01',
      authorized: false,
      availableVersions: [{ versionId: 'fnv_activeversion01' }],
      targetVersion: {
        versionId: 'fnv_activeversion01',
        resourceId: 'res_otheraction01',
        tenantId: 'ten_01othertenant',
        workspaceId: 'wrk_01otherworkspace',
        status: 'active',
        rollbackEligible: false
      }
    },
    payload: {
      versionId: 'bad-version-id'
    }
  });

  assert.equal(invalidRollback.ok, false);
  assert.equal(
    invalidRollback.violations.includes('versionId must use the governed function version identifier format.'),
    true
  );
  assert.equal(
    invalidRollback.violations.includes('caller is not authorized to roll back this governed function action.'),
    true
  );
  assert.equal(
    invalidRollback.violations.includes('rollback target must belong to the same governed function action resource.'),
    true
  );
  assert.equal(
    invalidRollback.violations.includes('rollback target must stay within the caller tenant scope.'),
    true
  );
  assert.equal(
    invalidRollback.violations.includes('rollback target must stay within the caller workspace scope.'),
    true
  );
  assert.equal(
    invalidRollback.violations.includes('rollback target is already the active function version.'),
    true
  );
  assert.equal(
    invalidRollback.violations.includes('rollback target is not eligible for restore.'),
    true
  );
});
