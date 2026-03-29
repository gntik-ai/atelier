import { type Page, expect } from '@playwright/test'

export type ServiceScenario = 'nominal' | 'empty' | 'error'

export const PUBLIC_API_PREFIXES = [
  '/v1/postgres/',
  '/v1/mongo/',
  '/v1/events/',
  '/v1/functions/',
  '/v1/storage/',
  '/v1/auth/',
  '/v1/tenants',
  '/v1/workspaces',
  '/v1/iam/'
]

export const PG_DB_NAME = 'ws_alpha_prod_db'
export const PG_SCHEMA_NAME = 'public'
export const PG_TABLE_NAME = 'users'

export const MONGO_DB_NAME = 'ws_alpha_events'
export const MONGO_COL_NAME = 'audit_logs'
export const MONGO_WORKSPACE_ID = 'ws_alpha_prod'

export const KAFKA_WORKSPACE_ID = 'ws_alpha_prod'
export const KAFKA_TOPIC_ID = 'topic_audit_001'
export const KAFKA_TOPIC_NAME = 'platform.audit.events'

export const FN_WORKSPACE_ID = 'ws_alpha_prod'
export const FN_ACTION_ID = 'fn_hello_world'
export const FN_ACTION_NAME = 'hello-world'

export const STO_WORKSPACE_ID = 'ws_alpha_prod'
export const STO_BUCKET_ID = 'bucket_alpha_assets'
export const STO_BUCKET_NAME = 'alpha-assets'
export const STO_OBJECT_KEY = 'images/logo.png'

const PAGE = (total: number) => ({ total, size: total, number: 1, totalPages: 1 })
const list = <T,>(items: T[]) => ({ items, page: PAGE(items.length) })

function json(body: unknown, status = 200) {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify(body)
  }
}

function routePath(url: string) {
  return new URL(url).pathname
}

export function assertPublicApiOnly(urls: string[], serviceName: string): void {
  for (const url of urls) {
    const isAllowed = PUBLIC_API_PREFIXES.some((prefix) => url.startsWith(prefix))
    expect(isAllowed, `URL fuera de la API pública detectada en journey ${serviceName}: ${url}`).toBeTruthy()
  }
}

async function installDomainMocks(page: Page, glob: string, handler: (path: string) => { status?: number; contentType?: string; body?: string } | null) {
  await page.route(glob, async (route) => {
    const path = routePath(route.request().url())
    const response = handler(path)
    if (response) {
      await route.fulfill(response)
      return
    }

    await route.abort('failed')
  })
}

export async function installPgMocks(page: Page, scenario: ServiceScenario): Promise<void> {
  const empty = list([])
  const nominalDatabases = list([
    {
      databaseName: PG_DB_NAME,
      state: 'active',
      ownerRoleName: 'ws_alpha_owner',
      placementMode: 'dedicated',
      tenantId: 'tenant_alpha',
      workspaceId: 'ws_alpha_prod'
    }
  ])
  const nominalSchemas = list([
    {
      schemaName: PG_SCHEMA_NAME,
      state: 'active',
      ownerRoleName: 'ws_alpha_owner',
      objectCounts: { tables: 2, views: 0, materializedViews: 0, indexes: 2 }
    }
  ])
  const nominalTables = list([
    { tableName: PG_TABLE_NAME, state: 'active', columnCount: 5 },
    { tableName: 'orders', state: 'active', columnCount: 8 }
  ])

  await installDomainMocks(page, '**/v1/postgres/**', (path) => {
    if (path === '/v1/postgres/databases') {
      if (scenario === 'error') return json({ message: 'PostgreSQL inventory unavailable.' }, 503)
      return json(scenario === 'empty' ? empty : nominalDatabases)
    }

    if (path === `/v1/postgres/databases/${PG_DB_NAME}/schemas`) {
      return json(scenario === 'nominal' ? nominalSchemas : empty)
    }

    if (path === `/v1/postgres/databases/${PG_DB_NAME}/schemas/${PG_SCHEMA_NAME}/tables`) {
      return json(scenario === 'nominal' ? nominalTables : empty)
    }

    if (path.startsWith(`/v1/postgres/databases/${PG_DB_NAME}/schemas/${PG_SCHEMA_NAME}/`)) {
      return json(empty)
    }

    return null
  })
}

export async function installMongoMocks(page: Page, scenario: ServiceScenario): Promise<void> {
  const emptyItems = { items: [] }
  await installDomainMocks(page, '**/v1/mongo/**', (path) => {
    if (path === '/v1/mongo/databases') {
      if (scenario === 'error') return json({ message: 'MongoDB inventory unavailable.' }, 503)
      return json(
        scenario === 'empty'
          ? emptyItems
          : {
              items: [
                {
                  databaseName: MONGO_DB_NAME,
                  stats: { dataSize: 1048576, storageSize: 2097152, collections: 1, indexes: 2 }
                }
              ]
            }
      )
    }

    if (path === `/v1/mongo/databases/${MONGO_DB_NAME}/collections`) {
      return json(
        scenario === 'nominal'
          ? {
              items: [
                {
                  collectionName: MONGO_COL_NAME,
                  collectionType: 'standard',
                  documentCount: 120,
                  estimatedSize: 204800
                }
              ]
            }
          : emptyItems
      )
    }

    if (path === `/v1/mongo/databases/${MONGO_DB_NAME}/collections/${MONGO_COL_NAME}`) {
      return json(
        scenario === 'nominal'
          ? {
              collectionName: MONGO_COL_NAME,
              collectionType: 'standard',
              documentCount: 120,
              estimatedSize: 204800,
              validation: { validationLevel: 'moderate', validationAction: 'warn' }
            }
          : {}
      )
    }

    if (path === `/v1/mongo/databases/${MONGO_DB_NAME}/views`) {
      return json(emptyItems)
    }

    if (path === `/v1/mongo/databases/${MONGO_DB_NAME}/collections/${MONGO_COL_NAME}/indexes`) {
      return json(
        scenario === 'nominal'
          ? {
              items: [
                { indexName: '_id_', indexType: 'single', unique: false },
                {
                  indexName: 'created_at_1',
                  keys: [{ fieldName: 'created_at', direction: 1 }],
                  indexType: 'single',
                  unique: false
                }
              ]
            }
          : emptyItems
      )
    }

    if (path === `/v1/mongo/workspaces/${MONGO_WORKSPACE_ID}/data/${MONGO_DB_NAME}/collections/${MONGO_COL_NAME}/documents`) {
      return json(
        scenario === 'nominal'
          ? {
              items: [
                { _id: 'doc_001', event: 'login', userId: 'usr_ops_001' },
                { _id: 'doc_002', event: 'create_db', userId: 'usr_ops_001' }
              ],
              page: { after: null, size: 2 }
            }
          : { items: [], page: { after: null, size: 0 } }
      )
    }

    return null
  })
}

export async function installKafkaMocks(page: Page, scenario: ServiceScenario): Promise<void> {
  await installDomainMocks(page, '**/v1/events/**', (path) => {
    if (path === `/v1/events/workspaces/${KAFKA_WORKSPACE_ID}/inventory`) {
      if (scenario === 'error') return json({ message: 'Kafka inventory unavailable.' }, 503)
      return json(
        scenario === 'empty'
          ? { workspaceId: KAFKA_WORKSPACE_ID, tenantId: 'tenant_alpha', items: [], counts: { total: 0, topics: 0 }, bridges: [] }
          : {
              workspaceId: KAFKA_WORKSPACE_ID,
              tenantId: 'tenant_alpha',
              items: [
                {
                  resourceId: KAFKA_TOPIC_ID,
                  topicId: KAFKA_TOPIC_ID,
                  topicName: KAFKA_TOPIC_NAME,
                  status: 'active',
                  state: 'active',
                  partitions: 3,
                  partitionCount: 3,
                  replicationFactor: 1
                }
              ],
              counts: { total: 1, topics: 1 },
              bridges: []
            }
      )
    }

    if (path === `/v1/events/topics/${KAFKA_TOPIC_ID}`) {
      return json({
        resourceId: KAFKA_TOPIC_ID,
        topicId: KAFKA_TOPIC_ID,
        topicName: KAFKA_TOPIC_NAME,
        status: 'active',
        partitionCount: 3,
        replicationFactor: 1,
        retentionHours: 168,
        workspaceId: KAFKA_WORKSPACE_ID,
        tenantId: 'tenant_alpha'
      })
    }

    if (path === `/v1/events/topics/${KAFKA_TOPIC_ID}/access`) {
      return json({
        resourceId: KAFKA_TOPIC_ID,
        topicName: KAFKA_TOPIC_NAME,
        aclBindings: [{ principal: 'ws_alpha_owner', operations: ['read', 'write'], state: 'active' }]
      })
    }

    if (path === `/v1/events/topics/${KAFKA_TOPIC_ID}/metadata`) {
      return json({
        resourceId: KAFKA_TOPIC_ID,
        lag: { totalLag: 0, maxPartitionLag: 0 },
        retention: { retentionHours: 168, retentionMs: 604800000 },
        compaction: { enabled: false },
        health: 'healthy'
      })
    }

    if (path === `/v1/events/topics/${KAFKA_TOPIC_ID}/stream`) {
      return { status: 200, contentType: 'text/event-stream', body: '' }
    }

    return null
  })
}

export async function installFunctionsMocks(page: Page, scenario: ServiceScenario): Promise<void> {
  await installDomainMocks(page, '**/v1/functions/**', (path) => {
    if (path === `/v1/functions/workspaces/${FN_WORKSPACE_ID}/inventory`) {
      if (scenario === 'error') return json({ message: 'Functions inventory unavailable.' }, 503)
      return json(
        scenario === 'empty'
          ? { workspaceId: FN_WORKSPACE_ID, actions: [] }
          : {
              workspaceId: FN_WORKSPACE_ID,
              actions: [
                {
                  resourceId: FN_ACTION_ID,
                  actionId: FN_ACTION_ID,
                  actionName: FN_ACTION_NAME,
                  name: FN_ACTION_NAME,
                  namespace: 'ws_alpha',
                  runtime: 'nodejs:18',
                  state: 'active',
                  status: 'active',
                  version: '0.0.3',
                  activeVersionId: 'ver_003',
                  execution: { runtime: 'nodejs:18', limits: { timeoutMs: 60000, memoryMb: 256 } },
                  source: { kind: 'inline' },
                  latestActivation: {
                    activationId: 'act_001',
                    resourceId: FN_ACTION_ID,
                    status: 'success',
                    startedAt: '2026-03-29T08:00:00.000Z',
                    durationMs: 42,
                    triggerKind: 'http'
                  }
                }
              ]
            }
      )
    }

    if (path === `/v1/functions/workspaces/${FN_WORKSPACE_ID}/actions`) {
      if (scenario === 'error') return json({ message: 'Functions inventory unavailable.' }, 503)
      return json(
        scenario === 'empty'
          ? { items: [] }
          : {
              items: [
                {
                  resourceId: FN_ACTION_ID,
                  actionName: FN_ACTION_NAME,
                  execution: { runtime: 'nodejs:18', limits: { timeoutMs: 60000, memoryMb: 256 } },
                  source: { kind: 'inline' },
                  status: 'active'
                }
              ]
            }
      )
    }

    if (path === `/v1/functions/actions/${FN_ACTION_ID}`) {
      return json({
        resourceId: FN_ACTION_ID,
        actionId: FN_ACTION_ID,
        actionName: FN_ACTION_NAME,
        name: FN_ACTION_NAME,
        namespace: 'ws_alpha',
        runtime: 'nodejs:18',
        state: 'active',
        status: 'active',
        version: '0.0.3',
        execution: { runtime: 'nodejs:18', limits: { timeoutMs: 60000, memoryMb: 256 } },
        source: { kind: 'inline' }
      })
    }

    if (path === `/v1/functions/actions/${FN_ACTION_ID}/activations`) {
      return json({
        items: [
          {
            activationId: 'act_001',
            resourceId: FN_ACTION_ID,
            status: 'success',
            startedAt: '2026-03-29T08:00:00.000Z',
            finishedAt: '2026-03-29T08:00:00.042Z',
            durationMs: 42,
            triggerKind: 'http'
          }
        ],
        page: { total: 1, after: null }
      })
    }

    if (path === `/v1/functions/actions/${FN_ACTION_ID}/versions`) {
      return json({
        items: [
          {
            versionId: 'ver_002',
            resourceId: FN_ACTION_ID,
            versionNumber: 2,
            status: 'active',
            createdAt: '2026-03-28T10:00:00.000Z'
          }
        ]
      })
    }

    return null
  })
}

export async function installStorageMocks(page: Page, scenario: ServiceScenario): Promise<void> {
  await installDomainMocks(page, '**/v1/storage/**', (path) => {
    if (path === '/v1/storage/buckets') {
      if (scenario === 'error') return json({ message: 'Storage inventory unavailable.' }, 503)
      return json(
        scenario === 'empty'
          ? list([])
          : {
              items: [
                {
                  resourceId: STO_BUCKET_ID,
                  tenantId: 'tenant_alpha',
                  workspaceId: STO_WORKSPACE_ID,
                  bucketName: STO_BUCKET_NAME,
                  region: 'eu-west-1',
                  status: 'active'
                }
              ],
              page: PAGE(1)
            }
      )
    }

    if (path === `/v1/storage/workspaces/${STO_WORKSPACE_ID}/usage`) {
      return json({
        snapshotAt: '2026-03-29T08:00:00.000Z',
        dimensions: {
          totalBytes: { used: 10485760, limit: 52428800, remaining: 41943040, utilizationPercent: 20 },
          bucketCount: { used: 1, limit: 10, remaining: 9, utilizationPercent: 10 },
          objectCount: { used: 42, limit: 1000, remaining: 958, utilizationPercent: 4 }
        },
        buckets: [{ bucketId: STO_BUCKET_ID, totalBytes: 10485760, objectCount: 42 }]
      })
    }

    if (path === `/v1/storage/buckets/${STO_BUCKET_ID}/objects`) {
      return json(
        scenario === 'nominal'
          ? {
              items: [
                {
                  resourceId: 'obj_logo',
                  bucketResourceId: STO_BUCKET_ID,
                  bucketName: STO_BUCKET_NAME,
                  objectKey: STO_OBJECT_KEY,
                  contentType: 'image/png',
                  sizeBytes: 204800,
                  etag: 'abc123',
                  timestamps: { lastModifiedAt: '2026-03-20T10:00:00.000Z' }
                }
              ],
              page: { total: 1, nextCursor: null }
            }
          : { items: [], page: { total: 0, nextCursor: null } }
      )
    }

    if (path === `/v1/storage/buckets/${STO_BUCKET_ID}/objects/${encodeURIComponent(STO_OBJECT_KEY)}/metadata`) {
      return json({
        resourceId: 'obj_logo',
        bucketResourceId: STO_BUCKET_ID,
        bucketName: STO_BUCKET_NAME,
        objectKey: STO_OBJECT_KEY,
        contentType: 'image/png',
        sizeBytes: 204800,
        etag: 'abc123',
        timestamps: { lastModifiedAt: '2026-03-20T10:00:00.000Z' }
      })
    }

    return null
  })
}
