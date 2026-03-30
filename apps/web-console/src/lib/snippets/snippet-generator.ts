import { SNIPPET_CATALOG, type SnippetTemplate } from './snippet-catalog'
import type { ResourceType, SnippetContext, SnippetEntry } from './snippet-types'

const STATE_WARNING_SET = new Set(['provisioning', 'pending', 'error', 'degraded', 'failed'])

const TOKEN_FALLBACKS: Record<string, string> = {
  '{HOST}': '<RESOURCE_HOST>',
  '{PORT}': '<RESOURCE_PORT>',
  '{RESOURCE_NAME}': '<RESOURCE_NAME>',
  '{RESOURCE_EXTRA_A}': '<RESOURCE_EXTRA_A>',
  '{RESOURCE_EXTRA_B}': '<RESOURCE_EXTRA_B>',
  '{PASSWORD}': '<YOUR_SECRET>',
  '{WORKSPACE_ID}': '<WORKSPACE_ID>',
  '{REALTIME_ENDPOINT}': '<REALTIME_ENDPOINT>',
  '{CHANNEL_TYPE}': '<CHANNEL_TYPE>'
}

function getTokenValue(token: string, context: SnippetContext): string {
  switch (token) {
    case '{HOST}':
      return context.resourceHost ?? TOKEN_FALLBACKS[token]
    case '{PORT}':
      return context.resourcePort != null ? String(context.resourcePort) : TOKEN_FALLBACKS[token]
    case '{RESOURCE_NAME}':
      return context.resourceName ?? TOKEN_FALLBACKS[token]
    case '{RESOURCE_EXTRA_A}':
      return context.resourceExtraA ?? TOKEN_FALLBACKS[token]
    case '{RESOURCE_EXTRA_B}':
      return context.resourceExtraB ?? TOKEN_FALLBACKS[token]
    case '{PASSWORD}':
      return '<YOUR_SECRET>'
    case '{WORKSPACE_ID}':
      return context.workspaceId ?? TOKEN_FALLBACKS[token]
    case '{REALTIME_ENDPOINT}':
      return context.resourceHost ?? TOKEN_FALLBACKS[token]
    case '{CHANNEL_TYPE}':
      return context.resourceExtraA ?? TOKEN_FALLBACKS[token]
    default:
      return token
  }
}

function fillTemplate(codeTemplate: string, context: SnippetContext): string {
  return codeTemplate.replace(/\{HOST\}|\{PORT\}|\{RESOURCE_NAME\}|\{RESOURCE_EXTRA_A\}|\{RESOURCE_EXTRA_B\}|\{PASSWORD\}|\{WORKSPACE_ID\}|\{REALTIME_ENDPOINT\}|\{CHANNEL_TYPE\}/g, (token) => getTokenValue(token, context))
}

function hasMissingEndpointContext(context: SnippetContext): boolean {
  return [context.resourceHost, context.resourcePort, context.resourceExtraB].every((value) => value == null)
}

function buildNotes(template: SnippetTemplate, context: SnippetContext): string[] {
  const notes = [...(template.fallbackNotes ?? [])]

  if (!context.externalAccessEnabled) {
    notes.push('El acceso externo está deshabilitado o no confirmado; revisa la configuración de exposición antes de usar este snippet.')
  }

  if (context.resourceState && STATE_WARNING_SET.has(context.resourceState.toLowerCase())) {
    notes.push(`El recurso está en estado ${context.resourceState}; valida su salud antes de automatizar conexiones.`)
  }

  if (hasMissingEndpointContext(context)) {
    notes.push('Faltan datos de endpoint/host en la vista actual, por eso se muestran placeholders descriptivos.')
  }

  return Array.from(new Set(notes))
}

export function generateSnippets(resourceType: ResourceType | ('unsupported-type' & string), context: SnippetContext): SnippetEntry[] {
  const templates = SNIPPET_CATALOG[resourceType as ResourceType]
  if (!templates) {
    return []
  }

  return templates.map((template) => ({
    id: template.id,
    label: template.label,
    code: fillTemplate(template.codeTemplate, context),
    notes: buildNotes(template, context),
    hasPlaceholderSecrets: (template.secretTokens ?? []).length > 0,
    secretPlaceholderRef: template.secretPlaceholderRef
  }))
}
