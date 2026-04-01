import type { BackupScopeEntry, BackupScopeMatrixResponse, TenantBackupScopeEntry, TenantBackupScopeResponse } from '@/lib/backupScopeApi'

export const mockEntries: BackupScopeEntry[] = [
  { componentKey: 'postgresql', profileKey: 'standard', coverageStatus: 'platform-managed', backupGranularity: 'incremental', rpoRangeMinutes: { min: 60, max: 240 }, rtoRangeMinutes: { min: 30, max: 120 }, operationalStatus: 'unknown', supportedByProfile: true, maxBackupFrequencyMinutes: 60, maxRetentionDays: 30, maxConcurrentJobs: 2, maxBackupSizeGb: null, preconditions: ['Requires pg_basebackup'], limitations: [], airGapNotes: null, planCapabilityKey: null },
  { componentKey: 'mongodb', profileKey: 'standard', coverageStatus: 'platform-managed', backupGranularity: 'full', rpoRangeMinutes: { min: 240, max: 480 }, rtoRangeMinutes: { min: 60, max: 120 }, operationalStatus: 'unknown', supportedByProfile: true, maxBackupFrequencyMinutes: 240, maxRetentionDays: 30, maxConcurrentJobs: 2, maxBackupSizeGb: null, preconditions: ['mongodump available'], limitations: [], airGapNotes: null, planCapabilityKey: null },
  { componentKey: 'kafka', profileKey: 'standard', coverageStatus: 'operator-managed', backupGranularity: 'none', rpoRangeMinutes: null, rtoRangeMinutes: null, operationalStatus: 'unknown', supportedByProfile: false, maxBackupFrequencyMinutes: null, maxRetentionDays: null, maxConcurrentJobs: null, maxBackupSizeGb: null, preconditions: ['Operator must configure MirrorMaker'], limitations: ['Platform does not manage Kafka backup'], airGapNotes: null, planCapabilityKey: null },
  { componentKey: 'openwhisk', profileKey: 'standard', coverageStatus: 'operator-managed', backupGranularity: 'config-only', rpoRangeMinutes: null, rtoRangeMinutes: null, operationalStatus: 'unknown', supportedByProfile: false, maxBackupFrequencyMinutes: null, maxRetentionDays: 30, maxConcurrentJobs: null, maxBackupSizeGb: null, preconditions: ['CouchDB export tool available'], limitations: ['Only action/trigger definitions'], airGapNotes: null, planCapabilityKey: null },
  { componentKey: 's3', profileKey: 'standard', coverageStatus: 'platform-managed', backupGranularity: 'incremental', rpoRangeMinutes: { min: 240, max: 480 }, rtoRangeMinutes: { min: 60, max: 120 }, operationalStatus: 'unknown', supportedByProfile: true, maxBackupFrequencyMinutes: 240, maxRetentionDays: 30, maxConcurrentJobs: 2, maxBackupSizeGb: 100, preconditions: ['S3-compatible storage accessible'], limitations: [], airGapNotes: null, planCapabilityKey: null },
  { componentKey: 'keycloak', profileKey: 'standard', coverageStatus: 'platform-managed', backupGranularity: 'config-only', rpoRangeMinutes: null, rtoRangeMinutes: null, operationalStatus: 'unknown', supportedByProfile: true, maxBackupFrequencyMinutes: null, maxRetentionDays: 30, maxConcurrentJobs: 1, maxBackupSizeGb: null, preconditions: ['Keycloak realm export CLI available'], limitations: ['Only realm configuration exported'], airGapNotes: null, planCapabilityKey: null },
  { componentKey: 'apisix_config', profileKey: 'standard', coverageStatus: 'not-supported', backupGranularity: 'config-only', rpoRangeMinutes: null, rtoRangeMinutes: null, operationalStatus: 'unknown', supportedByProfile: false, maxBackupFrequencyMinutes: null, maxRetentionDays: 30, maxConcurrentJobs: 1, maxBackupSizeGb: null, preconditions: ['etcd snapshot tool available'], limitations: ['Only route/plugin configuration'], airGapNotes: null, planCapabilityKey: null }
]

export const mockBackupScopeMatrix: BackupScopeMatrixResponse = {
  activeProfile: 'standard',
  requestedProfile: 'all',
  entries: mockEntries,
  generatedAt: '2026-04-01T10:00:00.000Z',
  correlationId: 'req-test-123'
}

export const mockTenantEntries: TenantBackupScopeEntry[] = [
  { componentKey: 'postgresql', coverageStatus: 'platform-managed', backupGranularity: 'incremental', rpoRangeMinutes: { min: 60, max: 240 }, rtoRangeMinutes: { min: 30, max: 120 }, operationalStatus: 'unknown', tenantHasResources: true, planRestriction: null, recommendation: null },
  { componentKey: 's3', coverageStatus: 'platform-managed', backupGranularity: 'incremental', rpoRangeMinutes: { min: 240, max: 480 }, rtoRangeMinutes: { min: 60, max: 120 }, operationalStatus: 'unknown', tenantHasResources: true, planRestriction: null, recommendation: 'Consider external backup for objects > 10 GB' }
]

export const mockTenantBackupScope: TenantBackupScopeResponse = {
  tenantId: 'ten-xyz',
  activeProfile: 'standard',
  planId: 'plan-pro',
  entries: mockTenantEntries,
  generatedAt: '2026-04-01T10:00:00.000Z',
  correlationId: 'req-test-456'
}
