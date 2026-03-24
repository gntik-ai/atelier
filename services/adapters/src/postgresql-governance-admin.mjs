const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;
const RESERVED_PREFIX_PATTERN = /^pg_/;
const UNSAFE_EXPRESSION_PATTERN = /(;|\b(alter|drop|grant|revoke|copy|do|create\s+(role|database|schema)|comment\s+on|security\s+definer)\b)/i;

export const POSTGRES_GOVERNANCE_RESOURCE_KINDS = Object.freeze([
  'table_security',
  'policy',
  'grant',
  'extension',
  'template'
]);
export const POSTGRES_POLICY_COMMANDS = Object.freeze(['all', 'select', 'insert', 'update', 'delete']);
export const POSTGRES_POLICY_MODES = Object.freeze(['permissive', 'restrictive']);
export const POSTGRES_GRANT_TARGET_TYPES = Object.freeze(['schema', 'table', 'sequence', 'function']);
export const POSTGRES_TEMPLATE_SCOPES = Object.freeze(['database', 'schema']);
export const POSTGRES_EXTENSION_CATALOG = Object.freeze([
  {
    extensionName: 'pgcrypto',
    defaultSchema: 'public',
    placementModes: ['schema_per_tenant', 'database_per_tenant'],
    description: 'Cryptographic primitives for UUID helpers and digest utilities.'
  },
  {
    extensionName: 'citext',
    defaultSchema: 'public',
    placementModes: ['schema_per_tenant', 'database_per_tenant'],
    description: 'Case-insensitive text support for tenant-safe unique identifiers.'
  },
  {
    extensionName: 'uuid-ossp',
    defaultSchema: 'public',
    placementModes: ['schema_per_tenant', 'database_per_tenant'],
    description: 'UUID generation helpers when pgcrypto is not sufficient.'
  },
  {
    extensionName: 'vector',
    defaultSchema: 'public',
    placementModes: ['database_per_tenant'],
    description: 'Vector similarity types for dedicated-database tenants.'
  }
]);

const POSTGRES_PRIVILEGES_BY_TARGET = Object.freeze({
  schema: Object.freeze(['usage', 'create']),
  table: Object.freeze(['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']),
  sequence: Object.freeze(['usage', 'select', 'update']),
  function: Object.freeze(['execute'])
});

function compactDefined(value = {}) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function unique(list = []) {
  return [...new Set(list.filter((entry) => entry !== undefined && entry !== null && entry !== ''))];
}

function normalizeIdentifier(value) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  return normalized ? normalized : undefined;
}

function safeIdentifier(value) {
  const normalized = normalizeIdentifier(value);
  if (!normalized) return undefined;
  return IDENTIFIER_PATTERN.test(normalized) && !RESERVED_PREFIX_PATTERN.test(normalized) ? normalized : normalized;
}

function quoteIdent(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function quoteLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function renderQualifiedName(schemaName, objectName) {
  return `${quoteIdent(schemaName)}.${quoteIdent(objectName)}`;
}

function normalizeDocumentation(documentation = {}) {
  if (!documentation || typeof documentation !== 'object') return undefined;
  const normalized = compactDefined({
    summary: documentation.summary ? String(documentation.summary).trim() : undefined,
    description: documentation.description ? String(documentation.description).trim() : undefined,
    examples: unique((documentation.examples ?? []).map((entry) => String(entry).trim()).filter(Boolean)),
    tags: unique((documentation.tags ?? []).map((entry) => String(entry).trim()).filter(Boolean))
  });
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function renderDocumentationComment(documentation = {}, comment) {
  const fragments = [documentation?.summary, documentation?.description, comment].filter(Boolean).map((entry) => String(entry).trim());
  return fragments.length > 0 ? fragments.join('\n\n') : undefined;
}

function defaultProviderCompatibility(context = {}, profile = {}) {
  return compactDefined({
    provider: 'postgresql',
    contractVersion: context.contractVersion ?? '2026-03-24',
    supportedVersions: context.supportedVersions,
    placementMode: profile.placementMode ?? context.placementMode,
    deploymentProfileId: profile.deploymentProfileId ?? context.deploymentProfileId,
    databaseMutationsSupported: profile.databaseMutationsSupported ?? context.databaseMutationsSupported
  });
}

function ownershipForContext(context = {}) {
  return compactDefined({
    tenantId: context.tenantId,
    workspaceId: context.workspaceId,
    managedBy: 'baas_control_api'
  });
}

function normalizePrivilegeList(privileges = []) {
  return unique(privileges.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean));
}

function normalizePolicyRoles(roles = []) {
  const normalized = unique((roles.length > 0 ? roles : ['public']).map((entry) => String(entry).trim()).filter(Boolean));
  return normalized.length > 0 ? normalized : ['public'];
}

function deriveGrantId(payload = {}, context = {}) {
  const targetType = normalizeIdentifier(payload.targetType ?? payload.objectType ?? payload.target?.objectType);
  const databaseName = normalizeIdentifier(payload.databaseName ?? payload.target?.databaseName ?? context.databaseName);
  const schemaName = normalizeIdentifier(payload.schemaName ?? payload.target?.schemaName ?? context.schemaName);
  const objectName = normalizeIdentifier(payload.objectName ?? payload.target?.objectName ?? payload.tableName ?? payload.sequenceName ?? payload.routineName);
  const granteeRoleName = normalizeIdentifier(payload.granteeRoleName ?? payload.roleName ?? payload.userName);

  return [databaseName, schemaName, targetType, objectName ?? 'schema', granteeRoleName]
    .filter(Boolean)
    .join('__');
}

function resolveExtensionCatalog(context = {}, profile = {}) {
  const catalog = context.authorizedExtensions ?? context.clusterFeatures?.authorizedExtensions ?? context.clusterFeatures?.enabledExtensions;

  if (Array.isArray(catalog) && catalog.length > 0) {
    return catalog.map((entry) => {
      if (typeof entry === 'string') {
        return {
          extensionName: normalizeIdentifier(entry),
          defaultSchema: 'public',
          placementModes: ['schema_per_tenant', 'database_per_tenant']
        };
      }

      return {
        extensionName: normalizeIdentifier(entry.extensionName ?? entry.name),
        defaultSchema: normalizeIdentifier(entry.defaultSchema ?? entry.schemaName ?? 'public'),
        placementModes: entry.placementModes ?? ['schema_per_tenant', 'database_per_tenant'],
        description: entry.description,
        defaultVersion: entry.defaultVersion
      };
    });
  }

  return POSTGRES_EXTENSION_CATALOG.filter((entry) =>
    !profile.placementMode || !entry.placementModes ? true : entry.placementModes.includes(profile.placementMode)
  );
}

function findAuthorizedExtension(extensionName, context = {}, profile = {}) {
  const normalized = normalizeIdentifier(extensionName);
  return resolveExtensionCatalog(context, profile).find((entry) => entry.extensionName === normalized);
}

function normalizeTemplateDefaults(payload = {}) {
  return compactDefined({
    ownerRoleName: payload.defaults?.ownerRoleName ?? payload.ownerRoleName,
    locale: payload.defaults?.locale,
    workspaceBindings: unique(payload.defaults?.workspaceBindings ?? payload.workspaceBindings ?? []),
    comment: payload.defaults?.comment ?? payload.comment,
    documentation: normalizeDocumentation(payload.defaults?.documentation ?? payload.documentation),
    extensions: unique((payload.defaults?.extensions ?? payload.extensions ?? []).map((entry) => normalizeIdentifier(entry)).filter(Boolean)),
    metadata: payload.defaults?.metadata ?? payload.metadata
  });
}

function ensureSafeExpression(expression, label, violations) {
  if (!expression) return;
  const trimmed = String(expression).trim();
  if (UNSAFE_EXPRESSION_PATTERN.test(trimmed)) {
    violations.push(`${label} must stay inside the bounded declarative subset and cannot include DDL, grants, comments, or statement chaining.`);
  }
}

function renderPolicyStatement(normalized) {
  const qualifiedTable = renderQualifiedName(normalized.schemaName, normalized.tableName);
  const policyMode = normalized.policyMode === 'restrictive' ? ' AS RESTRICTIVE' : '';
  const command = normalized.appliesTo?.command && normalized.appliesTo.command !== 'all' ? ` FOR ${normalized.appliesTo.command.toUpperCase()}` : '';
  const roles = (normalized.appliesTo?.roles ?? []).length > 0 ? ` TO ${normalized.appliesTo.roles.map((entry) => quoteIdent(entry)).join(', ')}` : '';
  const usingClause = normalized.usingExpression ? ` USING (${normalized.usingExpression})` : '';
  const withCheckClause = normalized.withCheckExpression ? ` WITH CHECK (${normalized.withCheckExpression})` : '';

  return `CREATE POLICY ${quoteIdent(normalized.policyName)} ON ${qualifiedTable}${policyMode}${command}${roles}${usingClause}${withCheckClause}`;
}

function renderFunctionIdentity(target = {}) {
  const objectSignature = target.objectSignature ?? `${target.objectName}()`;
  const signatureBody = objectSignature.includes('(') ? objectSignature : `${objectSignature}()`;
  const relation = signatureBody.startsWith(`${target.schemaName}.`) || signatureBody.startsWith(`"${target.schemaName}".`)
    ? signatureBody
    : `${quoteIdent(target.schemaName)}.${signatureBody}`;

  return relation;
}

function renderGrantStatement(normalized, verb = 'GRANT') {
  const privileges = (normalized.privileges ?? []).map((entry) => entry.toUpperCase()).join(', ');
  const target = normalized.target ?? {};
  const recipient = quoteIdent(normalized.granteeRoleName);

  if (target.objectType === 'schema') {
    const targetSql = renderQualifiedName(target.databaseName ? target.schemaName : target.schemaName, target.schemaName).replace(/^"[^"]+"\./, '');
    return `${verb} ${privileges || 'ALL PRIVILEGES'} ON SCHEMA ${quoteIdent(target.schemaName)} ${verb === 'GRANT' ? `TO ${recipient}` : `FROM ${recipient}`}${verb === 'GRANT' && normalized.grantOption ? ' WITH GRANT OPTION' : ''}`;
  }

  if (target.objectType === 'table') {
    return `${verb} ${privileges || 'ALL PRIVILEGES'} ON TABLE ${renderQualifiedName(target.schemaName, target.objectName)} ${verb === 'GRANT' ? `TO ${recipient}` : `FROM ${recipient}`}${verb === 'GRANT' && normalized.grantOption ? ' WITH GRANT OPTION' : ''}`;
  }

  if (target.objectType === 'sequence') {
    return `${verb} ${privileges || 'ALL PRIVILEGES'} ON SEQUENCE ${renderQualifiedName(target.schemaName, target.objectName)} ${verb === 'GRANT' ? `TO ${recipient}` : `FROM ${recipient}`}${verb === 'GRANT' && normalized.grantOption ? ' WITH GRANT OPTION' : ''}`;
  }

  return `${verb} ${privileges || 'ALL PRIVILEGES'} ON FUNCTION ${renderFunctionIdentity(target)} ${verb === 'GRANT' ? `TO ${recipient}` : `FROM ${recipient}`}${verb === 'GRANT' && normalized.grantOption ? ' WITH GRANT OPTION' : ''}`;
}

export function normalizePostgresGovernanceResource(resourceKind, payload = {}, context = {}, profile = {}) {
  const providerCompatibility = defaultProviderCompatibility(context, profile);
  const tenantId = context.tenantId;
  const workspaceId = context.workspaceId;
  const ownership = ownershipForContext(context);

  switch (resourceKind) {
    case 'table_security':
      return compactDefined({
        resourceType: 'postgres_table_security',
        tenantId,
        workspaceId,
        databaseName: payload.databaseName ?? context.databaseName,
        schemaName: payload.schemaName ?? context.schemaName,
        tableName: payload.tableName ?? context.tableName,
        rlsEnabled: payload.rlsEnabled !== false,
        forceRls: payload.forceRls === true,
        policyCount: Number(payload.policyCount ?? context.currentPolicies?.length ?? 0),
        sharedTableClassification: payload.sharedTableClassification ?? context.currentTable?.sharedTableClassification ?? 'tenant_scoped',
        state: payload.state ?? 'active',
        providerCompatibility
      });
    case 'policy':
      return compactDefined({
        resourceType: 'postgres_policy',
        tenantId,
        workspaceId,
        databaseName: payload.databaseName ?? context.databaseName,
        schemaName: payload.schemaName ?? context.schemaName,
        tableName: payload.tableName ?? context.tableName,
        policyName: payload.policyName ?? context.policyName,
        policyMode: payload.policyMode ?? 'permissive',
        appliesTo: {
          command: payload.command ?? payload.appliesTo?.command ?? 'all',
          roles: normalizePolicyRoles(payload.roles ?? payload.appliesTo?.roles ?? [])
        },
        usingExpression: payload.usingExpression ?? payload.using,
        withCheckExpression: payload.withCheckExpression ?? payload.withCheck,
        comment: payload.comment ? String(payload.comment).trim() : undefined,
        documentation: normalizeDocumentation(payload.documentation),
        tableSecurity: compactDefined({
          rlsEnabled: payload.rlsEnabled ?? context.currentSecurity?.rlsEnabled ?? true,
          forceRls: payload.forceRls ?? context.currentSecurity?.forceRls
        }),
        state: payload.state ?? 'active',
        providerCompatibility
      });
    case 'grant': {
      const target = compactDefined({
        databaseName: payload.databaseName ?? payload.target?.databaseName ?? context.databaseName,
        schemaName: payload.schemaName ?? payload.target?.schemaName ?? context.schemaName,
        objectType: payload.targetType ?? payload.objectType ?? payload.target?.objectType,
        objectName:
          payload.objectName ??
          payload.target?.objectName ??
          payload.tableName ??
          payload.sequenceName ??
          payload.routineName ??
          payload.target?.tableName ??
          payload.target?.sequenceName ??
          payload.target?.routineName,
        objectSignature: payload.objectSignature ?? payload.target?.objectSignature
      });

      return compactDefined({
        resourceType: 'postgres_grant',
        grantId: payload.grantId ?? deriveGrantId(payload, context),
        tenantId,
        workspaceId,
        granteeRoleName: payload.granteeRoleName ?? payload.roleName ?? payload.userName,
        target,
        privileges: normalizePrivilegeList(payload.privileges),
        grantOption: payload.grantOption === true,
        state: payload.state ?? 'active',
        ownership,
        providerCompatibility,
        metadata: payload.metadata ?? {}
      });
    }
    case 'extension': {
      const authorizedEntry = findAuthorizedExtension(payload.extensionName ?? context.extensionName, context, profile);
      return compactDefined({
        resourceType: 'postgres_extension',
        tenantId,
        workspaceId,
        databaseName: payload.databaseName ?? context.databaseName,
        extensionName: payload.extensionName ?? context.extensionName,
        schemaName: payload.schemaName ?? authorizedEntry?.defaultSchema ?? 'public',
        installedVersion: payload.installedVersion ?? payload.version,
        requestedVersion: payload.requestedVersion,
        authorized: Boolean(authorizedEntry),
        allowlistSource: authorizedEntry ? 'workspace_extension_allowlist' : 'unlisted',
        description: payload.description ?? authorizedEntry?.description,
        state: payload.state ?? 'active',
        providerCompatibility,
        metadata: payload.metadata ?? {}
      });
    }
    case 'template':
      return compactDefined({
        resourceType: 'postgres_template',
        templateId: payload.templateId ?? context.templateId,
        tenantId,
        workspaceId,
        templateScope: payload.templateScope ?? payload.scope,
        ownerRoleName: payload.ownerRoleName,
        description: payload.description ? String(payload.description).trim() : undefined,
        defaults: normalizeTemplateDefaults(payload),
        variables: Array.isArray(payload.variables)
          ? payload.variables.map((entry) =>
              compactDefined({
                name: entry.name ? String(entry.name).trim() : undefined,
                required: entry.required === true,
                defaultValue: entry.defaultValue,
                description: entry.description ? String(entry.description).trim() : undefined
              })
            )
          : undefined,
        documentation: normalizeDocumentation(payload.documentation),
        state: payload.state ?? 'active',
        metadata: payload.metadata ?? {}
      });
    default:
      throw new Error(`Unsupported PostgreSQL governance resource kind ${resourceKind}.`);
  }
}

export function validatePostgresGovernanceRequest({ resourceKind, action, payload = {}, context = {}, profile = {} } = {}) {
  const violations = [];
  const normalized = normalizePostgresGovernanceResource(resourceKind, payload, context, profile);

  if (resourceKind === 'table_security') {
    if (!['get', 'update'].includes(action)) {
      violations.push('Table security resources only support get/update actions.');
    }

    if (!normalized.databaseName && action !== 'get') {
      violations.push('Table security updates must declare databaseName.');
    }
    if (!normalized.schemaName && action !== 'get') {
      violations.push('Table security updates must declare schemaName.');
    }
    if (!normalized.tableName && action !== 'get') {
      violations.push('Table security updates must declare tableName.');
    }

    if (payload.rlsEnabled === false) {
      if (payload.disableGuard?.acknowledgeTenantIsolationImpact !== true) {
        violations.push('Disabling RLS requires disableGuard.acknowledgeTenantIsolationImpact=true.');
      }
      if (!payload.disableGuard?.reason) {
        violations.push('Disabling RLS requires disableGuard.reason so the risk is auditable.');
      }
      if ((context.currentPolicies?.length ?? 0) > 0 && payload.disableGuard?.dropPoliciesFirst !== true) {
        violations.push('Drop or explicitly acknowledge managed policies before disabling RLS on a table.');
      }
      if ((context.currentTable?.sharedTableClassification ?? normalized.sharedTableClassification) === 'tenant_scoped') {
        violations.push('Tenant-scoped shared tables cannot disable RLS through the safe product surface.');
      }
    }
  }

  if (resourceKind === 'policy') {
    if (!normalized.databaseName && action !== 'list') {
      violations.push('Policies must declare databaseName.');
    }
    if (!normalized.schemaName && action !== 'list') {
      violations.push('Policies must declare schemaName.');
    }
    if (!normalized.tableName && action !== 'list') {
      violations.push('Policies must declare tableName.');
    }
    if (!normalized.policyName && action !== 'list') {
      violations.push('Policies must declare policyName.');
    }
    if (normalized.policyName && (!IDENTIFIER_PATTERN.test(normalizeIdentifier(normalized.policyName)) || RESERVED_PREFIX_PATTERN.test(normalizeIdentifier(normalized.policyName)))) {
      violations.push(`Policy ${normalized.policyName} must use a safe, non-system identifier.`);
    }
    if (!POSTGRES_POLICY_MODES.includes(normalized.policyMode)) {
      violations.push(`Unsupported policy mode ${String(normalized.policyMode)}.`);
    }
    if (!POSTGRES_POLICY_COMMANDS.includes(normalized.appliesTo?.command)) {
      violations.push(`Unsupported policy command ${String(normalized.appliesTo?.command)}.`);
    }
    if ((action === 'create' || action === 'update') && !normalized.usingExpression && !normalized.withCheckExpression) {
      violations.push('Policies must declare usingExpression and/or withCheckExpression.');
    }
    ensureSafeExpression(normalized.usingExpression, 'Policy usingExpression', violations);
    ensureSafeExpression(normalized.withCheckExpression, 'Policy withCheckExpression', violations);
    if (context.currentSecurity?.rlsEnabled === false && payload.autoEnableRls !== true && action !== 'delete') {
      violations.push('Create/update policy requests against RLS-disabled tables must set autoEnableRls=true so policy intent remains safe.');
    }
  }

  if (resourceKind === 'grant') {
    const targetType = normalized.target?.objectType;
    const privileges = normalized.privileges ?? [];

    if (!normalized.grantId && action !== 'list') {
      violations.push('Grants must resolve to a stable grantId.');
    }
    if (!normalized.granteeRoleName && action !== 'list') {
      violations.push('Grants must declare granteeRoleName.');
    }
    if (normalized.granteeRoleName && (String(normalized.granteeRoleName).startsWith('pg_') || normalizeIdentifier(normalized.granteeRoleName) === 'postgres')) {
      violations.push('Grants cannot target reserved PostgreSQL roles through the managed surface.');
    }
    if (!POSTGRES_GRANT_TARGET_TYPES.includes(targetType) && action !== 'list') {
      violations.push(`Unsupported grant target type ${String(targetType)}.`);
    }
    if (!normalized.target?.databaseName && action !== 'list') {
      violations.push('Grants must declare databaseName.');
    }
    if (!normalized.target?.schemaName && action !== 'list') {
      violations.push('Grants must declare schemaName.');
    }
    if (targetType !== 'schema' && !normalized.target?.objectName && action !== 'list') {
      violations.push(`Grants targeting ${targetType} must declare objectName.`);
    }
    if ((action === 'create' || action === 'update') && privileges.length === 0) {
      violations.push('Grant mutations must include at least one privilege.');
    }
    if (privileges.length !== unique(privileges).length) {
      violations.push('Grant privileges must be unique.');
    }
    const supportedPrivileges = POSTGRES_PRIVILEGES_BY_TARGET[targetType] ?? [];
    for (const privilege of privileges) {
      if (!supportedPrivileges.includes(privilege)) {
        violations.push(`Privilege ${privilege} is not supported for ${targetType} targets.`);
      }
    }
    if (targetType === 'function' && !normalized.target?.objectSignature && !normalized.target?.objectName && action !== 'list') {
      violations.push('Function grants must declare objectSignature or objectName.');
    }
  }

  if (resourceKind === 'extension') {
    const extensionName = normalizeIdentifier(normalized.extensionName);
    const authorizedEntry = findAuthorizedExtension(extensionName, context, profile);

    if (!normalized.databaseName && action !== 'list') {
      violations.push('Extensions must declare databaseName.');
    }
    if (!extensionName && action !== 'list') {
      violations.push('Extensions must declare extensionName.');
    }
    if (extensionName && (!IDENTIFIER_PATTERN.test(extensionName) || RESERVED_PREFIX_PATTERN.test(extensionName))) {
      violations.push(`Extension ${extensionName} must use a safe, non-system identifier.`);
    }
    if ((action === 'create' || action === 'update' || action === 'delete') && !authorizedEntry) {
      violations.push(`Extension ${normalized.extensionName} is not present in the authorized extension catalog.`);
    }
    if (authorizedEntry?.placementModes?.length && profile.placementMode && !authorizedEntry.placementModes.includes(profile.placementMode)) {
      violations.push(`Extension ${normalized.extensionName} is not available for placement mode ${profile.placementMode}.`);
    }
  }

  if (resourceKind === 'template') {
    const scope = normalized.templateScope;
    if (!POSTGRES_TEMPLATE_SCOPES.includes(scope) && action !== 'list') {
      violations.push(`Unsupported PostgreSQL template scope ${String(scope)}.`);
    }
    if (!normalized.templateId && action !== 'list') {
      violations.push('Templates must declare templateId.');
    }
    if (normalized.templateId && !/^[a-z][a-z0-9_\-]{2,80}$/i.test(String(normalized.templateId))) {
      violations.push('Templates must use a stable templateId containing only safe characters.');
    }
    if ((action === 'create' || action === 'update') && !normalized.documentation?.summary && !normalized.description) {
      violations.push('Templates must declare documentation.summary or description so onboarding intent is auditable.');
    }
  }

  return {
    ok: violations.length === 0,
    violations,
    normalized
  };
}

export function buildPostgresGovernanceSqlPlan({ resourceKind, action, payload = {}, context = {} } = {}) {
  const validation = validatePostgresGovernanceRequest({
    resourceKind,
    action,
    payload,
    context,
    profile: context.profile ?? {}
  });

  if (!validation.ok) {
    const error = new Error('PostgreSQL governance request failed validation.');
    error.validation = validation;
    throw error;
  }

  const normalized = validation.normalized;
  const statements = [];
  const lockTargets = [];
  const safeGuards = [
    'RLS changes require explicit acknowledgements before any weakening of tenant isolation can occur.',
    'Grant operations stay inside a bounded privilege matrix per PostgreSQL object type.',
    'Extension enablement is restricted to an allow-listed catalog derived from workspace policy and deployment profile.',
    'Template resources are metadata-only and do not execute arbitrary SQL during catalog CRUD operations.'
  ];

  if (resourceKind === 'table_security') {
    const qualifiedTable = renderQualifiedName(normalized.schemaName, normalized.tableName);
    if (payload.disableGuard?.dropPoliciesFirst === true) {
      for (const policy of context.currentPolicies ?? []) {
        if (policy?.policyName) {
          statements.push(`DROP POLICY ${quoteIdent(policy.policyName)} ON ${qualifiedTable}`);
        }
      }
    }
    statements.push(`ALTER TABLE ${qualifiedTable} ${normalized.rlsEnabled ? 'ENABLE' : 'DISABLE'} ROW LEVEL SECURITY`);
    if (Object.prototype.hasOwnProperty.call(payload, 'forceRls')) {
      statements.push(`ALTER TABLE ${qualifiedTable} ${normalized.forceRls ? 'FORCE' : 'NO FORCE'} ROW LEVEL SECURITY`);
    }
    lockTargets.push(`${normalized.databaseName}.${normalized.schemaName}.${normalized.tableName}.security`);
  }

  if (resourceKind === 'policy') {
    const qualifiedTable = renderQualifiedName(normalized.schemaName, normalized.tableName);
    if ((action === 'create' || action === 'update') && (payload.autoEnableRls === true || context.currentSecurity?.rlsEnabled === false)) {
      statements.push(`ALTER TABLE ${qualifiedTable} ENABLE ROW LEVEL SECURITY`);
    }
    if ((action === 'create' || action === 'update') && Object.prototype.hasOwnProperty.call(payload, 'forceRls')) {
      statements.push(`ALTER TABLE ${qualifiedTable} ${normalized.tableSecurity?.forceRls ? 'FORCE' : 'NO FORCE'} ROW LEVEL SECURITY`);
    }
    if (action === 'update' || action === 'delete') {
      statements.push(`DROP POLICY ${quoteIdent(normalized.policyName)} ON ${qualifiedTable}`);
    }
    if (action === 'create' || action === 'update') {
      statements.push(renderPolicyStatement(normalized));
    }
    lockTargets.push(`${normalized.databaseName}.${normalized.schemaName}.${normalized.tableName}.policy.${normalized.policyName}`);
  }

  if (resourceKind === 'grant') {
    if (action === 'update') {
      statements.push(renderGrantStatement(normalized, 'REVOKE'));
      statements.push(renderGrantStatement(normalized, 'GRANT'));
    } else if (action === 'delete') {
      statements.push(renderGrantStatement(normalized, 'REVOKE'));
    } else if (action === 'create') {
      statements.push(renderGrantStatement(normalized, 'GRANT'));
    }
    lockTargets.push(`${normalized.target?.databaseName}.${normalized.target?.schemaName}.${normalized.target?.objectType}.${normalized.target?.objectName ?? normalized.target?.schemaName}.${normalized.granteeRoleName}`);
  }

  if (resourceKind === 'extension') {
    const extensionName = quoteIdent(normalized.extensionName);
    if (action === 'create') {
      const withClauses = [
        normalized.schemaName ? `SCHEMA ${quoteIdent(normalized.schemaName)}` : undefined,
        normalized.requestedVersion ? `VERSION ${quoteLiteral(normalized.requestedVersion)}` : undefined,
        normalized.installedVersion && !normalized.requestedVersion ? `VERSION ${quoteLiteral(normalized.installedVersion)}` : undefined
      ].filter(Boolean);
      statements.push(`CREATE EXTENSION IF NOT EXISTS ${extensionName}${withClauses.length > 0 ? ` WITH ${withClauses.join(' ')}` : ''}`);
    }
    if (action === 'update') {
      if (normalized.requestedVersion) {
        statements.push(`ALTER EXTENSION ${extensionName} UPDATE TO ${quoteLiteral(normalized.requestedVersion)}`);
      } else {
        statements.push(`ALTER EXTENSION ${extensionName} UPDATE`);
      }
      if (normalized.schemaName && context.currentExtension?.schemaName && context.currentExtension.schemaName !== normalized.schemaName) {
        statements.push(`ALTER EXTENSION ${extensionName} SET SCHEMA ${quoteIdent(normalized.schemaName)}`);
      }
    }
    if (action === 'delete') {
      statements.push(`DROP EXTENSION IF EXISTS ${extensionName}`);
    }
    lockTargets.push(`${normalized.databaseName}.extension.${normalized.extensionName}`);
  }

  if (resourceKind === 'template') {
    lockTargets.push(`workspace.${context.workspaceId ?? 'unknown'}.template.${normalized.templateId}`);
  }

  return {
    resourceKind,
    action,
    databaseName: normalized.databaseName ?? normalized.target?.databaseName,
    schemaName: normalized.schemaName ?? normalized.target?.schemaName,
    tableName: normalized.tableName,
    statements,
    lockTargets,
    transactionMode: resourceKind === 'extension' ? 'non_transactional_ddl' : 'transactional_ddl',
    safeGuards
  };
}

function privilegeSatisfies(action, privileges = []) {
  const normalized = new Set(normalizePrivilegeList(privileges));
  if (action === 'usage') return normalized.has('usage');
  if (action === 'select') return normalized.has('select');
  if (action === 'insert') return normalized.has('insert');
  if (action === 'update') return normalized.has('update');
  if (action === 'delete') return normalized.has('delete');
  return false;
}

function policyAppliesToActor(policy = {}, actorRoleName, command) {
  const appliesToCommand = policy.appliesTo?.command ?? 'all';
  if (appliesToCommand !== 'all' && appliesToCommand !== command) {
    return false;
  }

  const roles = policy.appliesTo?.roles ?? ['public'];
  return roles.includes('public') || roles.includes(actorRoleName);
}

function evaluateTenantPredicate(policy = {}, sessionContext = {}, row = {}) {
  const matcher = policy.runtimePredicate ?? policy.matcher ?? { kind: 'session_equals_row', sessionKey: 'tenantId', columnName: 'tenantId' };

  if (matcher.kind === 'allow_all') return true;
  if (matcher.kind === 'deny_all') return false;
  const sessionValue = sessionContext?.[matcher.sessionKey ?? 'tenantId'];
  const rowValue = row?.[matcher.columnName ?? 'tenantId'];
  return Boolean(sessionValue) && Boolean(rowValue) && sessionValue === rowValue;
}

export function evaluatePostgresDataApiAccess({
  actorRoleName,
  command = 'select',
  schemaGrants = [],
  objectGrants = [],
  tableSecurity = {},
  policies = [],
  sessionContext = {},
  row = {},
  resource = {}
} = {}) {
  const relevantSchemaGrant = schemaGrants.find(
    (grant) => grant?.target?.schemaName === resource.schemaName && grant?.granteeRoleName === actorRoleName && privilegeSatisfies('usage', grant.privileges ?? ['usage'])
  );
  const relevantObjectGrant = objectGrants.find(
    (grant) =>
      grant?.target?.schemaName === resource.schemaName &&
      grant?.target?.objectName === resource.tableName &&
      grant?.granteeRoleName === actorRoleName &&
      privilegeSatisfies(command, grant.privileges)
  );

  if (!relevantSchemaGrant || !relevantObjectGrant) {
    return {
      allowed: false,
      visible: false,
      reason: 'missing_grant'
    };
  }

  if (tableSecurity?.rlsEnabled === false) {
    return {
      allowed: true,
      visible: true,
      reason: 'grant_only'
    };
  }

  const applicablePolicies = policies.filter((policy) => policyAppliesToActor(policy, actorRoleName, command));
  if (applicablePolicies.length === 0) {
    return {
      allowed: false,
      visible: false,
      reason: 'no_applicable_rls_policy'
    };
  }

  const visible = applicablePolicies.some((policy) => evaluateTenantPredicate(policy, sessionContext, row));
  return {
    allowed: visible,
    visible,
    reason: visible ? 'grant_and_rls_allow' : 'rls_filtered'
  };
}

export function resolveAuthorizedPostgresExtensions(context = {}, profile = {}) {
  return resolveExtensionCatalog(context, profile);
}

export function renderPostgresDocumentationComment(documentation = {}, comment) {
  return renderDocumentationComment(normalizeDocumentation(documentation), comment);
}
