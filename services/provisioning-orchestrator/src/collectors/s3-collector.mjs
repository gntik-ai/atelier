/**
 * S3-compatible storage configuration collector.
 * Extracts bucket list, versioning, lifecycle, policies, and CORS for tenant-prefixed buckets.
 * @module collectors/s3-collector
 */

import { redactSensitiveFields } from './types.mjs';
import { normalizeServiceBaseUrl } from '../http/safe-url.mjs';

const DOMAIN_KEY = 'storage';

/**
 * Minimal S3 XML → JS helper for list-buckets response.
 * @param {string} xml
 * @returns {string[]}
 */
function parseBucketNames(xml) {
  const names = [];
  const regex = /<Name>(.*?)<\/Name>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) names.push(match[1]);
  return names;
}

/**
 * Minimal S3 XML helper for versioning status.
 * @param {string} xml
 * @returns {string}
 */
function parseVersioningStatus(xml) {
  const match = /<Status>(.*?)<\/Status>/.exec(xml);
  return match?.[1] ?? 'Disabled';
}

/**
 * @param {string} tenantId
 * @param {Object} [options]
 * @param {typeof globalThis.fetch} [options.fetchFn]
 * @returns {Promise<import('./types.mjs').CollectorResult>}
 */
export async function collect(tenantId, options = {}) {
  const exportedAt = new Date().toISOString();
  const fetchFn = options.fetchFn ?? globalThis.fetch;

  const endpoint = process.env.CONFIG_EXPORT_S3_ENDPOINT;
  const accessKey = process.env.CONFIG_EXPORT_S3_ACCESS_KEY_ID;
  const secretKey = process.env.CONFIG_EXPORT_S3_SECRET_ACCESS_KEY;

  if (!endpoint) {
    return { domain_key: DOMAIN_KEY, status: 'not_available', exported_at: exportedAt, reason: 'S3 endpoint not configured (CONFIG_EXPORT_S3_ENDPOINT)', data: null };
  }

  try {
    const normalizedEndpoint = normalizeServiceBaseUrl(endpoint, 'CONFIG_EXPORT_S3_ENDPOINT', {
      allowBareInternalHttp: true,
    });
    const buildBucketUrl = (bucketName = '', query = '') => {
      const path = bucketName ? `${encodeURIComponent(bucketName)}` : '';
      const url = new URL(path, `${normalizedEndpoint}/`);
      url.search = query ? `?${query}` : '';
      return url.toString();
    };

    // List buckets — simplified; in production would use AWS Sig v4
    const listRes = await fetchFn(buildBucketUrl(), {
      headers: {
        ...(accessKey ? { 'x-amz-access-key-id': accessKey } : {}),
      },
    });
    if (!listRes.ok) throw new Error(`S3 ListBuckets failed: ${listRes.status}`);

    const listXml = await listRes.text();
    const allBuckets = parseBucketNames(listXml);
    const tenantPrefix = `${tenantId}-`;
    const tenantBuckets = allBuckets.filter(b => b.startsWith(tenantPrefix));

    if (tenantBuckets.length === 0) {
      return { domain_key: DOMAIN_KEY, status: 'empty', exported_at: exportedAt, items_count: 0, data: { buckets: [] } };
    }

    const buckets = await Promise.all(tenantBuckets.map(async (bucketName) => {
      const bucket = { name: bucketName, region: null, versioning: 'Disabled', lifecycle_rules: [], bucket_policy: null, cors_rules: [] };

      try {
        const vRes = await fetchFn(buildBucketUrl(bucketName, 'versioning'), { headers: {} });
        if (vRes.ok) bucket.versioning = parseVersioningStatus(await vRes.text());
      } catch { /* ignore */ }

      try {
        const lcRes = await fetchFn(buildBucketUrl(bucketName, 'lifecycle'), { headers: {} });
        if (lcRes.ok) bucket.lifecycle_rules = await lcRes.json().catch(() => []);
      } catch { /* ignore */ }

      try {
        const polRes = await fetchFn(buildBucketUrl(bucketName, 'policy'), { headers: {} });
        if (polRes.ok) bucket.bucket_policy = await polRes.json().catch(() => null);
      } catch { /* ignore */ }

      try {
        const corsRes = await fetchFn(buildBucketUrl(bucketName, 'cors'), { headers: {} });
        if (corsRes.ok) bucket.cors_rules = await corsRes.json().catch(() => []);
      } catch { /* ignore */ }

      return bucket;
    }));

    const data = redactSensitiveFields({ buckets });
    return { domain_key: DOMAIN_KEY, status: 'ok', exported_at: exportedAt, items_count: buckets.length, data };
  } catch (err) {
    return { domain_key: DOMAIN_KEY, status: 'error', exported_at: exportedAt, error: err.message, data: null };
  }
}
