import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STORAGE_PROGRAMMATIC_CREDENTIAL_ALLOWED_ACTIONS,
  STORAGE_PROGRAMMATIC_CREDENTIAL_ERROR_CODES,
  STORAGE_PROGRAMMATIC_CREDENTIAL_STATES,
  STORAGE_PROGRAMMATIC_CREDENTIAL_TYPES,
  buildStorageProgrammaticCredentialCollection,
  buildStorageProgrammaticCredentialRecord,
  buildStorageProgrammaticCredentialSecretEnvelope,
  revokeStorageProgrammaticCredential,
  rotateStorageProgrammaticCredential
} from '../../services/adapters/src/storage-programmatic-credentials.mjs';

test('storage programmatic credential helpers normalize records and one-time secret envelopes', () => {
  const envelope = buildStorageProgrammaticCredentialSecretEnvelope({
    tenantId: 'ten_01falcone',
    workspaceId: 'wrk_01falcone',
    displayName: 'CLI uploader',
    principal: {
      principalType: 'service_account',
      principalId: 'svc_01cli'
    },
    scopes: [{
      workspaceId: 'wrk_01falcone',
      bucketId: 'bucket_01assets',
      objectPrefix: 'uploads/',
      allowedActions: [
        'object.get',
        'object.put',
        'object.head'
      ]
    }],
    actorId: 'usr_01owner',
    actorType: 'user',
    ttlSeconds: 7200,
    now: '2026-03-28T02:00:00Z'
  });
  const collection = buildStorageProgrammaticCredentialCollection({
    items: [envelope.credential]
  });

  assert.equal(STORAGE_PROGRAMMATIC_CREDENTIAL_TYPES.ACCESS_KEY, 'access_key');
  assert.equal(STORAGE_PROGRAMMATIC_CREDENTIAL_STATES.ACTIVE, 'active');
  assert.equal(STORAGE_PROGRAMMATIC_CREDENTIAL_ALLOWED_ACTIONS.includes('object.put'), true);
  assert.equal(envelope.credential.workspaceId, 'wrk_01falcone');
  assert.equal(envelope.credential.tenantId, 'ten_01falcone');
  assert.equal(envelope.credential.credentialType, 'access_key');
  assert.equal(envelope.credential.state, 'active');
  assert.equal(envelope.credential.scopes[0].bucketId, 'bucket_01assets');
  assert.equal(envelope.credential.scopes[0].objectPrefix, 'uploads/');
  assert.equal(envelope.credential.accessKeyIdMasked.includes('…'), true);
  assert.equal(envelope.secretDelivery, 'one_time');
  assert.equal(typeof envelope.accessKeyId, 'string');
  assert.equal(typeof envelope.secretAccessKey, 'string');
  assert.equal(collection.items.length, 1);
});

test('storage programmatic credential helpers rotate and revoke without crossing workspace boundaries', () => {
  const record = buildStorageProgrammaticCredentialRecord({
    workspaceId: 'wrk_01falcone',
    displayName: 'Report reader',
    principal: {
      principalType: 'user',
      principalId: 'usr_01reporter'
    },
    scopes: [{
      workspaceId: 'wrk_01falcone',
      allowedActions: ['object.list', 'object.get']
    }],
    now: '2026-03-28T02:10:00Z'
  });
  const rotated = rotateStorageProgrammaticCredential({
    credential: record,
    requestedAt: '2026-03-28T02:15:00Z'
  });
  const revoked = revokeStorageProgrammaticCredential({
    credential: rotated.credential,
    requestedAt: '2026-03-28T02:16:00Z'
  });

  assert.equal(rotated.credential.secretVersion, 2);
  assert.equal(rotated.credential.lastRotatedAt, '2026-03-28T02:15:00.000Z');
  assert.equal(revoked.state, 'revoked');
  assert.equal(revoked.revokedAt, '2026-03-28T02:16:00.000Z');
});

test('storage programmatic credential helpers reject unsupported actions and cross-workspace scopes', () => {
  assert.throws(() => buildStorageProgrammaticCredentialRecord({
    workspaceId: 'wrk_01falcone',
    displayName: 'Invalid operations',
    principal: {
      principalType: 'service_account',
      principalId: 'svc_01invalid'
    },
    scopes: [{
      workspaceId: 'wrk_01falcone',
      allowedActions: ['bucket.delete']
    }]
  }), new RegExp(STORAGE_PROGRAMMATIC_CREDENTIAL_ERROR_CODES.INVALID_OPERATION));

  assert.throws(() => buildStorageProgrammaticCredentialRecord({
    workspaceId: 'wrk_01falcone',
    displayName: 'Cross workspace',
    principal: {
      principalType: 'service_account',
      principalId: 'svc_01invalid'
    },
    scopes: [{
      workspaceId: 'wrk_02other',
      allowedActions: ['object.list']
    }]
  }), new RegExp(STORAGE_PROGRAMMATIC_CREDENTIAL_ERROR_CODES.SCOPE_OUTSIDE_WORKSPACE));
});

test('storage programmatic credential rotation keeps identity and scope while refreshing secret material', () => {
  const issued = buildStorageProgrammaticCredentialSecretEnvelope({
    tenantId: 'ten_01falcone',
    workspaceId: 'wrk_01falcone',
    displayName: 'CI uploader',
    principal: {
      principalType: 'service_account',
      principalId: 'svc_01ci'
    },
    scopes: [{
      workspaceId: 'wrk_01falcone',
      bucketId: 'bucket_01assets',
      objectPrefix: 'uploads/ci/',
      allowedActions: ['object.list', 'object.get', 'object.put', 'object.head']
    }],
    actorId: 'usr_01owner',
    actorType: 'user',
    now: '2026-03-28T02:20:00Z'
  });
  const rotated = rotateStorageProgrammaticCredential({
    credential: issued.credential,
    actorId: 'usr_01owner',
    actorType: 'user',
    correlationId: 'cor_credential_rotate_01',
    requestedAt: '2026-03-28T02:25:00Z'
  });

  assert.equal(rotated.credential.credentialId, issued.credential.credentialId);
  assert.deepEqual(rotated.credential.principal, issued.credential.principal);
  assert.deepEqual(rotated.credential.scopes, issued.credential.scopes);
  assert.equal(rotated.credential.secretVersion, issued.credential.secretVersion + 1);
  assert.equal(rotated.credential.lastRotatedAt, '2026-03-28T02:25:00.000Z');
  assert.equal(rotated.credential.updatedAt, '2026-03-28T02:25:00.000Z');
  assert.equal(rotated.credential.createdAt, issued.credential.createdAt);
  assert.notEqual(rotated.accessKeyId, issued.accessKeyId);
  assert.notEqual(rotated.secretAccessKey, issued.secretAccessKey);
  assert.equal(rotated.credential.accessKeyIdMasked, `${rotated.accessKeyId.slice(0, 4)}…${rotated.accessKeyId.slice(-4)}`);
  assert.equal(rotated.credential.issuer.correlationId, 'cor_credential_rotate_01');
});

test('storage programmatic credential helpers reject rotation of revoked credentials and keep revocation traceable', () => {
  const record = buildStorageProgrammaticCredentialRecord({
    tenantId: 'ten_01falcone',
    workspaceId: 'wrk_01falcone',
    displayName: 'Emergency revoke',
    principal: {
      principalType: 'user',
      principalId: 'usr_01operator'
    },
    scopes: [{
      workspaceId: 'wrk_01falcone',
      allowedActions: ['object.list', 'object.get']
    }],
    actorId: 'usr_01owner',
    actorType: 'user',
    now: '2026-03-28T02:30:00Z'
  });
  const revoked = revokeStorageProgrammaticCredential({
    credential: record,
    actorId: 'usr_01security',
    actorType: 'user',
    correlationId: 'cor_credential_revoke_01',
    requestedAt: '2026-03-28T02:31:00Z'
  });

  assert.equal(revoked.state, 'revoked');
  assert.equal(revoked.revokedAt, '2026-03-28T02:31:00.000Z');
  assert.equal(revoked.updatedAt, '2026-03-28T02:31:00.000Z');
  assert.equal(revoked.lastRotatedAt, record.lastRotatedAt);
  assert.equal(revoked.issuer.actorId, 'usr_01security');
  assert.equal(revoked.issuer.correlationId, 'cor_credential_revoke_01');
  assert.match(revoked.accessKeyIdMasked, /^AKST…[A-Z0-9]{4}$/);
  assert.throws(() => rotateStorageProgrammaticCredential({
    credential: revoked,
    requestedAt: '2026-03-28T02:32:00Z'
  }), new RegExp(STORAGE_PROGRAMMATIC_CREDENTIAL_ERROR_CODES.INVALID_STATE));
});
