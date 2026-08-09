/**
 * One-time back-fill: retrofit the identity-claim wiring onto tenant realms provisioned before
 * the #961 fix.
 *
 * Those realms were created without the KC26 user-profile declarations for `tenant_id` /
 * `workspace_id` and with mapper-less `tenant-context` / `workspace-context` client scopes, so
 * Keycloak discarded the attributes the platform stamped and no principal in them could ever
 * receive a `workspace_id` claim. `createRealm` now does both at provisioning time — this script
 * is the only thing that reaches realms that already exist.
 *
 * It calls the SAME two idempotent helpers provisioning uses (`relaxUserProfile` +
 * `applyRequiredClientScopes`), so a realm already carrying the declarations and the mapper is
 * left byte-identical: the profile PUT is skipped when nothing changed, and the mapper POST is
 * skipped when a mapper of that name is present. Safe to re-run.
 *
 * What it does NOT do: back-fill the attribute VALUES on users that already exist. A user created
 * while the attributes were undeclared has no stored workspace_id — declaring the attribute cannot
 * invent one. Those principals must be re-stamped through the normal admin path (or re-created);
 * the script lists them so an operator can see the size of that tail.
 *
 *   node scripts/backfill-tenant-realm-identity-claims.mjs             # dry run (default)
 *   node scripts/backfill-tenant-realm-identity-claims.mjs --apply
 *
 * Requires the usual kc-admin env: KEYCLOAK_BASE_URL, KEYCLOAK_ADMIN_USERNAME,
 * KEYCLOAK_ADMIN_PASSWORD, plus PROVISIONING_DB_URL / DATABASE_URL for the tenant list.
 * CLAUDE.md rule 7: this mutates Keycloak realm configuration — run it in an announced window.
 *
 * @module scripts/backfill-tenant-realm-identity-claims
 */

import {
  kcAdmin as defaultKcAdmin,
  TENANT_REALM_SCOPES,
  IDENTITY_PROFILE_ATTRIBUTES,
  CONTEXT_SCOPE_CLAIM_MAPPERS,
} from '../apps/control-plane/kc-admin.mjs';

export function parseBackfillArgs(argv = []) {
  const flags = { dryRun: true };
  for (const arg of argv) {
    if (arg === '--apply') flags.dryRun = false;
    else if (arg === '--dry-run') flags.dryRun = true;
  }
  return flags;
}

/** What a realm is missing today, read-only — this is also the dry-run report. */
export async function inspectRealm(kcAdmin, realm) {
  const profile = (await kcAdmin.getUserProfile(realm)) ?? {};
  const declared = new Set((profile.attributes ?? []).map((a) => a.name));
  const missingAttributes = IDENTITY_PROFILE_ATTRIBUTES
    .map((a) => a.name)
    .filter((name) => !declared.has(name));

  const scopes = await kcAdmin.listClientScopes(realm);
  const missingMappers = [];
  for (const [scopeName, mappers] of Object.entries(CONTEXT_SCOPE_CLAIM_MAPPERS)) {
    const scope = scopes.find((s) => s.name === scopeName);
    if (!scope) { missingMappers.push(`${scopeName} (scope absent)`); continue; }
    const present = new Set((scope.protocolMappers ?? []).map((m) => m.name));
    for (const mapper of mappers) {
      if (!present.has(mapper.name)) missingMappers.push(`${scopeName}/${mapper.name}`);
    }
  }
  return { realm, missingAttributes, missingMappers };
}

/**
 * @param {Object} opts
 * @param {string[]} [opts.argv]
 * @param {() => Promise<string[]>} opts.loadTenantRealms
 * @param {Object} [opts.kcAdmin] defaults to the control-plane singleton
 * @param {(user:object, realm:string) => void} [opts.emit]
 * @returns {Promise<{exitCode:number, result:object}>}
 */
export async function runBackfill(opts = {}) {
  const {
    argv = [],
    loadTenantRealms,
    kcAdmin = defaultKcAdmin,
    outStream = process.stdout,
  } = opts;
  const { dryRun } = parseBackfillArgs(argv);
  const emit = (o) => outStream.write(`${JSON.stringify(o, null, 2)}\n`);

  const realms = await loadTenantRealms();
  const inspected = [];
  const repaired = [];
  const failed = [];
  const usersWithoutBinding = [];

  for (const realm of realms) {
    let state;
    try {
      state = await inspectRealm(kcAdmin, realm);
    } catch (e) {
      failed.push({ realm, phase: 'inspect', error: String(e?.message ?? e) });
      continue;
    }
    inspected.push(state);
    const needsWork = state.missingAttributes.length > 0 || state.missingMappers.length > 0;

    if (needsWork && !dryRun) {
      try {
        await kcAdmin.relaxUserProfile(realm);
        await kcAdmin.applyRequiredClientScopes(realm, TENANT_REALM_SCOPES);
        repaired.push(realm);
      } catch (e) {
        failed.push({ realm, phase: 'repair', error: String(e?.message ?? e) });
        continue;
      }
    }

    // The tail the declaration cannot fix: principals whose attributes were dropped at create
    // time. Reported for every realm, repaired or not, because it is the operator's follow-up.
    try {
      const users = await kcAdmin.listUsers(realm, { max: 1000 });
      const orphans = users.filter((u) => !u.attributes?.workspace_id).map((u) => u.username);
      if (orphans.length > 0) usersWithoutBinding.push({ realm, count: orphans.length, usernames: orphans.slice(0, 25) });
    } catch (e) {
      failed.push({ realm, phase: 'list-users', error: String(e?.message ?? e) });
    }
  }

  const result = {
    mode: dryRun ? 'dry-run' : 'apply',
    counts: {
      realms: realms.length,
      needingWork: inspected.filter((s) => s.missingAttributes.length || s.missingMappers.length).length,
      repaired: repaired.length,
      failed: failed.length,
    },
    inspected,
    repaired,
    failed,
    // Not a failure: these users predate the declaration and hold no stored workspace_id.
    usersWithoutStoredWorkspaceId: usersWithoutBinding,
  };
  emit(result);
  return { exitCode: failed.length === 0 ? 0 : 1, result };
}

/* c8 ignore start — thin main-guard: env/pg wiring, exercised only on real invocation. */
async function main() {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: process.env.PROVISIONING_DB_URL ?? process.env.DATABASE_URL });

  const loadTenantRealms = async () => {
    const { rows } = await pool.query(
      "SELECT iam_realm FROM tenants WHERE status = 'active' AND iam_realm IS NOT NULL ORDER BY created_at",
    );
    return rows.map((r) => r.iam_realm);
  };

  const { exitCode } = await runBackfill({ argv: process.argv.slice(2), loadTenantRealms });
  await pool.end().catch(() => {});
  process.exit(exitCode);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    process.stderr.write(`${err?.stack ?? err}\n`);
    process.exit(1);
  });
}
/* c8 ignore stop */
