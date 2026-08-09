import { randomUUID } from 'node:crypto';

import { config } from './config.mjs';
import { buildServiceUrl, encodePathSegment } from './network.mjs';

const PUBLIC_API_VERSION = '2026-03-26';

export async function fetchEnabledCapabilities(workspaceId, authToken) {
  const workspaceIdPath = encodePathSegment(workspaceId, 'workspaceId');
  const url = buildServiceUrl(
    config.effectiveCapabilitiesBaseUrl,
    `v1/workspaces/${workspaceIdPath}/effective-capabilities`
  );
  const res = await fetch(url, {
    headers: {
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      'X-API-Version': PUBLIC_API_VERSION,
      'X-Correlation-Id': randomUUID()
    }
  });

  if (!res.ok) {
    throw new Error(`capabilities fetch failed: ${res.status}`);
  }

  const body = await res.json();
  return new Set(body.capabilities ?? []);
}
