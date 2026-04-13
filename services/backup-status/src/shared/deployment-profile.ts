/**
 * Deployment profile integration (US-DEP-03 wrapper).
 * Provides the list of managed component instances for backup status collection.
 */

import { buildServiceUrl, normalizeServiceBaseUrl } from './network.js'

export interface ManagedInstance {
  id: string
  tenantId: string
  componentType: string
  label: string
  isSharedInstance: boolean
}

const DEPLOYMENT_PROFILE_API_URL = process.env.DEPLOYMENT_PROFILE_API_URL

/**
 * Returns the slug of the current deployment profile.
 */
export async function getCurrent(): Promise<string> {
  if (DEPLOYMENT_PROFILE_API_URL) {
    try {
      const apiBaseUrl = normalizeServiceBaseUrl(DEPLOYMENT_PROFILE_API_URL, 'DEPLOYMENT_PROFILE_API_URL', {
        allowBareInternalHttp: true,
      })
      const res = await fetch(buildServiceUrl(apiBaseUrl, 'v1/profile'))
      if (res.ok) {
        const data = (await res.json()) as { slug: string }
        return data.slug
      }
    } catch {
      // fall through to default
    }
  }
  return process.env.DEPLOYMENT_PROFILE_SLUG ?? 'default'
}

/**
 * Returns the list of managed component instances for the current deployment.
 *
 * TODO: reemplazar por integración real con US-DEP-03
 */
export async function getManagedInstances(): Promise<ManagedInstance[]> {
  if (DEPLOYMENT_PROFILE_API_URL) {
    try {
      const apiBaseUrl = normalizeServiceBaseUrl(DEPLOYMENT_PROFILE_API_URL, 'DEPLOYMENT_PROFILE_API_URL', {
        allowBareInternalHttp: true,
      })
      const res = await fetch(buildServiceUrl(apiBaseUrl, 'v1/instances'))
      if (res.ok) {
        return (await res.json()) as ManagedInstance[]
      }
    } catch {
      // fall through to stub
    }
  }

  // Stub provisional for MVP / development
  return [
    {
      id: 'pg-main-001',
      tenantId: 'tenant-demo-1',
      componentType: 'postgresql',
      label: 'Base de datos relacional',
      isSharedInstance: false,
    },
    {
      id: 'pg-shared-001',
      tenantId: 'platform',
      componentType: 'postgresql',
      label: 'Base de datos relacional (compartida)',
      isSharedInstance: true,
    },
    {
      id: 'mongo-main-001',
      tenantId: 'tenant-demo-1',
      componentType: 'mongodb',
      label: 'Base de datos documental',
      isSharedInstance: false,
    },
    {
      id: 's3-main-001',
      tenantId: 'tenant-demo-1',
      componentType: 's3',
      label: 'Almacenamiento de objetos',
      isSharedInstance: false,
    },
    {
      id: 'kc-shared-001',
      tenantId: 'platform',
      componentType: 'keycloak',
      label: 'Servicio de identidad',
      isSharedInstance: true,
    },
    {
      id: 'kafka-shared-001',
      tenantId: 'platform',
      componentType: 'kafka',
      label: 'Bus de mensajería',
      isSharedInstance: true,
    },
  ]
}
