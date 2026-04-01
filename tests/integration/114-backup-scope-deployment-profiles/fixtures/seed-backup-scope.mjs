export const PROFILE_SEED = [
  { profile_key: 'all-in-one', display_name: 'All-in-One', description: 'Single-node development and evaluation deployment', is_active: false },
  { profile_key: 'standard', display_name: 'Standard', description: 'Multi-node production deployment with standard redundancy', is_active: true },
  { profile_key: 'ha', display_name: 'HA', description: 'High-availability production deployment with full redundancy', is_active: false },
  { profile_key: 'unknown', display_name: 'Unknown', description: 'Undetected or unconfigured deployment profile', is_active: false }
];

export const COMPONENTS = ['postgresql', 'mongodb', 'kafka', 'openwhisk', 's3', 'keycloak', 'apisix_config'];

export const SCOPE_SEED = [
  { component_key: 'postgresql', profile_key: 'all-in-one', coverage_status: 'platform-managed', backup_granularity: 'full', rpo_range_minutes: '[1440,1440]', rto_range_minutes: '[120,240]', max_backup_frequency_minutes: 1440, max_retention_days: 7, max_concurrent_jobs: 1, max_backup_size_gb: null, preconditions: ['Requires pg_basebackup'], limitations: ['Single daily backup window only'], air_gap_notes: null, plan_capability_key: null },
  { component_key: 'postgresql', profile_key: 'standard', coverage_status: 'platform-managed', backup_granularity: 'incremental', rpo_range_minutes: '[60,240]', rto_range_minutes: '[30,120]', max_backup_frequency_minutes: 60, max_retention_days: 30, max_concurrent_jobs: 2, max_backup_size_gb: null, preconditions: ['Requires pg_basebackup'], limitations: [], air_gap_notes: null, plan_capability_key: null },
  { component_key: 'postgresql', profile_key: 'ha', coverage_status: 'platform-managed', backup_granularity: 'incremental', rpo_range_minutes: '[15,60]', rto_range_minutes: '[15,60]', max_backup_frequency_minutes: 15, max_retention_days: 90, max_concurrent_jobs: 4, max_backup_size_gb: null, preconditions: ['Requires pg_basebackup'], limitations: [], air_gap_notes: null, plan_capability_key: null },
  { component_key: 'mongodb', profile_key: 'all-in-one', coverage_status: 'platform-managed', backup_granularity: 'full', rpo_range_minutes: '[1440,1440]', rto_range_minutes: '[120,240]', max_backup_frequency_minutes: 1440, max_retention_days: 7, max_concurrent_jobs: 1, max_backup_size_gb: null, preconditions: ['mongodump available'], limitations: ['Full dump only'], air_gap_notes: null, plan_capability_key: null },
  { component_key: 'mongodb', profile_key: 'standard', coverage_status: 'platform-managed', backup_granularity: 'full', rpo_range_minutes: '[240,480]', rto_range_minutes: '[60,120]', max_backup_frequency_minutes: 240, max_retention_days: 30, max_concurrent_jobs: 2, max_backup_size_gb: null, preconditions: ['mongodump available'], limitations: [], air_gap_notes: null, plan_capability_key: null },
  { component_key: 'mongodb', profile_key: 'ha', coverage_status: 'platform-managed', backup_granularity: 'incremental', rpo_range_minutes: '[60,120]', rto_range_minutes: '[30,60]', max_backup_frequency_minutes: 60, max_retention_days: 90, max_concurrent_jobs: 4, max_backup_size_gb: null, preconditions: ['mongodump available'], limitations: [], air_gap_notes: null, plan_capability_key: null },
  { component_key: 'kafka', profile_key: 'all-in-one', coverage_status: 'not-supported', backup_granularity: 'none', rpo_range_minutes: null, rto_range_minutes: null, max_backup_frequency_minutes: null, max_retention_days: null, max_concurrent_jobs: null, max_backup_size_gb: null, preconditions: [], limitations: ['Kafka is ephemeral in all-in-one'], air_gap_notes: null, plan_capability_key: null },
  { component_key: 'kafka', profile_key: 'standard', coverage_status: 'operator-managed', backup_granularity: 'none', rpo_range_minutes: null, rto_range_minutes: null, max_backup_frequency_minutes: null, max_retention_days: null, max_concurrent_jobs: null, max_backup_size_gb: null, preconditions: ['Operator must configure MirrorMaker'], limitations: ['Platform does not manage Kafka backup'], air_gap_notes: null, plan_capability_key: null },
  { component_key: 'kafka', profile_key: 'ha', coverage_status: 'operator-managed', backup_granularity: 'none', rpo_range_minutes: null, rto_range_minutes: null, max_backup_frequency_minutes: null, max_retention_days: null, max_concurrent_jobs: null, max_backup_size_gb: null, preconditions: ['Operator must configure MirrorMaker'], limitations: ['Platform does not manage Kafka backup'], air_gap_notes: null, plan_capability_key: null },
  { component_key: 'openwhisk', profile_key: 'all-in-one', coverage_status: 'not-supported', backup_granularity: 'none', rpo_range_minutes: null, rto_range_minutes: null, max_backup_frequency_minutes: null, max_retention_days: null, max_concurrent_jobs: null, max_backup_size_gb: null, preconditions: [], limitations: ['Function definitions not backed up in all-in-one'], air_gap_notes: null, plan_capability_key: null },
  { component_key: 'openwhisk', profile_key: 'standard', coverage_status: 'operator-managed', backup_granularity: 'config-only', rpo_range_minutes: null, rto_range_minutes: null, max_backup_frequency_minutes: null, max_retention_days: 30, max_concurrent_jobs: null, max_backup_size_gb: null, preconditions: ['CouchDB export tool available'], limitations: ['Only action/trigger definitions'], air_gap_notes: null, plan_capability_key: null },
  { component_key: 'openwhisk', profile_key: 'ha', coverage_status: 'operator-managed', backup_granularity: 'config-only', rpo_range_minutes: null, rto_range_minutes: null, max_backup_frequency_minutes: null, max_retention_days: 90, max_concurrent_jobs: null, max_backup_size_gb: null, preconditions: ['CouchDB export tool available'], limitations: ['Only action/trigger definitions'], air_gap_notes: null, plan_capability_key: null },
  { component_key: 's3', profile_key: 'all-in-one', coverage_status: 'platform-managed', backup_granularity: 'full', rpo_range_minutes: '[1440,2880]', rto_range_minutes: '[240,480]', max_backup_frequency_minutes: 1440, max_retention_days: 14, max_concurrent_jobs: 1, max_backup_size_gb: 50, preconditions: ['S3-compatible storage accessible'], limitations: ['Objects > 50 GB require manual export'], air_gap_notes: null, plan_capability_key: null },
  { component_key: 's3', profile_key: 'standard', coverage_status: 'platform-managed', backup_granularity: 'incremental', rpo_range_minutes: '[240,480]', rto_range_minutes: '[60,120]', max_backup_frequency_minutes: 240, max_retention_days: 30, max_concurrent_jobs: 2, max_backup_size_gb: 100, preconditions: ['S3-compatible storage accessible'], limitations: [], air_gap_notes: null, plan_capability_key: null },
  { component_key: 's3', profile_key: 'ha', coverage_status: 'platform-managed', backup_granularity: 'incremental', rpo_range_minutes: '[60,120]', rto_range_minutes: '[30,60]', max_backup_frequency_minutes: 60, max_retention_days: 90, max_concurrent_jobs: 4, max_backup_size_gb: null, preconditions: ['S3-compatible storage accessible'], limitations: [], air_gap_notes: null, plan_capability_key: null },
  { component_key: 'keycloak', profile_key: 'all-in-one', coverage_status: 'platform-managed', backup_granularity: 'config-only', rpo_range_minutes: null, rto_range_minutes: null, max_backup_frequency_minutes: null, max_retention_days: 30, max_concurrent_jobs: 1, max_backup_size_gb: null, preconditions: ['Keycloak realm export CLI available'], limitations: ['Only realm configuration exported'], air_gap_notes: null, plan_capability_key: null },
  { component_key: 'keycloak', profile_key: 'standard', coverage_status: 'platform-managed', backup_granularity: 'config-only', rpo_range_minutes: null, rto_range_minutes: null, max_backup_frequency_minutes: null, max_retention_days: 30, max_concurrent_jobs: 1, max_backup_size_gb: null, preconditions: ['Keycloak realm export CLI available'], limitations: ['Only realm configuration exported'], air_gap_notes: null, plan_capability_key: null },
  { component_key: 'keycloak', profile_key: 'ha', coverage_status: 'platform-managed', backup_granularity: 'config-only', rpo_range_minutes: null, rto_range_minutes: null, max_backup_frequency_minutes: null, max_retention_days: 90, max_concurrent_jobs: 2, max_backup_size_gb: null, preconditions: ['Keycloak realm export CLI available'], limitations: ['Only realm configuration exported'], air_gap_notes: null, plan_capability_key: null },
  { component_key: 'apisix_config', profile_key: 'all-in-one', coverage_status: 'platform-managed', backup_granularity: 'config-only', rpo_range_minutes: null, rto_range_minutes: null, max_backup_frequency_minutes: null, max_retention_days: 30, max_concurrent_jobs: 1, max_backup_size_gb: null, preconditions: ['etcd snapshot tool available'], limitations: ['Only route/plugin configuration'], air_gap_notes: null, plan_capability_key: null },
  { component_key: 'apisix_config', profile_key: 'standard', coverage_status: 'platform-managed', backup_granularity: 'config-only', rpo_range_minutes: null, rto_range_minutes: null, max_backup_frequency_minutes: null, max_retention_days: 30, max_concurrent_jobs: 1, max_backup_size_gb: null, preconditions: ['etcd snapshot tool available'], limitations: ['Only route/plugin configuration'], air_gap_notes: null, plan_capability_key: null },
  { component_key: 'apisix_config', profile_key: 'ha', coverage_status: 'platform-managed', backup_granularity: 'config-only', rpo_range_minutes: null, rto_range_minutes: null, max_backup_frequency_minutes: null, max_retention_days: 90, max_concurrent_jobs: 2, max_backup_size_gb: null, preconditions: ['etcd snapshot tool available'], limitations: ['Only route/plugin configuration'], air_gap_notes: null, plan_capability_key: null }
];

export function createFakeProducer() {
  return { messages: [], async send(payload) { this.messages.push(payload); } };
}

export function createFakeDb({ healthJoinEnabled = false } = {}) {
  return {
    _profiles: [...PROFILE_SEED],
    _scopeEntries: [...SCOPE_SEED],
    _tenantPlans: new Map([['ten-xyz', { plan_id: 'plan-pro', is_active: true }]]),
    async query(sql, params = []) {
      // backup_scope_entries queries (must check before deployment_profile_registry since subqueries reference both)
      if (sql.includes('FROM backup_scope_entries')) {
        if (sql.includes('profile_key = $1')) {
          return { rows: this._scopeEntries.filter((e) => e.profile_key === params[0]) };
        }
        if (sql.includes('is_active = true')) {
          const active = this._profiles.find((p) => p.is_active);
          return { rows: active ? this._scopeEntries.filter((e) => e.profile_key === active.profile_key) : [] };
        }
        // No WHERE clause — return all
        return { rows: this._scopeEntries };
      }
      if (sql.includes('FROM deployment_profile_registry') && sql.includes('is_active = true')) {
        const active = this._profiles.find((p) => p.is_active);
        return { rows: active ? [active] : [] };
      }
      if (sql.includes('FROM tenant_plan_assignments') && sql.includes('tenant_id = $1')) {
        const assignment = this._tenantPlans.get(params[0]);
        return { rows: assignment ? [assignment] : [] };
      }
      return { rows: [] };
    }
  };
}
