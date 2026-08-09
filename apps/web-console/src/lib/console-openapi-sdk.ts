import { publicApiFetch, requestJson } from '@/lib/http'

export interface WorkspaceOpenApiSpec {
  specVersion: string
  contentHash: string
  format: 'json' | 'yaml'
  content: string
  etag: string
  createdAt?: string
}

export interface SdkPackageStatus {
  packageId: string
  language: 'typescript' | 'python'
  specVersion: string
  status: 'pending' | 'building' | 'ready' | 'failed' | 'stale'
  downloadUrl?: string
  urlExpiresAt?: string
  errorMessage?: string
}

export async function fetchWorkspaceSpec(workspaceId: string, format: 'json' | 'yaml' = 'json', ifNoneMatch?: string): Promise<WorkspaceOpenApiSpec | null> {
  const headers = new Headers()
  if (ifNoneMatch) headers.set('If-None-Match', ifNoneMatch)

  const response = await publicApiFetch(`/v1/workspaces/${workspaceId}/openapi?format=${format}`, {
    headers: {
      Accept: format === 'yaml' ? 'application/x-yaml' : 'application/json',
      ...(ifNoneMatch ? { 'If-None-Match': ifNoneMatch } : {})
    }
  })

  if (response.status === 304) return null
  if (!response.ok) throw new Error(`Failed to fetch spec: ${response.status}`)
  const content = await response.text()

  return {
    specVersion: response.headers.get('X-Spec-Version') ?? '0.0.0',
    contentHash: (response.headers.get('ETag') ?? '').replaceAll('"', ''),
    format,
    content,
    etag: response.headers.get('ETag') ?? ''
  }
}

export async function downloadSpec(workspaceId: string, format: 'json' | 'yaml'): Promise<void> {
  const spec = await fetchWorkspaceSpec(workspaceId, format)
  if (!spec) return
  const blob = new Blob([spec.content], { type: format === 'yaml' ? 'application/x-yaml' : 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `workspace-openapi-${workspaceId}.${format === 'yaml' ? 'yaml' : 'json'}`
  anchor.click()
  URL.revokeObjectURL(url)
}

export async function requestSdkGeneration(workspaceId: string, language: 'typescript' | 'python'): Promise<SdkPackageStatus> {
  return requestJson<SdkPackageStatus>(`/v1/workspaces/${workspaceId}/sdks/generate`, {
    method: 'POST',
    body: { language }
  })
}

export async function pollSdkStatus(workspaceId: string, language: 'typescript' | 'python'): Promise<SdkPackageStatus> {
  return requestJson<SdkPackageStatus>(`/v1/workspaces/${workspaceId}/sdks/${language}/status`)
}
