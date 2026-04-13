import { config } from './config.mjs';
import { buildServiceUrl, encodePathSegment } from './network.mjs';

export async function fetchEnabledCapabilities(workspaceId, authToken) {
  const workspaceIdPath = encodePathSegment(workspaceId, 'workspaceId');
  const url = buildServiceUrl(
    config.effectiveCapabilitiesBaseUrl,
    `v1/workspaces/${workspaceIdPath}/effective-capabilities`
  );
  const res = await fetch(url, {
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : {}
  });

  if (!res.ok) {
    throw new Error(`capabilities fetch failed: ${res.status}`);
  }

  const body = await res.json();
  return new Set(body.capabilities ?? []);
}
