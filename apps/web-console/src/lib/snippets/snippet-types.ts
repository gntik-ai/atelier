export type ResourceType =
  | 'postgres-database'
  | 'mongo-collection'
  | 'storage-bucket'
  | 'serverless-function'
  | 'iam-client'
  | 'realtime-subscription'

export interface SnippetContext {
  tenantId: string | null
  tenantSlug: string | null
  workspaceId: string | null
  workspaceSlug: string | null
  resourceName: string | null
  resourceHost: string | null
  resourcePort: number | null
  resourceExtraA: string | null
  resourceExtraB: string | null
  resourceState: string | null
  externalAccessEnabled: boolean
}

export interface SnippetEntry {
  id: string
  label: string
  code: string
  notes: string[]
  hasPlaceholderSecrets: boolean
  secretPlaceholderRef: string | null
}

export interface SnippetGroup {
  resourceType: ResourceType
  entries: SnippetEntry[]
}
