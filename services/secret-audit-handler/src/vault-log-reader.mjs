import fs from 'node:fs';
import readline from 'node:readline';
import { randomUUID } from 'node:crypto';

export function parseVaultEntry(line) {
  const entry = JSON.parse(line);
  const path = entry?.request?.path?.replace(/^secret\/data\//, '') ?? 'unknown/unknown';
  const [domain = 'platform', ...rest] = path.split('/');
  const secretName = rest.at(-1) ?? 'unknown';
  const requestor = entry?.auth?.display_name ?? 'unknown';
  const namespace = entry?.auth?.metadata?.service_account_namespace ?? 'unknown';
  const serviceAccount = entry?.auth?.metadata?.service_account_name ?? requestor;
  const operation = entry?.error ? 'denied' : mapOperation(entry?.request?.operation);
  return {
    eventId: entry?.request?.id ?? randomUUID(),
    timestamp: entry?.time ?? new Date().toISOString(),
    operation,
    domain,
    secretPath: path,
    secretName,
    requestorIdentity: {
      type: namespace === 'unknown' ? 'user' : 'service',
      name: requestor,
      namespace,
      serviceAccount
    },
    result: entry?.error ? 'denied' : 'success',
    denialReason: entry?.error ?? null,
    vaultRequestId: entry?.request?.id ?? randomUUID()
  };
}

function mapOperation(operation = 'read') {
  if (operation === 'delete') return 'delete';
  if (operation === 'update' || operation === 'create') return 'write';
  return 'read';
}

export async function* createLogTailer(filePath) {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.trim()) {
      yield parseVaultEntry(line);
    }
  }
  fs.watch(filePath, () => undefined);
}
