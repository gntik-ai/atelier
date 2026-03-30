import { requestJson } from '@/lib/http'

export interface WorkspaceDocSnippet {
  id: string
  label: string
  code: string
  notes?: string[]
  hasPlaceholderSecrets: boolean
  secretPlaceholderRef: string | null
}

export interface WorkspaceDocService {
  serviceKey: string
  category: string
  label: string
  endpoint: string
  port: number | null
  resourceName: string | null
  snippets: WorkspaceDocSnippet[]
}

export interface WorkspaceDocNote {
  noteId: string
  content: string
  authorId: string
  createdAt: string
  updatedAt: string
}

export interface WorkspaceDocsResponse {
  workspaceId: string
  tenantId: string
  generatedAt: string
  baseUrl: string
  stale?: boolean
  authInstructions: {
    method: string
    tokenEndpoint: string | null
    clientIdPlaceholder: string
    clientSecretPlaceholder: string
    scopeHint: string
    consoleRef: string
  }
  enabledServices: WorkspaceDocService[]
  customNotes: WorkspaceDocNote[]
}

function authHeaders(token: string): HeadersInit {
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function fetchWorkspaceDocs(workspaceId: string, token: string): Promise<WorkspaceDocsResponse> {
  return requestJson<WorkspaceDocsResponse>(`/v1/workspaces/${workspaceId}/docs`, {
    headers: authHeaders(token)
  })
}

export async function createDocNote(workspaceId: string, content: string, token: string): Promise<WorkspaceDocNote> {
  return requestJson<WorkspaceDocNote>(`/v1/workspaces/${workspaceId}/docs/notes`, {
    method: 'POST',
    headers: authHeaders(token),
    body: { content }
  })
}

export async function updateDocNote(workspaceId: string, noteId: string, content: string, token: string): Promise<WorkspaceDocNote> {
  return requestJson<WorkspaceDocNote>(`/v1/workspaces/${workspaceId}/docs/notes/${noteId}`, {
    method: 'PUT',
    headers: authHeaders(token),
    body: { content }
  })
}

export async function deleteDocNote(workspaceId: string, noteId: string, token: string): Promise<void> {
  await requestJson(`/v1/workspaces/${workspaceId}/docs/notes/${noteId}`, {
    method: 'DELETE',
    headers: authHeaders(token)
  })
}
