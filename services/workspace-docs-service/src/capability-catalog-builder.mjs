import snippetCatalogData from '../../internal-contracts/src/snippet-catalog-data.json' with { type: 'json' };

const STATUS_MAP = new Map([
  ['enabled', 'active'],
  ['active', 'active'],
  ['disabled', 'disabled'],
  ['provisioning', 'provisioning'],
  ['deprovisioning', 'deprovisioning']
]);

function getSnippetEntries() {
  if (Array.isArray(snippetCatalogData)) {
    return snippetCatalogData;
  }

  return Object.entries(snippetCatalogData.capabilities ?? {}).flatMap(([serviceKey, capability]) =>
    (capability.operations ?? []).map((operation) => ({ serviceKey, ...operation }))
  );
}

function interpolate(template, workspaceContext = {}) {
  const replacements = {
    '{HOST}': workspaceContext.host ?? 'api.example.internal',
    '{PORT}': String(workspaceContext.port ?? 443),
    '{WORKSPACE_ID}': workspaceContext.workspaceId ?? 'ws-demo',
    '{RESOURCE_NAME}': workspaceContext.resourceNames?.default ?? workspaceContext.resourceName ?? 'sample-resource',
    '{RESOURCE_EXTRA_A}': workspaceContext.resourceNames?.extraA ?? workspaceContext.resourceExtraA ?? 'sample-extra-a',
    '{RESOURCE_EXTRA_B}': workspaceContext.resourceNames?.extraB ?? workspaceContext.resourceExtraB ?? 'https://functions.example.internal/api/v1/web/demo/default/ping',
    '{REALTIME_ENDPOINT}': workspaceContext.endpoints?.realtime ?? workspaceContext.realtimeEndpoint ?? 'wss://realtime.example.internal'
  };

  return Object.entries(replacements).reduce(
    (result, [placeholder, value]) => result.replaceAll(placeholder, value),
    template
  );
}

function getEnablementGuide(capabilityKey) {
  const labels = {
    'postgres-database': 'PostgreSQL',
    'mongo-collection': 'MongoDB',
    'kafka-events': 'Event Streaming',
    'realtime-subscription': 'Realtime Subscriptions',
    'serverless-function': 'Serverless Functions',
    'storage-bucket': 'Object Storage'
  };

  return `Contact your workspace administrator to enable ${labels[capabilityKey] ?? capabilityKey}.`;
}

export function buildExamples(capabilityKey, enabled, workspaceContext = {}) {
  if (!enabled) {
    return [];
  }

  return getSnippetEntries()
    .filter((entry) => entry.serviceKey === capabilityKey)
    .slice(0, 4)
    .map((entry) => ({
      operationId: entry.operationId ?? entry.id,
      label: entry.label,
      language: entry.language,
      code: interpolate(entry.codeTemplate ?? entry.code ?? '', workspaceContext),
      hasPlaceholderSecrets: true,
      secretPlaceholderRef: entry.secretPlaceholderRef
    }));
}

export function buildCatalog(capabilities, workspaceContext = {}) {
  const snippetEntries = getSnippetEntries();

  return capabilities.map((capability) => {
    const enabled = Boolean(capability.enabled);
    const status = STATUS_MAP.get(capability.status ?? capability.capabilityStatus ?? (enabled ? 'active' : 'disabled')) ?? 'disabled';
    const examples = buildExamples(capability.capability_key ?? capability.id, enabled, workspaceContext);
    const dependencySource = snippetEntries.find((entry) => entry.serviceKey === (capability.capability_key ?? capability.id) && entry.dependencyNote);

    const item = {
      id: capability.capability_key ?? capability.id,
      displayName: capability.display_name ?? capability.displayName,
      category: capability.category,
      description: capability.description,
      enabled,
      status,
      version: capability.catalog_version ?? capability.version ?? '1.0.0',
      quota: capability.quota ?? undefined,
      dependencies: capability.dependencies ?? [],
      examples
    };

    if (!enabled) {
      item.enablementGuide = getEnablementGuide(item.id);
    }

    if (dependencySource?.dependencyNote) {
      item.dependencyNote = dependencySource.dependencyNote;
    }

    return item;
  });
}
