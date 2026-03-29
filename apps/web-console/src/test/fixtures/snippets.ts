import type { SnippetContext } from '@/lib/snippets/snippet-types'

export const SNIPPET_CTX_POSTGRES: SnippetContext = {
  tenantId: 'ten_alpha',
  tenantSlug: 'tenant-alpha',
  workspaceId: 'wrk_a1',
  workspaceSlug: 'workspace-alpha-1',
  resourceName: 'orders',
  resourceHost: 'db.example.test',
  resourcePort: 5432,
  resourceExtraA: 'public',
  resourceExtraB: null,
  resourceState: 'active',
  externalAccessEnabled: true
}

export const SNIPPET_CTX_NO_ENDPOINT: SnippetContext = {
  ...SNIPPET_CTX_POSTGRES,
  resourceHost: null,
  resourcePort: null
}

export const SNIPPET_CTX_PROVISIONING: SnippetContext = {
  ...SNIPPET_CTX_POSTGRES,
  resourceState: 'provisioning'
}

export const SNIPPET_CTX_MONGO: SnippetContext = {
  ...SNIPPET_CTX_POSTGRES,
  resourceName: 'events',
  resourceHost: 'mongo.example.test',
  resourcePort: 27017,
  resourceExtraA: 'app'
}

export const SNIPPET_CTX_STORAGE: SnippetContext = {
  ...SNIPPET_CTX_POSTGRES,
  resourceName: 'assets',
  resourceHost: 'https://s3.example.test',
  resourcePort: 443,
  resourceExtraA: 'eu-west-1',
  resourceExtraB: 'https://s3.example.test/assets/presigned'
}

export const SNIPPET_CTX_FUNCTION: SnippetContext = {
  ...SNIPPET_CTX_POSTGRES,
  resourceName: 'hello',
  resourceExtraB: 'https://functions.example.test/hello'
}

export const SNIPPET_CTX_IAM_CLIENT: SnippetContext = {
  ...SNIPPET_CTX_POSTGRES,
  resourceName: 'atelier-console',
  resourceExtraB: 'https://sso.example.test/token'
}
