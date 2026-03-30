export type InitiateRotationInput = {
  gracePeriodSeconds: number
  justification: string
  newValue: string
}

export type RotationResult = {
  rotationId: string
  vaultVersionNew: number
  vaultVersionOld?: number | null
  gracePeriodSeconds: number
  graceExpiresAt?: string | null
}

export type RevokeInput = {
  justification: string
  forceRevoke?: boolean
}

export type RevokeResult = {
  revokedVersion: number
  effectiveAt: string
}

export type PaginationInput = {
  limit?: number
  offset?: number
}

export type RotationHistoryPage = {
  items: Array<Record<string, unknown>>
  total: number
}

export type ConsumerStatusPage = {
  consumers: Array<{
    consumer_id: string
    reload_mechanism: string
    state: string
    confirmedAt?: string | null
    timeoutAt?: string | null
  }>
}

function parseSecretPath(secretPath: string) {
  const parts = secretPath.split('/')
  return {
    domain: parts[0],
    secretName: parts[parts.length - 1]
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: {
      'content-type': 'application/json'
    },
    ...init
  })

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`)
  }

  return response.json() as Promise<T>
}

export async function initiateRotation(secretPath: string, { gracePeriodSeconds, justification, newValue }: InitiateRotationInput): Promise<RotationResult> {
  const { domain, secretName } = parseSecretPath(secretPath)
  return requestJson(`/v1/platform/secrets/${encodeURIComponent(domain)}/${encodeURIComponent(secretName)}/rotate`, {
    method: 'POST',
    body: JSON.stringify({ secretPath, gracePeriodSeconds, justification, newValue })
  })
}

export async function revokeSecretVersion(secretPath: string, vaultVersion: number, { justification, forceRevoke }: RevokeInput): Promise<RevokeResult> {
  const { domain, secretName } = parseSecretPath(secretPath)
  return requestJson(`/v1/platform/secrets/${encodeURIComponent(domain)}/${encodeURIComponent(secretName)}/versions/${vaultVersion}/revoke`, {
    method: 'POST',
    body: JSON.stringify({ secretPath, justification, forceRevoke })
  })
}

export async function listRotationHistory(secretPath: string, { limit = 20, offset = 0 }: PaginationInput): Promise<RotationHistoryPage> {
  const { domain, secretName } = parseSecretPath(secretPath)
  return requestJson(`/v1/platform/secrets/${encodeURIComponent(domain)}/${encodeURIComponent(secretName)}/history?limit=${limit}&offset=${offset}`)
}

export async function getConsumerStatus(secretPath: string, vaultVersion?: number): Promise<ConsumerStatusPage> {
  const { domain, secretName } = parseSecretPath(secretPath)
  const suffix = typeof vaultVersion === 'number' ? `?vaultVersion=${vaultVersion}` : ''
  return requestJson(`/v1/platform/secrets/${encodeURIComponent(domain)}/${encodeURIComponent(secretName)}/consumer-status${suffix}`)
}
