/**
 * PostgreSQL backup adapter (MVP).
 * Multi-level detection strategy: Velero VolumeSnapshot → Barman API → K8s Annotation → fallback.
 */

import type { BackupAdapter, BackupCheckResult, AdapterContext } from './types.js'

const BACKUP_STALENESS_HOURS = parseInt(process.env.BACKUP_STALENESS_HOURS ?? '25', 10)

async function fetchJson(url: string, token?: string, timeoutMs = 5000): Promise<{ ok: boolean; status: number; data?: unknown }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (token) headers.Authorization = `Bearer ${token}`
    const res = await fetch(url, { headers, signal: controller.signal })
    if (!res.ok) return { ok: false, status: res.status }
    const data = await res.json()
    return { ok: true, status: res.status, data }
  } catch {
    return { ok: false, status: 0 }
  } finally {
    clearTimeout(timer)
  }
}

function isStale(lastBackup: Date): boolean {
  const ageMs = Date.now() - lastBackup.getTime()
  return ageMs > BACKUP_STALENESS_HOURS * 3600 * 1000
}

async function tryVelero(namespace: string, token: string, timeoutMs: number): Promise<BackupCheckResult | null> {
  const url = `https://kubernetes.default.svc/apis/snapshot.storage.k8s.io/v1/namespaces/${namespace}/volumesnapshots`
  const res = await fetchJson(url, token, timeoutMs)
  if (!res.ok || res.status === 404) return null
  const items = (res.data as { items?: { status?: { readyToUse?: boolean; creationTime?: string } }[] })?.items
  if (!items || items.length === 0) return null

  // Sort by creation time descending
  const sorted = items.filter(i => i.status).sort((a, b) => {
    const ta = a.status?.creationTime ? new Date(a.status.creationTime).getTime() : 0
    const tb = b.status?.creationTime ? new Date(b.status.creationTime).getTime() : 0
    return tb - ta
  })
  const latest = sorted[0]
  if (!latest?.status) return null

  if (latest.status.readyToUse === false) {
    return { status: 'in_progress', detail: 'VolumeSnapshot in progress' }
  }

  const creationTime = latest.status.creationTime ? new Date(latest.status.creationTime) : null
  if (creationTime && isStale(creationTime)) {
    return {
      status: 'failure',
      lastSuccessfulBackupAt: creationTime,
      detail: `Last VolumeSnapshot exceeds ${BACKUP_STALENESS_HOURS}h threshold`,
    }
  }

  return {
    status: 'success',
    lastSuccessfulBackupAt: creationTime ?? undefined,
    detail: 'VolumeSnapshot readyToUse=true',
    metadata: { strategy: 'velero' },
  }
}

async function tryBarman(namespace: string, timeoutMs: number): Promise<BackupCheckResult | null> {
  // CloudNativePG / Barman API — typically exposed as a service in the namespace
  const url = `http://cnpg-barman.${namespace}.svc:8080/api/v1/backups`
  const res = await fetchJson(url, undefined, timeoutMs)
  if (!res.ok) return null
  const backups = (res.data as { items?: { status?: string; completedAt?: string }[] })?.items
  if (!backups || backups.length === 0) return { status: 'not_configured', detail: 'Barman API reachable but no backups found' }

  const completed = backups.filter(b => b.status === 'completed' && b.completedAt)
  if (completed.length === 0) return { status: 'failure', detail: 'No completed backups in Barman' }

  const latest = completed.sort((a, b) => new Date(b.completedAt!).getTime() - new Date(a.completedAt!).getTime())[0]
  const lastBackup = new Date(latest.completedAt!)

  if (isStale(lastBackup)) {
    return { status: 'failure', lastSuccessfulBackupAt: lastBackup, detail: `Last Barman backup exceeds ${BACKUP_STALENESS_HOURS}h threshold` }
  }
  return { status: 'success', lastSuccessfulBackupAt: lastBackup, detail: 'Barman backup completed', metadata: { strategy: 'barman' } }
}

async function tryAnnotation(namespace: string, token: string, timeoutMs: number): Promise<BackupCheckResult | null> {
  const url = `https://kubernetes.default.svc/api/v1/namespaces/${namespace}/pods?labelSelector=app.kubernetes.io/component=postgresql`
  const res = await fetchJson(url, token, timeoutMs)
  if (!res.ok) return null
  const pods = (res.data as { items?: { metadata?: { annotations?: Record<string, string> } }[] })?.items
  if (!pods || pods.length === 0) return null

  for (const pod of pods) {
    const ts = pod.metadata?.annotations?.['backup.kubernetes.io/last-success-timestamp']
    if (ts) {
      const lastBackup = new Date(ts)
      if (isStale(lastBackup)) {
        return { status: 'failure', lastSuccessfulBackupAt: lastBackup, detail: `Annotation backup exceeds ${BACKUP_STALENESS_HOURS}h threshold` }
      }
      return { status: 'success', lastSuccessfulBackupAt: lastBackup, detail: 'K8s annotation backup', metadata: { strategy: 'annotation' } }
    }
  }
  return null
}

export const postgresqlAdapter: BackupAdapter = {
  componentType: 'postgresql',
  instanceLabel: 'Base de datos relacional',

  async check(_instanceId: string, _tenantId: string, context: AdapterContext): Promise<BackupCheckResult> {
    const namespace = context.k8sNamespace ?? 'default'
    const token = context.serviceAccountToken ?? ''
    const timeoutMs = (context.adapterConfig?.adapter_timeout_ms as number) ?? 10000

    try {
      // Strategy 1: Velero VolumeSnapshot
      const veleroResult = await tryVelero(namespace, token, timeoutMs)
      if (veleroResult) return veleroResult

      // Strategy 2: Barman / CloudNativePG
      const barmanResult = await tryBarman(namespace, timeoutMs)
      if (barmanResult) return barmanResult

      // Strategy 3: K8s Annotation
      const annotationResult = await tryAnnotation(namespace, token, timeoutMs)
      if (annotationResult) return annotationResult

      // Fallback
      return { status: 'not_configured', detail: 'No backup mechanism detected for PostgreSQL' }
    } catch {
      return { status: 'not_available', detail: 'adapter_error' }
    }
  },
}
