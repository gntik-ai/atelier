import {
  getAdapterPort,
  getContract
} from '../../internal-contracts/src/index.mjs';

export const keycloakAdminAdapterPort = getAdapterPort('keycloak');
export const iamAdminRequestContract = getContract('iam_admin_request');
export const iamAdminResultContract = getContract('iam_admin_result');

export const IAM_ADMIN_RESOURCE_KINDS = Object.freeze(['realm', 'client', 'role', 'scope', 'user']);
export const IAM_ADMIN_ACTIONS = Object.freeze([
  'list',
  'get',
  'create',
  'update',
  'delete',
  'activate',
  'deactivate',
  'reset_credentials'
]);

export const RESERVED_REALM_IDS = Object.freeze(['master', 'in-falcone-platform']);
export const RESERVED_ROLE_NAMES = Object.freeze([
  'platform_admin',
  'platform_operator',
  'platform_auditor',
  'tenant_owner',
  'tenant_admin',
  'tenant_developer',
  'tenant_viewer',
  'workspace_owner',
  'workspace_admin',
  'workspace_developer',
  'workspace_operator',
  'workspace_auditor',
  'workspace_viewer',
  'workspace_service_account'
]);
export const RESERVED_SCOPE_NAMES = Object.freeze(['openid', 'profile', 'email', 'roles', 'web-origins']);
export const SUPPORTED_CLIENT_PROTOCOLS = Object.freeze(['openid-connect', 'saml']);
export const SUPPORTED_REQUIRED_ACTIONS = Object.freeze([
  'CONFIGURE_TOTP',
  'UPDATE_PASSWORD',
  'UPDATE_PROFILE',
  'VERIFY_EMAIL'
]);
export const SUPPORTED_KEYCLOAK_VERSION_RANGES = Object.freeze([
  {
    range: '24.x',
    label: 'Keycloak 24.x',
    adminApiStability: 'stable_v1',
    supportedResources: IAM_ADMIN_RESOURCE_KINDS,
    guarantees: [
      'Realm CRUD/list and enable-disable flows are covered by the normalized BaaS contract.',
      'Client, role, scope, and user CRUD preserve the BaaS-native request/response envelopes.',
      'Credential reset and user group projection semantics are contract-tested.'
    ]
  },
  {
    range: '25.x',
    label: 'Keycloak 25.x',
    adminApiStability: 'stable_v1',
    supportedResources: IAM_ADMIN_RESOURCE_KINDS,
    guarantees: [
      'Realm CRUD/list and enable-disable flows are covered by the normalized BaaS contract.',
      'Client, role, scope, and user CRUD preserve the BaaS-native request/response envelopes.',
      'Credential reset and user group projection semantics are contract-tested.'
    ]
  },
  {
    range: '26.x',
    label: 'Keycloak 26.x',
    adminApiStability: 'stable_v1',
    supportedResources: IAM_ADMIN_RESOURCE_KINDS,
    guarantees: [
      'Realm CRUD/list and enable-disable flows are covered by the normalized BaaS contract.',
      'Client, role, scope, and user CRUD preserve the BaaS-native request/response envelopes.',
      'Credential reset and user group projection semantics are contract-tested.'
    ]
  }
]);

export const IAM_ADMIN_CAPABILITY_MATRIX = Object.freeze({
  realm: Object.freeze(['list', 'get', 'create', 'update', 'delete', 'activate', 'deactivate']),
  client: Object.freeze(['list', 'get', 'create', 'update', 'delete', 'activate', 'deactivate']),
  role: Object.freeze(['list', 'get', 'create', 'update', 'delete']),
  scope: Object.freeze(['list', 'get', 'create', 'update', 'delete']),
  user: Object.freeze(['list', 'get', 'create', 'update', 'delete', 'activate', 'deactivate', 'reset_credentials'])
});

const ERROR_CODE_MAP = new Map([
  ['invalid_payload', { status: 400, code: 'GW_IAM_INVALID_PAYLOAD' }],
  ['validation_error', { status: 400, code: 'GW_IAM_VALIDATION_FAILED' }],
  ['forbidden', { status: 403, code: 'GW_IAM_FORBIDDEN' }],
  ['not_found', { status: 404, code: 'GW_IAM_NOT_FOUND' }],
  ['conflict', { status: 409, code: 'GW_IAM_CONFLICT' }],
  ['unsupported_provider_version', { status: 424, code: 'GW_IAM_UNSUPPORTED_PROVIDER_VERSION' }],
  ['rate_limited', { status: 429, code: 'GW_IAM_PROVIDER_RATE_LIMITED', retryable: true }],
  ['dependency_failure', { status: 502, code: 'GW_IAM_DEPENDENCY_FAILURE', retryable: true }],
  ['timeout', { status: 504, code: 'GW_IAM_PROVIDER_TIMEOUT', retryable: true }]
]);

function compactDefined(values) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
}

function normalizedStateFromEnabled(enabled) {
  return enabled === false ? 'suspended' : 'active';
}

function unique(values = []) {
  return [...new Set(values)];
}

function hasIntersection(left = [], right = []) {
  return left.some((value) => right.includes(value));
}

function normalizeGroupPath(groupPath) {
  if (typeof groupPath !== 'string') return groupPath;
  if (!groupPath.startsWith('/')) return `/${groupPath}`;
  return groupPath;
}

function normalizeAttributes(attributes = {}) {
  return Object.fromEntries(
    Object.entries(attributes).map(([key, value]) => [
      key,
      Array.isArray(value) ? value.map((entry) => String(entry)) : [String(value)]
    ])
  );
}

export function getKeycloakCompatibilityMatrix() {
  return SUPPORTED_KEYCLOAK_VERSION_RANGES;
}

export function isKeycloakVersionSupported(version) {
  if (typeof version !== 'string' || version.length === 0) {
    return false;
  }

  return SUPPORTED_KEYCLOAK_VERSION_RANGES.some(({ range }) => {
    const [major] = range.split('.');
    return version === range || version.startsWith(`${major}.`);
  });
}

export function normalizeKeycloakAdminResource(resourceKind, payload = {}, context = {}) {
  const providerCompatibility = {
    provider: 'keycloak',
    contractVersion: iamAdminRequestContract?.version ?? '2026-03-24',
    supportedVersions: SUPPORTED_KEYCLOAK_VERSION_RANGES.map(({ range }) => range)
  };

  switch (resourceKind) {
    case 'realm':
      return compactDefined({
        resourceType: 'iam_realm',
        realmId: payload.realm ?? payload.id ?? context.realmId,
        displayName: payload.displayName ?? payload.display_name,
        enabled: payload.enabled !== false,
        state: normalizedStateFromEnabled(payload.enabled),
        login: compactDefined({
          loginWithEmailAllowed: payload.loginWithEmailAllowed,
          registrationAllowed: payload.registrationAllowed,
          rememberMe: payload.rememberMe,
          verifyEmail: payload.verifyEmail
        }),
        defaultScopes: unique(payload.defaultClientScopes ?? payload.defaultScopes ?? []),
        optionalScopes: unique(payload.optionalClientScopes ?? payload.optionalScopes ?? []),
        attributes: normalizeAttributes(payload.attributes ?? {}),
        metadata: payload.metadata ?? {},
        providerCompatibility
      });
    case 'client': {
      const accessType = payload.bearerOnly
        ? 'bearer_only'
        : payload.publicClient
          ? 'public'
          : payload.accessType ?? 'confidential';
      return compactDefined({
        resourceType: 'iam_client',
        realmId: context.realmId ?? payload.realm,
        clientId: payload.clientId,
        name: payload.name,
        enabled: payload.enabled !== false,
        state: normalizedStateFromEnabled(payload.enabled),
        protocol: payload.protocol ?? 'openid-connect',
        accessType,
        standardFlowEnabled: payload.standardFlowEnabled !== false,
        directAccessGrantsEnabled: payload.directAccessGrantsEnabled === true,
        serviceAccountsEnabled: payload.serviceAccountsEnabled === true,
        redirectUris: unique(payload.redirectUris ?? []),
        webOrigins: unique(payload.webOrigins ?? []),
        postLogoutRedirectUris: unique(payload.postLogoutRedirectUris ?? []),
        frontChannelLogoutUri: payload.frontChannelLogoutUri,
        backChannelLogoutUri: payload.backChannelLogoutUri,
        defaultScopes: unique(payload.defaultClientScopes ?? payload.defaultScopes ?? []),
        optionalScopes: unique(payload.optionalClientScopes ?? payload.optionalScopes ?? []),
        protocolMappers: payload.protocolMappers ?? [],
        attributes: normalizeAttributes(payload.attributes ?? {}),
        metadata: payload.metadata ?? {},
        providerCompatibility
      });
    }
    case 'role':
      return compactDefined({
        resourceType: 'iam_role',
        realmId: context.realmId ?? payload.realm,
        roleName: payload.name ?? payload.roleName,
        description: payload.description,
        composite: payload.composite === true,
        compositeRoles: unique(payload.composites ?? payload.compositeRoles ?? []),
        attributes: normalizeAttributes(payload.attributes ?? {}),
        providerCompatibility
      });
    case 'scope':
      return compactDefined({
        resourceType: 'iam_scope',
        realmId: context.realmId ?? payload.realm,
        scopeName: payload.name ?? payload.scopeName,
        description: payload.description,
        protocol: payload.protocol ?? 'openid-connect',
        includeInTokenScope: payload.includeInTokenScope !== false,
        isDefault: payload.isDefault === true,
        isOptional: payload.isOptional === true,
        attributes: normalizeAttributes(payload.attributes ?? {}),
        protocolMappers: payload.protocolMappers ?? [],
        assignedClientIds: unique(payload.assignedClientIds ?? []),
        providerCompatibility
      });
    case 'user':
      return compactDefined({
        resourceType: 'iam_user',
        realmId: context.realmId ?? payload.realm,
        userId: payload.id ?? payload.userId,
        username: payload.username,
        email: payload.email,
        firstName: payload.firstName,
        lastName: payload.lastName,
        enabled: payload.enabled !== false,
        state: normalizedStateFromEnabled(payload.enabled),
        emailVerified: payload.emailVerified === true,
        groups: unique((payload.groups ?? []).map(normalizeGroupPath)),
        realmRoles: unique(payload.realmRoles ?? []),
        requiredActions: unique(payload.requiredActions ?? []),
        attributes: normalizeAttributes(payload.attributes ?? {}),
        metadata: payload.metadata ?? {},
        providerCompatibility
      });
    default:
      throw new Error(`Unsupported IAM resource kind ${resourceKind}.`);
  }
}

export function normalizeKeycloakAdminError(error = {}, context = {}) {
  const classification =
    error.classification ??
    (error.status === 404 ? 'not_found' : undefined) ??
    (error.status === 409 ? 'conflict' : undefined) ??
    (error.status === 429 ? 'rate_limited' : undefined) ??
    (error.status === 504 ? 'timeout' : undefined) ??
    'dependency_failure';
  const mapped = ERROR_CODE_MAP.get(classification) ?? ERROR_CODE_MAP.get('dependency_failure');

  return {
    status: mapped.status,
    code: mapped.code,
    message: error.message ?? 'The IAM request could not be completed.',
    detail: {
      reason: classification,
      violations: error.violations ?? [],
      providerStatus: error.status,
      providerError: error.providerError,
      resourceKind: context.resourceKind,
      action: context.action,
      realmId: context.realmId,
      resourceId: context.resourceId
    },
    retryable: mapped.retryable === true
  };
}

export function validateIamAdminRequest(request = {}) {
  const violations = [];
  const { resourceKind, action, payload = {}, context = {} } = request;

  if (!IAM_ADMIN_RESOURCE_KINDS.includes(resourceKind)) {
    violations.push(`Unsupported IAM resource kind ${String(resourceKind)}.`);
  }

  if (!IAM_ADMIN_ACTIONS.includes(action)) {
    violations.push(`Unsupported IAM action ${String(action)}.`);
  }

  if (context.providerVersion && !isKeycloakVersionSupported(context.providerVersion)) {
    violations.push(`Keycloak version ${context.providerVersion} is outside the supported compatibility matrix.`);
  }

  if (context.scope !== 'platform' && RESERVED_REALM_IDS.includes(context.realmId)) {
    violations.push(`Realm ${context.realmId} is reserved for platform control-plane use.`);
  }

  switch (resourceKind) {
    case 'realm': {
      const defaultScopes = unique(payload.defaultScopes ?? payload.defaultClientScopes ?? []);
      const optionalScopes = unique(payload.optionalScopes ?? payload.optionalClientScopes ?? []);
      const realmId = payload.realmId ?? payload.realm ?? context.realmId;
      const loginWithEmailAllowed = payload.login?.loginWithEmailAllowed ?? payload.loginWithEmailAllowed;
      const registrationAllowed = payload.login?.registrationAllowed ?? payload.registrationAllowed;

      if (realmId && RESERVED_REALM_IDS.includes(realmId) && context.scope !== 'platform') {
        violations.push(`Realm ${realmId} is reserved and cannot be managed from tenant or workspace scope.`);
      }

      if (hasIntersection(defaultScopes, optionalScopes)) {
        violations.push('Default and optional realm scopes must be disjoint.');
      }

      if (registrationAllowed === true && loginWithEmailAllowed === false) {
        violations.push('Realm registration requires email-based login to remain enabled.');
      }
      break;
    }
    case 'client': {
      const accessType = payload.accessType;
      const protocol = payload.protocol ?? 'openid-connect';
      const serviceAccountsEnabled = payload.serviceAccountsEnabled === true;
      const standardFlowEnabled = payload.standardFlowEnabled !== false;
      const directAccessGrantsEnabled = payload.directAccessGrantsEnabled === true;
      const effectiveServiceAccountFlow = serviceAccountsEnabled && accessType === 'confidential';
      const redirectUris = payload.redirectUris ?? [];
      const postLogoutRedirectUris = payload.postLogoutRedirectUris ?? [];
      const defaultScopes = unique(payload.defaultScopes ?? []);
      const optionalScopes = unique(payload.optionalScopes ?? []);
      const workspaceNamespace = context.workspaceClientNamespace;
      const samlAssertionConsumerUrl =
        payload.samlAssertionConsumerServicePostUrl ?? payload.attributes?.['saml.assertion.consumer.url.post'];
      const samlSigningCertificate = payload.signingCertificatePem ?? payload.attributes?.['saml.signing.certificate'];

      if (!SUPPORTED_CLIENT_PROTOCOLS.includes(protocol)) {
        violations.push(`Client protocol ${protocol} is outside the supported Keycloak federation set.`);
      }

      if (accessType === 'public' && serviceAccountsEnabled) {
        violations.push('Public clients cannot enable service accounts.');
      }

      if (accessType === 'bearer_only' && redirectUris.length > 0) {
        violations.push('Bearer-only clients cannot declare redirect URIs.');
      }

      if (accessType === 'bearer_only' && standardFlowEnabled) {
        violations.push('Bearer-only clients must disable the browser standard flow.');
      }

      if (protocol === 'openid-connect' && !standardFlowEnabled && !directAccessGrantsEnabled && !effectiveServiceAccountFlow) {
        violations.push('Client configuration must enable at least one authentication flow.');
      }

      if (redirectUris.some((uri) => uri === '*' || /\*\//.test(uri))) {
        violations.push('Wildcard redirect URIs are not allowed by the BaaS IAM contract.');
      }

      if (postLogoutRedirectUris.some((uri) => uri === '*' || /\*\//.test(uri))) {
        violations.push('Wildcard post-logout redirect URIs are not allowed by the BaaS IAM contract.');
      }

      if (hasIntersection(defaultScopes, optionalScopes)) {
        violations.push('Default and optional client scopes must be disjoint.');
      }

      if (workspaceNamespace && payload.clientId && !payload.clientId.startsWith(workspaceNamespace)) {
        violations.push(`Workspace-bound clientId must start with namespace ${workspaceNamespace}.`);
      }

      if (protocol === 'saml') {
        if (accessType === 'bearer_only') {
          violations.push('SAML clients cannot use bearer_only accessType.');
        }

        if (serviceAccountsEnabled) {
          violations.push('SAML clients cannot enable service accounts.');
        }

        if (directAccessGrantsEnabled) {
          violations.push('SAML clients cannot enable direct access grants.');
        }

        if (!samlAssertionConsumerUrl && redirectUris.length === 0) {
          violations.push('SAML clients must declare an assertion consumer service URL or equivalent redirect URI.');
        }

        if ((payload.logoutBinding === 'redirect' || payload.attributes?.['saml.single.logout.service.url']) && !samlSigningCertificate) {
          violations.push('Signed SAML login/logout flows require a signing certificate reference.');
        }
      }
      break;
    }
    case 'role': {
      const roleName = payload.roleName ?? payload.name;
      const compositeRoles = unique(payload.compositeRoles ?? payload.composites ?? []);

      if (roleName && RESERVED_ROLE_NAMES.includes(roleName) && context.scope !== 'platform') {
        violations.push(`Role ${roleName} is reserved by the platform IAM baseline.`);
      }

      if (roleName && compositeRoles.includes(roleName)) {
        violations.push('A composite role cannot reference itself.');
      }
      break;
    }
    case 'scope': {
      const scopeName = payload.scopeName ?? payload.name;
      if (scopeName && RESERVED_SCOPE_NAMES.includes(scopeName)) {
        violations.push(`Scope ${scopeName} is reserved by Keycloak or the platform baseline.`);
      }

      if (payload.isDefault === true && payload.isOptional === true) {
        violations.push('A scope cannot be default and optional at the same time.');
      }
      break;
    }
    case 'user': {
      const groups = unique((payload.groups ?? []).map(normalizeGroupPath));
      const realmRoles = unique(payload.realmRoles ?? []);
      const requiredActions = unique(payload.requiredActions ?? []);
      const temporaryPassword = payload.bootstrapCredentials?.temporaryPassword ?? payload.temporaryPassword;
      const username = payload.username ?? '';

      if (!payload.username) {
        violations.push('Users must declare a username.');
      }

      if ((payload.email || '').length > 0 && payload.emailVerified === true && !payload.email.includes('@')) {
        violations.push('A verified email must be syntactically valid.');
      }

      if (groups.length !== (payload.groups ?? []).length) {
        violations.push('User groups must be unique after normalization.');
      }

      if (realmRoles.length !== (payload.realmRoles ?? []).length) {
        violations.push('User realmRoles must be unique.');
      }

      if (requiredActions.some((entry) => !SUPPORTED_REQUIRED_ACTIONS.includes(entry))) {
        violations.push('User requiredActions contain unsupported values.');
      }

      if (action === 'deactivate' && username.startsWith('service-account-')) {
        violations.push('Service-account users must be managed through the client or service-account surface, not the human user surface.');
      }

      if ((action === 'create' || action === 'reset_credentials') && temporaryPassword && temporaryPassword.length < 12) {
        violations.push('Temporary passwords must be at least 12 characters long.');
      }
      break;
    }
    default:
      break;
  }

  return {
    ok: violations.length === 0,
    violations
  };
}

export function buildIamAdminAdapterCall({
  resourceKind,
  action,
  payload = {},
  targetRef,
  callId,
  tenantId,
  workspaceId,
  planId,
  scopes = [],
  effectiveRoles = [],
  correlationId,
  authorizationDecisionId,
  idempotencyKey,
  requestedAt = '2026-03-24T00:00:00Z',
  identityBlueprintRef = 'identity-blueprint-platform-v1',
  context = {}
} = {}) {
  const validation = validateIamAdminRequest({ resourceKind, action, payload, context });
  if (!validation.ok) {
    const error = new Error('IAM admin request failed validation.');
    error.validation = validation;
    throw error;
  }

  return {
    call_id: callId,
    tenant_id: tenantId,
    adapter_id: 'keycloak',
    capability: `iam_${resourceKind}_${action}`,
    target_ref: targetRef,
    payload: {
      resourceKind,
      action,
      normalizedResource: normalizeKeycloakAdminResource(resourceKind, payload, context),
      providerPayload: payload
    },
    idempotency_key: idempotencyKey,
    correlation_id: correlationId,
    contract_version: iamAdminRequestContract?.version ?? '2026-03-24',
    requested_at: requestedAt,
    workspace_id: workspaceId,
    plan_id: planId,
    scopes,
    effective_roles: effectiveRoles,
    authorization_decision_id: authorizationDecisionId,
    identity_blueprint_ref: identityBlueprintRef
  };
}

// ── T02 provisional workflow helpers (guarded stubs) ─────────────────────────

function createNotYetImplementedError(capability) {
  const error = new Error(`NOT_YET_IMPLEMENTED: ${capability}`);
  error.code = 'NOT_YET_IMPLEMENTED';
  return error;
}

export async function createRealm() {
  throw createNotYetImplementedError('createRealm');
}

export async function createClient() {
  throw createNotYetImplementedError('createClient');
}

export async function assignRole() {
  throw createNotYetImplementedError('assignRole');
}

export async function createServiceAccount() {
  throw createNotYetImplementedError('createServiceAccount');
}

export async function updateServiceAccountScopeBindings() {
  throw createNotYetImplementedError('updateServiceAccountScopeBindings');
}

export async function regenerateServiceAccountCredentials() {
  throw createNotYetImplementedError('regenerateServiceAccountCredentials');
}

export async function disableServiceAccount() {
  throw createNotYetImplementedError('disableServiceAccount');
}

export async function deleteServiceAccount() {
  throw createNotYetImplementedError('deleteServiceAccount');
}

export async function generateClientCredential() {
  throw createNotYetImplementedError('generateClientCredential');
}

export async function rotateClientCredential() {
  throw createNotYetImplementedError('rotateClientCredential');
}

export async function revokeClientCredential() {
  throw createNotYetImplementedError('revokeClientCredential');
}
