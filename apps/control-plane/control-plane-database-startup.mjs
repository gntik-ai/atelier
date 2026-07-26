import { ensureSchema } from './tenant-store.mjs';
import { ensureSagaSchema, recoverSagas } from './saga.mjs';
import { applyGovernanceSchema } from './governance-schema.mjs';
import { applyWebhookSchema } from './webhook-schema.mjs';
import {
  verifyWebhookDatabasePrincipalConnections,
  verifyWebhookDatabasePrincipalSessions,
} from './webhook-database-principals.mjs';

export async function reconcileWebhookLifecycleAuditAccess(controlPlanePool) {
  await controlPlanePool.query(
    `REVOKE ALL PRIVILEGES ON TABLE plan_audit_events
       FROM falcone_webhook_key_lifecycle;
     GRANT SELECT, INSERT ON TABLE plan_audit_events
       TO falcone_webhook_key_lifecycle`,
  );
}

/**
 * Apply the control-plane and webhook startup schemas through their independent
 * database authorities.
 *
 * The existing global control-plane pool intentionally remains responsible for
 * tenant/workspace, saga, governance, and workspace-database capabilities. The
 * four C-25 pools are webhook-only: schema DDL, ordinary runtime work,
 * encrypted writes, and key lifecycle maintenance respectively.
 *
 * Dependencies are injectable so a real PostgreSQL boundary test can prove the
 * pool routing without importing the HTTP server or opening a listener.
 */
export async function prepareControlPlaneDatabases({
  controlPlanePool,
  webhookSchemaPool,
  webhookRuntimePool,
  webhookWritePool,
  webhookLifecyclePool,
  webhookDatabasePrincipals,
  attempt,
  dependencies = {},
}) {
  const applyTenantSchema = dependencies.ensureSchema ?? ensureSchema;
  const applySagaSchema = dependencies.ensureSagaSchema ?? ensureSagaSchema;
  const applyControlPlaneGovernance = dependencies.applyGovernanceSchema
    ?? applyGovernanceSchema;
  const applyWebhookMigrations = dependencies.applyWebhookSchema
    ?? applyWebhookSchema;
  const recoverControlPlaneSagas = dependencies.recoverSagas ?? recoverSagas;
  const reconcileLifecycleAudit = dependencies.reconcileWebhookLifecycleAuditAccess
    ?? reconcileWebhookLifecycleAuditAccess;
  const verifySessions = dependencies.verifyWebhookDatabasePrincipalSessions
    ?? verifyWebhookDatabasePrincipalSessions;
  const verifyConnections = dependencies.verifyWebhookDatabasePrincipalConnections
    ?? verifyWebhookDatabasePrincipalConnections;

  const principalOptions = {
    controlPlanePool,
    schemaPool: webhookSchemaPool,
    runtimePool: webhookRuntimePool,
    writerPool: webhookWritePool,
    lifecyclePool: webhookLifecyclePool,
    names: webhookDatabasePrincipals,
  };

  await verifySessions(principalOptions);
  await applyTenantSchema(controlPlanePool);
  await applySagaSchema(controlPlanePool);
  await applyControlPlaneGovernance(controlPlanePool);
  await reconcileLifecycleAudit(controlPlanePool);
  await applyWebhookMigrations(webhookSchemaPool, {
    principalNames: webhookDatabasePrincipals,
  });
  await verifyConnections(principalOptions);
  const recovered = await recoverControlPlaneSagas(controlPlanePool);
  console.log(
    `[control-plane] schema ready; recovered ${recovered} orphaned saga(s)`
      + ` (attempt ${attempt})`,
  );
  return recovered;
}
