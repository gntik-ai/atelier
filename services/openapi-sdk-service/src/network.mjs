const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const CLUSTER_SUFFIXES = ['.svc', '.svc.cluster.local', '.cluster.local'];
const SINGLE_LABEL_HOST_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

function isAllowedInternalHttpHostname(hostname, { allowBareInternalHttp = false } = {}) {
  const normalized = String(hostname || '').trim().toLowerCase();
  if (!normalized) return false;
  if (LOOPBACK_HOSTS.has(normalized)) return true;
  if (CLUSTER_SUFFIXES.some((suffix) => normalized.endsWith(suffix))) return true;
  return allowBareInternalHttp && SINGLE_LABEL_HOST_PATTERN.test(normalized);
}

export function normalizeServiceBaseUrl(rawValue, label, options = {}) {
  if (typeof rawValue !== 'string' || rawValue.trim() === '') {
    throw new Error(`${label} must be a non-empty URL`);
  }

  let parsed;
  try {
    parsed = new URL(rawValue);
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`${label} must use http or https`);
  }

  if (parsed.username || parsed.password) {
    throw new Error(`${label} must not embed credentials`);
  }

  if (parsed.search || parsed.hash) {
    throw new Error(`${label} must not include query parameters or fragments`);
  }

  if (parsed.protocol === 'http:' && !isAllowedInternalHttpHostname(parsed.hostname, options)) {
    throw new Error(`${label} must use https or an approved internal http hostname`);
  }

  parsed.pathname = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '');
  return parsed.toString().replace(/\/$/, '');
}

export function buildServiceUrl(baseUrl, relativePath = '') {
  if (typeof relativePath !== 'string') {
    throw new Error('relativePath must be a string');
  }

  const trimmedPath = relativePath.trim().replace(/^\/+/, '');
  if (trimmedPath.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(trimmedPath)) {
    throw new Error('relativePath must stay relative to the configured base URL');
  }

  return new URL(trimmedPath, `${baseUrl}/`).toString();
}

export function encodePathSegment(value, label) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return encodeURIComponent(normalized);
}
