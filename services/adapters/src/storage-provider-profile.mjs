const STORAGE_PROVIDER_CAPABILITY_TEMPLATE = Object.freeze({
  bucketOperations: false,
  objectCrud: false,
  presignedUrls: false,
  multipartUpload: false,
  objectVersioning: false
});

export const STORAGE_PROVIDER_CAPABILITY_FIELDS = Object.freeze(
  Object.keys(STORAGE_PROVIDER_CAPABILITY_TEMPLATE)
);

export const STORAGE_PROVIDER_ERROR_CODES = Object.freeze({
  MISSING_PROVIDER_TYPE: 'MISSING_PROVIDER_TYPE',
  UNKNOWN_PROVIDER_TYPE: 'UNKNOWN_PROVIDER_TYPE',
  AMBIGUOUS_PROVIDER_SELECTION: 'AMBIGUOUS_PROVIDER_SELECTION',
  STORAGE_UNAVAILABLE: 'STORAGE_UNAVAILABLE'
});

export const DEFAULT_STORAGE_PROVIDER_TYPE = 'minio';

function withCapabilityDefaults(overrides = {}) {
  return Object.freeze({
    ...STORAGE_PROVIDER_CAPABILITY_TEMPLATE,
    ...overrides
  });
}

const STORAGE_PROVIDER_DEFINITIONS = Object.freeze({
  minio: Object.freeze({
    providerType: 'minio',
    displayName: 'MinIO',
    backendFamily: 's3-compatible',
    selectionKeys: ['minio'],
    configuredVia: 'storage.config.inline.providerType',
    defaultRegion: 'us-east-1',
    capabilityManifest: withCapabilityDefaults({
      bucketOperations: true,
      objectCrud: true,
      presignedUrls: true,
      multipartUpload: true,
      objectVersioning: true
    }),
    limitations: Object.freeze([])
  }),
  'ceph-rgw': Object.freeze({
    providerType: 'ceph-rgw',
    displayName: 'Ceph RGW',
    backendFamily: 's3-compatible',
    selectionKeys: ['ceph-rgw', 'ceph_rgw', 'cephrgw'],
    configuredVia: 'storage.config.inline.providerType',
    defaultRegion: 'default',
    capabilityManifest: withCapabilityDefaults({
      bucketOperations: true,
      objectCrud: true,
      presignedUrls: true,
      multipartUpload: true,
      objectVersioning: true
    }),
    limitations: Object.freeze([
      Object.freeze({
        code: 'PROVIDER_VERSIONING_POLICY_DEPLOYMENT_SPECIFIC',
        summary: 'Object versioning support may depend on the Ceph RGW deployment policy.'
      })
    ])
  }),
  garage: Object.freeze({
    providerType: 'garage',
    displayName: 'Garage',
    backendFamily: 's3-compatible',
    selectionKeys: ['garage'],
    configuredVia: 'storage.config.inline.providerType',
    defaultRegion: 'garage',
    capabilityManifest: withCapabilityDefaults({
      bucketOperations: true,
      objectCrud: true,
      presignedUrls: true,
      multipartUpload: true,
      objectVersioning: false
    }),
    limitations: Object.freeze([
      Object.freeze({
        code: 'OBJECT_VERSIONING_NOT_ASSUMED',
        summary: 'Object versioning is not assumed in the common abstraction profile for Garage.'
      })
    ])
  })
});

export const SUPPORTED_STORAGE_PROVIDER_TYPES = Object.freeze(
  Object.keys(STORAGE_PROVIDER_DEFINITIONS)
);

function normalizeProviderType(rawProviderType) {
  if (typeof rawProviderType !== 'string') {
    return null;
  }

  const normalized = rawProviderType.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  for (const definition of Object.values(STORAGE_PROVIDER_DEFINITIONS)) {
    if (definition.selectionKeys.includes(normalized)) {
      return definition.providerType;
    }
  }

  return normalized;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function collectConfiguredProviderCandidates(input = {}) {
  const candidates = [
    ['providerType', input.providerType],
    ['storage.provider.type', input?.storage?.provider?.type],
    ['storage.provider.selection.type', input?.storage?.provider?.selection?.type],
    ['storage.config.inline.providerType', input?.storage?.config?.inline?.providerType],
    ['storage.config.inline.providerSelection.type', input?.storage?.config?.inline?.providerSelection?.type],
    ['storage.config.inline.providerProfile', input?.storage?.config?.inline?.providerProfile]
  ].map(([source, value]) => ({
    source,
    value: normalizeProviderType(value)
  }));

  return candidates.filter((entry) => entry.value);
}

function buildStorageProviderLimitation({ code, summary, affectsCapabilities = [] }) {
  return Object.freeze({ code, summary, affectsCapabilities: Object.freeze([...affectsCapabilities]) });
}

function buildUnavailableCapabilityManifest() {
  return withCapabilityDefaults();
}

export function listSupportedStorageProviders() {
  return SUPPORTED_STORAGE_PROVIDER_TYPES.map((providerType) => {
    const definition = STORAGE_PROVIDER_DEFINITIONS[providerType];
    return {
      providerType: definition.providerType,
      displayName: definition.displayName,
      backendFamily: definition.backendFamily,
      selectionKeys: [...definition.selectionKeys],
      configuredVia: definition.configuredVia,
      defaultRegion: definition.defaultRegion,
      capabilityManifest: { ...definition.capabilityManifest },
      limitations: definition.limitations.map((entry) => ({ ...entry }))
    };
  });
}

export function isStorageProviderTypeSupported(providerType) {
  return SUPPORTED_STORAGE_PROVIDER_TYPES.includes(normalizeProviderType(providerType));
}

export function buildStorageCapabilityManifest(providerType) {
  const normalized = normalizeProviderType(providerType);
  const definition = normalized ? STORAGE_PROVIDER_DEFINITIONS[normalized] : null;
  return definition ? { ...definition.capabilityManifest } : buildUnavailableCapabilityManifest();
}

export function resolveStorageProviderConfig(input = {}) {
  const candidates = collectConfiguredProviderCandidates(input);
  const configuredTypes = unique(candidates.map((entry) => entry.value));

  if (configuredTypes.length > 1) {
    return {
      configured: true,
      providerType: null,
      configuredVia: candidates.map((entry) => entry.source),
      errorCode: STORAGE_PROVIDER_ERROR_CODES.AMBIGUOUS_PROVIDER_SELECTION,
      message: 'Multiple conflicting storage provider selections were supplied.'
    };
  }

  if (!configuredTypes.length) {
    return {
      configured: false,
      providerType: null,
      configuredVia: 'none',
      errorCode: STORAGE_PROVIDER_ERROR_CODES.MISSING_PROVIDER_TYPE,
      message: 'No explicit storage provider type was configured.'
    };
  }

  const providerType = configuredTypes[0];
  const match = candidates.find((entry) => entry.value === providerType);

  if (!STORAGE_PROVIDER_DEFINITIONS[providerType]) {
    return {
      configured: true,
      providerType,
      configuredVia: match?.source ?? 'unknown',
      errorCode: STORAGE_PROVIDER_ERROR_CODES.UNKNOWN_PROVIDER_TYPE,
      message: `Storage provider type \`${providerType}\` is not supported.`
    };
  }

  return {
    configured: true,
    providerType,
    configuredVia: match?.source ?? STORAGE_PROVIDER_DEFINITIONS[providerType].configuredVia,
    errorCode: null,
    message: null
  };
}

export function buildStorageUnavailableProfile(reason = STORAGE_PROVIDER_ERROR_CODES.STORAGE_UNAVAILABLE, details = {}) {
  const normalizedReason = reason || STORAGE_PROVIDER_ERROR_CODES.STORAGE_UNAVAILABLE;
  const summary = details.message
    ?? (normalizedReason === STORAGE_PROVIDER_ERROR_CODES.MISSING_PROVIDER_TYPE
      ? 'No storage provider type has been configured.'
      : normalizedReason === STORAGE_PROVIDER_ERROR_CODES.AMBIGUOUS_PROVIDER_SELECTION
        ? 'Storage provider selection is ambiguous.'
        : normalizedReason === STORAGE_PROVIDER_ERROR_CODES.UNKNOWN_PROVIDER_TYPE
          ? 'Storage provider type is not supported.'
          : 'Storage provider abstraction is unavailable.');

  return {
    providerType: details.providerType ?? null,
    status: 'unavailable',
    backendFamily: 's3-compatible',
    configured: Boolean(details.configured),
    configuredVia: details.configuredVia ?? 'none',
    capabilityManifest: buildUnavailableCapabilityManifest(),
    limitations: [
      buildStorageProviderLimitation({
        code: normalizedReason,
        summary
      })
    ],
    errorCode: normalizedReason,
    selectionMode: 'explicit',
    supportedProviderTypes: [...SUPPORTED_STORAGE_PROVIDER_TYPES]
  };
}

export function buildStorageProviderProfile(input = {}) {
  const resolution = resolveStorageProviderConfig(input);

  if (resolution.errorCode) {
    return buildStorageUnavailableProfile(resolution.errorCode, resolution);
  }

  const definition = STORAGE_PROVIDER_DEFINITIONS[resolution.providerType];

  return {
    providerType: definition.providerType,
    status: 'ready',
    backendFamily: definition.backendFamily,
    configured: true,
    configuredVia: resolution.configuredVia,
    capabilityManifest: { ...definition.capabilityManifest },
    limitations: definition.limitations.map((entry) => ({
      code: entry.code,
      summary: entry.summary,
      affectsCapabilities: [...(entry.affectsCapabilities ?? [])]
    })),
    errorCode: null,
    selectionMode: 'explicit',
    supportedProviderTypes: [...SUPPORTED_STORAGE_PROVIDER_TYPES],
    displayName: definition.displayName,
    defaultRegion: definition.defaultRegion
  };
}

export function summarizeStorageProviderCompatibility(input = {}) {
  const profile = buildStorageProviderProfile(input);

  return {
    providerType: profile.providerType,
    status: profile.status,
    supportedProviderTypes: [...profile.supportedProviderTypes],
    capabilityCount: STORAGE_PROVIDER_CAPABILITY_FIELDS.filter((field) => profile.capabilityManifest[field]).length,
    capabilityManifest: { ...profile.capabilityManifest },
    limitations: profile.limitations.map((entry) => ({ ...entry })),
    configuredVia: profile.configuredVia,
    errorCode: profile.errorCode
  };
}
