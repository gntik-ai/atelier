// Bearer JWT verification for the executor (Keycloak / OIDC), dependency-free (node:crypto).
//
// Lets the executor authenticate USER/ADMIN requests directly — deriving tenant/workspace
// from verified token claims — so admin operations (e.g. API-key issuance) work through ANY
// gateway, including one that does not inject x-tenant-id from the JWT (the kind standalone
// APISIX). Mirrors the control-plane's verification (KEYCLOAK_JWKS_URL / _ISSUER / _AUDIENCE).
//
// Hardened against the classic JWT pitfalls: the signing alg is restricted to RSA
// (RS256/384/512) and matched to an RSA JWKS key, so `alg:none` and HS* algorithm-confusion
// are rejected; exp/nbf, issuer and audience are enforced.
//
// Multi-realm (fix-tenant-realm-token-issuance, A3): Falcone places each tenant in its OWN
// Keycloak realm whose NAME == the tenant id (see apps/control-plane/b-handlers.mjs:
// `realm = tenantId`). The verifier therefore trusts tokens from any realm UNDER THE SAME
// Keycloak base (derived from the configured issuer / jwks URL) — the platform realm AND the
// per-tenant realms — fetching each realm's JWKS on demand. For a tenant-realm token the
// tenant id is taken from the VERIFIED issuer (the realm name), which is cryptographically
// bound to the signature and cannot be forged by a tenant-A token claiming tenant_id=B; the
// per-resource tenant scoping downstream then enforces cross-tenant isolation. Tokens from an
// issuer outside the trusted base are rejected.
import crypto from 'node:crypto';

const b64urlToBuf = (s) => Buffer.from(s, 'base64url');
const b64urlToJson = (s) => JSON.parse(b64urlToBuf(s).toString('utf8'));
const ALG_DIGEST = { RS256: 'sha256', RS384: 'sha384', RS512: 'sha512' };
const MAX_OAUTH_CLIENT_ID_BYTES = 256;

// OAuth/OIDC client attribution may come only from signed client-id claims. A Keycloak `sub` is a
// subject (often a user) and is deliberately excluded. Keep the accepted identifier bounded and
// printable so it is safe as a metrics dimension; invalid preferred claims fall through to the
// next canonical alias rather than manufacturing an id.
function verifiedOAuthClientIdFromClaims(claims = {}) {
  for (const candidate of [claims.azp, claims.client_id, claims.clientId]) {
    if (typeof candidate !== 'string') continue;
    if (!candidate || Buffer.byteLength(candidate, 'utf8') > MAX_OAUTH_CLIENT_ID_BYTES) continue;
    if (!/^[\x21-\x7e]+$/.test(candidate)) continue;
    return candidate;
  }
  return undefined;
}

function workspaceIdsFromClaims(claims) {
  if (Array.isArray(claims.workspace_ids)) return claims.workspace_ids.map(String).filter(Boolean);
  if (typeof claims.workspace_ids === 'string') return claims.workspace_ids.split(/[ ,]+/).map((s) => s.trim()).filter(Boolean);
  if (claims.workspace_id) return [String(claims.workspace_id)];
  return undefined;
}

export function deriveIdentityFromClaims(claims, pathWorkspaceId) {
  const roles = claims.realm_access?.roles ?? [];
  const scopes = typeof claims.scope === 'string'
    ? claims.scope.split(' ').filter(Boolean)
    : (Array.isArray(claims.scopes) ? claims.scopes : []);
  // credentialWorkspaceId is set only when the JWT explicitly carries a workspace_id claim.
  // A tenant-only token (no workspace_id claim) leaves credentialWorkspaceId undefined,
  // which suppresses the path↔credential workspace binding check (the token is not
  // workspace-scoped and must not be rejected for addressing a specific workspace path).
  const credentialWorkspaceId = claims.workspace_id ?? undefined;
  const workspaceIds = workspaceIdsFromClaims(claims);
  const verifiedOAuthClientId = verifiedOAuthClientIdFromClaims(claims);
  return {
    tenantId: claims.tenant_id ?? undefined,
    workspaceId: credentialWorkspaceId ?? pathWorkspaceId,
    credentialWorkspaceId,
    actorId: claims.sub,
    roleName: 'falcone_app', // a user/admin JWT is not an api-key → no SET ROLE / RLS dbRole
    roles,
    scopes,
    ...(workspaceIds !== undefined ? { workspaceIds } : {}),
    ...(verifiedOAuthClientId !== undefined ? { verifiedOAuthClientId } : {}),
  };
}

// Derive the Keycloak realms base (".../realms/") and the platform realm name from whichever of
// the issuer or the JWKS certs URL is shaped like a Keycloak realm endpoint. Returns nulls when
// neither is realm-shaped (legacy single-key mode, e.g. a bare JWKS URL).
export function deriveRealmTopology(issuer, jwksUrl) {
  const fromIssuer = typeof issuer === 'string' && /^(.*\/realms\/)([^/]+)$/.exec(issuer);
  if (fromIssuer) return { realmsBase: fromIssuer[1], platformRealm: fromIssuer[2] };
  const fromJwks = typeof jwksUrl === 'string'
    && /^(.*\/realms\/)([^/]+)\/protocol\/openid-connect\/certs\/?$/.exec(jwksUrl);
  if (fromJwks) return { realmsBase: fromJwks[1], platformRealm: fromJwks[2] };
  return { realmsBase: null, platformRealm: null };
}

// Returns a verifier { verify(token, pathWorkspaceId) -> identity } or undefined when no
// jwksUrl is configured (the executor then falls back to gateway-injected identity headers).
// `revocationCheck` (fix-sa-credential-revocation-invalidate-tokens, #684): an OPTIONAL async hook
// `(claims) => boolean` run AFTER all offline validation passes. Returning true rejects the token
// (its underlying credential was revoked/rotated). Default undefined = no-op → fully back-compatible
// (offline-only verification, every existing test unchanged). It is the verifier's only statefulness
// and only fires for service-account tokens (the hook itself pre-filters non-SA tokens, no DB hit).
export function createJwtVerifier({
  jwksUrl,
  issuer,
  audience,
  fetchImpl = fetch,
  clockToleranceSec = 60,
  cacheMs = 300_000,
  allowTenantRealms = true,
  revocationCheck = undefined,
  now = () => Date.now(),
} = {}) {
  if (!jwksUrl) return undefined;
  const { realmsBase, platformRealm } = deriveRealmTopology(issuer, jwksUrl);
  const platformIssuer = issuer || (realmsBase ? `${realmsBase}${platformRealm}` : undefined);
  // Per-issuer JWKS caches (each realm has its own signing keys).
  const caches = new Map();

  // Classify a token's issuer against the trusted Keycloak base.
  //  - 'legacy'  : no trust domain configured (bare jwksUrl, no issuer) → accept any iss (back-compat)
  //  - 'platform': the platform realm issuer
  //  - 'tenant'  : a per-tenant realm under the same base (realm name carried back as .realm)
  //  - null      : issuer outside the trusted base → reject
  function classifyIssuer(iss) {
    if (!issuer && !realmsBase) return { kind: 'legacy' };
    if (platformIssuer && iss === platformIssuer) return { kind: 'platform' };
    if (allowTenantRealms && realmsBase && typeof iss === 'string' && iss.startsWith(realmsBase)) {
      const realm = iss.slice(realmsBase.length);
      if (realm && !realm.includes('/') && realm !== platformRealm) return { kind: 'tenant', realm };
    }
    return null;
  }

  function jwksUrlForIssuer(iss, kind) {
    // The platform realm uses the configured (possibly in-cluster) jwksUrl; a tenant realm's keys
    // are fetched from its own realm certs endpoint derived from the verified issuer.
    return kind === 'tenant' ? `${iss}/protocol/openid-connect/certs` : jwksUrl;
  }

  async function jwks(url, force) {
    const c = caches.get(url);
    if (!force && c && c.keys.length && now() - c.at < cacheMs) return c.keys;
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
    const body = await res.json();
    const keys = Array.isArray(body.keys) ? body.keys : [];
    caches.set(url, { keys, at: now() });
    return keys;
  }

  async function publicKeyFor(url, kid, alg) {
    const match = (keys) => keys.find((k) =>
      k.kty === 'RSA' && (!kid || k.kid === kid) && (!k.alg || k.alg === alg));
    let jwk = match(await jwks(url, false));
    if (!jwk) jwk = match(await jwks(url, true)); // key rotation: refetch once
    if (!jwk) throw new Error('no matching JWKS key');
    return crypto.createPublicKey({ key: jwk, format: 'jwk' });
  }

  return {
    async verify(token, pathWorkspaceId) {
      const parts = String(token).split('.');
      if (parts.length !== 3) throw new Error('malformed JWT');
      const [h, p, s] = parts;
      const header = b64urlToJson(h);
      const digest = ALG_DIGEST[header.alg];
      if (!digest) throw new Error(`unsupported alg ${header.alg}`); // rejects none / HS*
      const claims = b64urlToJson(p);

      // Decide which realm (and thus which JWKS) this token belongs to BEFORE trusting it.
      const trust = classifyIssuer(claims.iss);
      if (!trust) throw new Error('issuer not trusted');

      const key = await publicKeyFor(jwksUrlForIssuer(claims.iss, trust.kind), header.kid, header.alg);
      if (!crypto.verify(digest, Buffer.from(`${h}.${p}`), key, b64urlToBuf(s))) {
        throw new Error('bad signature');
      }
      const t = Math.floor(now() / 1000);
      if (typeof claims.exp === 'number' && t > claims.exp + clockToleranceSec) throw new Error('token expired');
      if (typeof claims.nbf === 'number' && t + clockToleranceSec < claims.nbf) throw new Error('token not yet valid');
      // Audience is enforced for the platform realm (its app clients share KEYCLOAK_AUDIENCE);
      // per-tenant realms use their own app-client audiences, so the realm-bound issuer is the
      // trust boundary there rather than a single configured audience.
      if (trust.kind === 'platform' && audience) {
        const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
        if (!aud.includes(audience)) throw new Error('audience mismatch');
      }
      // Stateful revocation/rotation cutoff (parity with apps/control-plane/jwt-verify.mjs):
      // offline validation cannot see a revoked/rotated SA credential. The injected hook (DB-backed,
      // SA-only) decides; a true result rejects the otherwise-valid token. Non-SA tokens are skipped
      // inside the hook (no DB hit), so user/owner authentication is unaffected.
      if (revocationCheck && await revocationCheck(claims)) throw new Error('credential revoked');

      const identity = deriveIdentityFromClaims(claims, pathWorkspaceId);
      // For a tenant realm the tenant id IS the realm name, taken from the verified issuer — it
      // cannot be forged by a claim, so a tenant-A token can never act as tenant B.
      if (trust.kind === 'tenant') identity.tenantId = trust.realm;
      return identity;
    },
  };
}
