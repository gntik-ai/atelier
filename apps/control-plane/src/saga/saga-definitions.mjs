import {
  assignKeycloakRole,
  revokeKeycloakRole,
  revertMembershipRecord,
  updateMembershipRecord
} from '../workflows/wf-con-001.mjs';
import {
  configureApisixRoutes,
  createKafkaNamespace,
  createKeycloakRealm,
  createPostgresqlBoundary,
  deleteKafkaNamespace,
  deleteKeycloakRealm,
  deletePostgresqlBoundary,
  removeApisixRoutes
} from '../workflows/wf-con-002.mjs';
import {
  createKeycloakClient,
  createPostgresqlWorkspace,
  deleteKeycloakClient,
  deletePostgresqlWorkspace,
  releaseS3Storage,
  reserveS3Storage
} from '../workflows/wf-con-003.mjs';
import {
  createKeycloakCredential,
  deleteCredentialMetadata,
  recordCredentialMetadata,
  removeApisixConsumer,
  revertKeycloakCredential,
  syncApisixConsumer
} from '../workflows/wf-con-004.mjs';
import { createServiceAccount, deleteServiceAccount } from '../workflows/wf-con-006.mjs';

export const sagaDefinitions = new Map([
  ['WF-CON-001', {
    workflowId: 'WF-CON-001',
    provisional: false,
    recoveryPolicy: 'compensate',
    steps: [
      { ordinal: 1, key: 'assign-keycloak-role', auditMilestone: true, forward: assignKeycloakRole, compensate: revokeKeycloakRole },
      { ordinal: 2, key: 'update-membership-record', auditMilestone: true, forward: updateMembershipRecord, compensate: revertMembershipRecord }
    ]
  }],
  ['WF-CON-002', {
    workflowId: 'WF-CON-002',
    provisional: false,
    recoveryPolicy: 'compensate',
    steps: [
      { ordinal: 1, key: 'create-keycloak-realm', auditMilestone: true, forward: createKeycloakRealm, compensate: deleteKeycloakRealm }, // TODO: verify step key matches catalog entry
      { ordinal: 2, key: 'create-postgresql-boundary', auditMilestone: true, forward: createPostgresqlBoundary, compensate: deletePostgresqlBoundary }, // TODO: verify step key matches catalog entry
      { ordinal: 3, key: 'create-kafka-namespace', auditMilestone: true, forward: createKafkaNamespace, compensate: deleteKafkaNamespace }, // TODO: verify step key matches catalog entry
      { ordinal: 4, key: 'configure-apisix-routes', auditMilestone: true, forward: configureApisixRoutes, compensate: removeApisixRoutes } // TODO: verify step key matches catalog entry
    ]
  }],
  ['WF-CON-003', {
    workflowId: 'WF-CON-003',
    provisional: false,
    recoveryPolicy: 'compensate',
    steps: [
      { ordinal: 1, key: 'create-keycloak-client', auditMilestone: true, forward: createKeycloakClient, compensate: deleteKeycloakClient }, // TODO: verify step key matches catalog entry
      { ordinal: 2, key: 'create-postgresql-workspace', auditMilestone: true, forward: createPostgresqlWorkspace, compensate: deletePostgresqlWorkspace }, // TODO: verify step key matches catalog entry
      { ordinal: 3, key: 'reserve-s3-storage', auditMilestone: true, forward: reserveS3Storage, compensate: releaseS3Storage } // TODO: verify step key matches catalog entry
    ]
  }],
  ['WF-CON-004', {
    workflowId: 'WF-CON-004',
    provisional: false,
    recoveryPolicy: 'compensate',
    steps: [
      { ordinal: 1, key: 'create-keycloak-credential', auditMilestone: true, forward: createKeycloakCredential, compensate: revertKeycloakCredential }, // TODO: verify step key matches catalog entry
      { ordinal: 2, key: 'sync-apisix-consumer', auditMilestone: true, forward: syncApisixConsumer, compensate: removeApisixConsumer }, // TODO: verify step key matches catalog entry
      { ordinal: 3, key: 'record-credential-metadata', auditMilestone: true, forward: recordCredentialMetadata, compensate: deleteCredentialMetadata } // TODO: verify step key matches catalog entry
    ]
  }],
  ['WF-CON-005', {
    workflowId: 'WF-CON-005',
    provisional: true,
    recoveryPolicy: 'compensate',
    steps: [] // WF-CON-005 is provisional; add steps when catalog entry is finalized
  }],
  ['WF-CON-006', {
    workflowId: 'WF-CON-006',
    provisional: false,
    recoveryPolicy: 'compensate',
    steps: [
      { ordinal: 1, key: 'create-service-account', auditMilestone: true, forward: createServiceAccount, compensate: deleteServiceAccount } // TODO: verify step key matches catalog entry
    ] // WF-CON-006 steps to be completed when catalog entry is finalized per specs/067
  }]
]);
