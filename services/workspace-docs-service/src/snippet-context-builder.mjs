import catalog from '../../internal-contracts/src/snippet-catalog-data.json' with { type: 'json' }

const SERVICE_META = {
  'postgres-database': { category: 'data', label: 'PostgreSQL' },
  'mongo-collection': { category: 'data', label: 'MongoDB' },
  'storage-bucket': { category: 'storage', label: 'Storage bucket' },
  'serverless-function': { category: 'functions', label: 'Serverless Function' },
  'realtime-subscription': { category: 'realtime', label: 'Realtime' },
  webhooks: { category: 'webhooks', label: 'Webhooks' },
  scheduling: { category: 'scheduling', label: 'Scheduling' }
}

function substitute(template, replacements) {
  return Object.entries(replacements).reduce(
    (output, [key, value]) => output.replaceAll(key, String(value ?? '')),
    template
  )
}

function buildReplacements(baseUrl, workspaceId, capability) {
  const endpoint = capability.endpoint ?? capability.host ?? capability.url ?? baseUrl
  const port = capability.port ?? null
  return {
    '{HOST}': endpoint,
    '{PORT}': port ?? '',
    '{RESOURCE_NAME}': capability.resourceName ?? capability.name ?? '',
    '{RESOURCE_EXTRA_A}': capability.resourceExtraA ?? capability.database ?? capability.region ?? '',
    '{RESOURCE_EXTRA_B}': capability.resourceExtraB ?? capability.invokeUrl ?? capability.url ?? '',
    '{REALTIME_ENDPOINT}': capability.realtimeEndpoint ?? baseUrl.replace(/^http/, 'ws'),
    '{WORKSPACE_ID}': workspaceId,
    '{CHANNEL_TYPE}': capability.channelType ?? 'events'
  }
}

function normalizeCapability(baseUrl, workspaceId, capability) {
  const serviceKey = capability.serviceKey ?? capability.key
  const meta = SERVICE_META[serviceKey]
  if (!meta) return null

  const endpoint = serviceKey === 'webhooks'
    ? `${baseUrl}/v1/webhooks`
    : serviceKey === 'scheduling'
      ? `${baseUrl}/v1/schedules`
      : capability.endpoint ?? capability.host ?? capability.url ?? baseUrl

  const replacements = buildReplacements(baseUrl, workspaceId, { ...capability, endpoint })
  const snippets = catalog
    .filter((template) => template.serviceKey === serviceKey)
    .map((template) => ({
      id: template.id,
      label: template.label,
      code: substitute(template.codeTemplate, replacements),
      notes: [],
      hasPlaceholderSecrets: Boolean(template.secretPlaceholderRef),
      secretPlaceholderRef: template.secretPlaceholderRef
    }))

  return {
    serviceKey,
    category: meta.category,
    label: meta.label,
    endpoint,
    port: capability.port ?? null,
    resourceName: capability.resourceName ?? capability.name ?? null,
    snippets
  }
}

export function buildSnippetContexts(apiSurface, effectiveCapabilities) {
  const workspaceId = apiSurface.workspaceId ?? effectiveCapabilities.workspaceId ?? 'unknown-workspace'
  const baseUrl = apiSurface.baseUrl ?? effectiveCapabilities.baseUrl ?? ''
  const records = Array.isArray(effectiveCapabilities.enabledServices)
    ? effectiveCapabilities.enabledServices
    : Array.isArray(effectiveCapabilities.capabilities)
      ? effectiveCapabilities.capabilities.filter((item) => item.enabled !== false)
      : []

  return records.map((capability) => normalizeCapability(baseUrl, workspaceId, capability)).filter(Boolean)
}
