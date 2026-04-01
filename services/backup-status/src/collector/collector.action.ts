/**
 * OpenWhisk action: periodic backup status collector.
 * Iterates managed instances, calls adapters, persists snapshots, emits Kafka event.
 */

import { adapterRegistry } from '../adapters/registry.js'
import { postgresqlAdapter } from '../adapters/postgresql.adapter.js'
import { mongodbAdapter } from '../adapters/mongodb.adapter.js'
import { s3Adapter } from '../adapters/s3.adapter.js'
import { keycloakAdapter } from '../adapters/keycloak.adapter.js'
import { kafkaAdapter } from '../adapters/kafka.adapter.js'
import { upsertSnapshot } from '../db/repository.js'
import * as deploymentProfile from '../shared/deployment-profile.js'
import * as audit from '../shared/audit.js'
import { loadConfig } from './collector.config.js'
import type { CollectorResponse, CollectionResult } from './collector.types.js'
import type { BackupCheckResult, AdapterContext } from '../adapters/types.js'

// Register adapters
adapterRegistry.register(postgresqlAdapter)
adapterRegistry.register(mongodbAdapter)
adapterRegistry.register(s3Adapter)
adapterRegistry.register(keycloakAdapter)
adapterRegistry.register(kafkaAdapter)

function timeoutPromise(ms: number): Promise<BackupCheckResult> {
  return new Promise((resolve) => {
    setTimeout(() => resolve({ status: 'not_available', detail: 'adapter_timeout' }), ms)
  })
}

export async function main(_params?: Record<string, unknown>): Promise<CollectorResponse> {
  const config = loadConfig()
  let profile: string

  try {
    profile = await deploymentProfile.getCurrent()
  } catch (err) {
    return { ok: false, error: `Failed to get deployment profile: ${String(err)}` }
  }

  let instances
  try {
    instances = await deploymentProfile.getManagedInstances()
  } catch (err) {
    return { ok: false, error: `Failed to get managed instances: ${String(err)}` }
  }

  const results: CollectionResult[] = []
  let errors = 0

  for (const instance of instances) {
    const adapter = adapterRegistry.get(instance.componentType)
    const context: AdapterContext = {
      deploymentProfile: profile,
      serviceAccountToken: process.env.K8S_SERVICE_ACCOUNT_TOKEN,
      k8sNamespace: process.env.K8S_NAMESPACE ?? 'default',
      adapterConfig: { adapter_timeout_ms: config.adapterTimeoutMs },
    }

    let result: BackupCheckResult
    try {
      result = await Promise.race([
        adapter.check(instance.id, instance.tenantId, context),
        timeoutPromise(config.adapterTimeoutMs),
      ])
    } catch {
      result = { status: 'not_available', detail: 'adapter_error' }
      errors++
    }

    try {
      await upsertSnapshot({
        tenantId: instance.tenantId,
        componentType: instance.componentType,
        instanceId: instance.id,
        instanceLabel: instance.label,
        deploymentProfile: profile,
        isSharedInstance: instance.isSharedInstance,
        status: result.status,
        lastSuccessfulBackupAt: result.lastSuccessfulBackupAt ?? null,
        lastCheckedAt: new Date(),
        detail: result.detail,
        adapterMetadata: result.metadata,
      })
    } catch (err) {
      console.error(`[collector] Failed to upsert snapshot for ${instance.id}:`, err)
      errors++
    }

    results.push({
      instanceId: instance.id,
      componentType: instance.componentType,
      tenantId: instance.tenantId,
      status: result.status,
    })
  }

  // Emit collection cycle audit event
  try {
    await audit.logCollectionCycle({
      timestamp: new Date().toISOString(),
      processed: results.length,
      errors,
    })
  } catch (err) {
    console.error('[collector] Failed to emit audit event:', err)
  }

  return { ok: true, processed: results.length }
}
