import { requestConsoleSessionJson } from '@/lib/console-session';

export interface PrivilegeDomainAssignment {
  memberId: string;
  workspaceId: string;
  tenantId: string;
  structural_admin: boolean;
  data_access: boolean;
  assignedAt: string;
  updatedAt: string;
}

export interface DenialRecord {
  id: string;
  tenantId: string;
  workspaceId: string | null;
  actorId: string;
  actorType: 'user' | 'api_key' | 'service_account' | 'anonymous';
  credentialDomain: 'structural_admin' | 'data_access' | 'none' | null;
  requiredDomain: 'structural_admin' | 'data_access';
  httpMethod: string;
  requestPath: string;
  sourceIp: string | null;
  correlationId: string;
  deniedAt: string;
}

export interface DenialsResponse {
  denials: DenialRecord[];
  total: number;
  limit: number;
  offset: number;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
  const payload = await response.json();
  if (!response.ok) throw payload;
  return payload;
}

export async function getPrivilegeDomainAssignment(workspaceId: string, memberId: string): Promise<PrivilegeDomainAssignment> {
  return request(`/api/workspaces/${workspaceId}/members/${memberId}/privilege-domains`);
}

export async function listPrivilegeDomainAssignments(workspaceId: string): Promise<PrivilegeDomainAssignment[]> {
  return request(`/api/workspaces/${workspaceId}/members/privilege-domains`);
}

export async function updatePrivilegeDomainAssignment(workspaceId: string, memberId: string, assignment: Pick<PrivilegeDomainAssignment, 'structural_admin' | 'data_access'>): Promise<PrivilegeDomainAssignment> {
  return request(`/api/workspaces/${workspaceId}/members/${memberId}/privilege-domains`, { method: 'PUT', body: JSON.stringify(assignment) });
}

// C-14: the denial-audit query is the ONLY privilege-domain client moved onto the authenticated,
// canonical /v1 transport. The active workspace is an authoritative, required path segment (encoded)
// — never a replaceable query value — and the active tenant is supplied as `tenantId` to satisfy the
// action's platform_admin requirement. `requestConsoleSessionJson` supplies the console bearer, the
// API-version and correlation headers, and the existing single refresh/retry behavior. The adjacent
// privilege-domain assignment clients above are separate findings and intentionally left untouched.
export async function queryPrivilegeDomainDenials(
  workspaceId: string,
  params: { tenantId?: string; requiredDomain?: string; actorId?: string; from?: string; to?: string; limit?: number; offset?: number } = {}
): Promise<DenialsResponse> {
  const encodedWorkspaceId = encodeURIComponent(workspaceId);
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  });
  const query = search.toString();
  return requestConsoleSessionJson<DenialsResponse>(
    `/v1/workspaces/${encodedWorkspaceId}/privilege-domains/audit${query ? `?${query}` : ''}`
  );
}
