export function buildRotationProcedureSection(workspaceContext = {}) {
  const baseUrl = workspaceContext.baseUrl ?? 'https://api.example.test';
  const consoleUrl = `${baseUrl.replace(/\/$/, '')}/console/service-accounts`;
  return `## API Key Rotation Procedure

Rotate API keys without downtime by creating a new key, updating clients, and letting the deprecated key expire after the configured grace period.

### Console flow
1. Open the service account in the console.
2. Choose **Rotate** and set **Grace period** in seconds.
3. Copy the new secret and update your client configuration.
4. Verify traffic succeeds with the new key.
5. Either wait for expiry or use **Force Complete** for emergency cutover.

### API flow
- Start rotation from \`${baseUrl}/v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}/credential-rotations\`.
- Check status at \`${baseUrl}/v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}/rotation-status\`.
- Review audit history at \`${baseUrl}/v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}/rotation-history\`.

### Choosing a grace period
Use short grace periods for highly controlled deployments and longer windows for mobile, batch, or multi-region clients. A grace period of \`0\` performs immediate rotation.

### JavaScript example
\`\`\`js
const baseUrl = '${baseUrl}';
const rotateResponse = await fetch(baseUrl + '/v1/workspaces/wrk_123/service-accounts/svc_123/credential-rotations', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-api-version': '2026-03-26', 'x-correlation-id': 'corr_rotate_123', 'idempotency-key': 'idem_rotate_123' },
  body: JSON.stringify({ requestedByUserId: 'usr_123', rotateReason: 'scheduled rotation', gracePeriodSeconds: 3600 })
});
const rotation = await rotateResponse.json();
const statusResponse = await fetch(baseUrl + '/v1/workspaces/wrk_123/service-accounts/svc_123/rotation-status', { headers: { 'x-api-version': '2026-03-26', 'x-correlation-id': 'corr_rotate_124' } });
console.log(rotation, await statusResponse.json());
\`\`\`

### Python example
\`\`\`python
import requests
base_url = '${baseUrl}'
rotation = requests.post(
    f"{base_url}/v1/workspaces/wrk_123/service-accounts/svc_123/credential-rotations",
    headers={"content-type": "application/json", "x-api-version": "2026-03-26", "x-correlation-id": "corr_rotate_123", "idempotency-key": "idem_rotate_123"},
    json={"requestedByUserId": "usr_123", "rotateReason": "scheduled rotation", "gracePeriodSeconds": 3600},
).json()
status = requests.get(
    f"{base_url}/v1/workspaces/wrk_123/service-accounts/svc_123/rotation-status",
    headers={"x-api-version": "2026-03-26", "x-correlation-id": "corr_rotate_124"},
).json()
print(rotation, status)
\`\`\`

### Warnings
- Only one rotation can be in progress for a service account at a time.
- Deprecated credentials may still authenticate until the grace period expires.
- For emergency rollback or incident response, use force-complete.

Manage credentials in the console: ${consoleUrl}
`;
}
