/**
 * OpenWhisk action: GET /v1/backup/operations/:id — query operation status.
 */
import { validateToken, AuthError } from '../api/backup-status.auth.js';
import * as repo from './operations.repository.js';
function extractToken(headers) {
    const auth = headers.authorization ?? headers.Authorization;
    if (!auth?.startsWith('Bearer '))
        return null;
    return auth.slice(7);
}
function serializeOperation(op, includeTechnical) {
    const metadata = op.metadata ?? {};
    const isSimulation = metadata.execution_mode === 'simulation';
    const response = {
        schema_version: '1',
        operation: {
            id: op.id,
            type: op.type,
            tenant_id: op.tenantId,
            component_type: op.componentType,
            instance_id: op.instanceId,
            status: op.status,
            requester_id: op.requesterId,
            accepted_at: op.acceptedAt.toISOString(),
            in_progress_at: op.inProgressAt?.toISOString() ?? null,
            completed_at: op.completedAt?.toISOString() ?? null,
            failed_at: op.failedAt?.toISOString() ?? null,
            snapshot_id: op.snapshotId ?? null,
            failure_reason_public: op.failureReasonPublic ?? null,
            execution_mode: isSimulation ? 'simulation' : 'operative',
            target_environment: isSimulation ? (typeof metadata.target_environment === 'string' ? metadata.target_environment : null) : null,
            validation_summary: isSimulation && typeof metadata.validation_summary === 'object' && metadata.validation_summary !== null
                ? metadata.validation_summary
                : null,
            evidence_refs: isSimulation && Array.isArray(metadata.evidence_refs)
                ? metadata.evidence_refs
                : undefined,
        },
    };
    if (includeTechnical) {
        response.operation.failure_reason = op.failureReason ?? null;
    }
    return response;
}
export async function main(params) {
    const headers = { 'Content-Type': 'application/json' };
    try {
        const rawToken = extractToken(params.__ow_headers ?? {});
        if (!rawToken)
            return { statusCode: 401, headers, body: { error: 'Missing authorization' } };
        const token = await validateToken(rawToken);
        // Extract operation ID from path or params
        const operationId = params.id ?? params.__ow_path?.split('/').pop();
        if (!operationId) {
            return { statusCode: 400, headers, body: { error: 'Missing operation id' } };
        }
        const operation = await repo.findById(operationId);
        if (!operation) {
            return { statusCode: 404, headers, body: { error: 'Operation not found' } };
        }
        // Access control: requester owns the operation, or has global read scope
        if (token.sub !== operation.requesterId && !token.scopes.includes('backup:read:global')) {
            return { statusCode: 403, headers, body: { error: 'Insufficient scope' } };
        }
        const includeTechnical = token.scopes.includes('backup-status:read:technical');
        const body = serializeOperation(operation, includeTechnical);
        return { statusCode: 200, headers, body };
    }
    catch (err) {
        if (err instanceof AuthError) {
            return { statusCode: err.statusCode, headers, body: { error: err.message } };
        }
        console.error('[get-operation] unexpected error:', err);
        return { statusCode: 500, headers, body: { error: 'Internal server error' } };
    }
}
