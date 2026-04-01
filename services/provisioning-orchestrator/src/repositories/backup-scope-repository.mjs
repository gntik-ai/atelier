const HEALTH_JOIN_ENABLED = process.env.BACKUP_SCOPE_HEALTH_JOIN_ENABLED === 'true';

function parseRange(rangeStr) {
  if (!rangeStr) return null;
  const match = String(rangeStr).match(/\[(\d+),(\d+)\]/);
  if (!match) return null;
  return { min: Number(match[1]), max: Number(match[2]) };
}

function mapEntry(row) {
  return {
    componentKey: row.component_key,
    profileKey: row.profile_key,
    coverageStatus: row.coverage_status,
    backupGranularity: row.backup_granularity,
    rpoRangeMinutes: parseRange(row.rpo_range_minutes),
    rtoRangeMinutes: parseRange(row.rto_range_minutes),
    operationalStatus: row.operational_status ?? 'unknown',
    supportedByProfile: row.coverage_status !== 'not-supported' && row.coverage_status !== 'unknown',
    maxBackupFrequencyMinutes: row.max_backup_frequency_minutes ?? null,
    maxRetentionDays: row.max_retention_days ?? null,
    maxConcurrentJobs: row.max_concurrent_jobs ?? null,
    maxBackupSizeGb: row.max_backup_size_gb != null ? Number(row.max_backup_size_gb) : null,
    preconditions: row.preconditions ?? [],
    limitations: row.limitations ?? [],
    airGapNotes: row.air_gap_notes ?? null,
    planCapabilityKey: row.plan_capability_key ?? null
  };
}

function mapTenantEntry(row) {
  const base = mapEntry(row);
  return {
    componentKey: base.componentKey,
    coverageStatus: base.coverageStatus,
    backupGranularity: base.backupGranularity,
    rpoRangeMinutes: base.rpoRangeMinutes,
    rtoRangeMinutes: base.rtoRangeMinutes,
    operationalStatus: base.operationalStatus,
    tenantHasResources: true,
    planRestriction: row.plan_restriction ?? null,
    recommendation: buildRecommendation(base)
  };
}

function buildRecommendation(entry) {
  if (entry.coverageStatus === 'not-supported') {
    return 'This component is not supported for backup on the current deployment profile. Consider operator-managed external backup.';
  }
  if (entry.coverageStatus === 'operator-managed') {
    return 'Backup for this component must be managed by the operator. Contact your platform administrator.';
  }
  return null;
}

export async function getMatrix(pgClient, { profileKey, includeAll = false } = {}) {
  const healthSelect = HEALTH_JOIN_ENABLED
    ? 'COALESCE(chs.status, \'unknown\') AS operational_status'
    : '\'unknown\' AS operational_status';
  const healthJoin = HEALTH_JOIN_ENABLED
    ? 'LEFT JOIN component_health_status chs ON chs.component_key = bse.component_key'
    : '';

  let whereClause = '';
  const params = [];

  if (!includeAll && profileKey) {
    whereClause = 'WHERE bse.profile_key = $1';
    params.push(profileKey);
  } else if (!includeAll) {
    whereClause = 'WHERE bse.profile_key = (SELECT profile_key FROM deployment_profile_registry WHERE is_active = true LIMIT 1)';
  }

  const sql = `
    SELECT bse.*, ${healthSelect}
    FROM backup_scope_entries bse
    ${healthJoin}
    ${whereClause}
    ORDER BY bse.component_key, bse.profile_key
  `;

  const { rows } = await pgClient.query(sql, params);
  return rows.map(mapEntry);
}

export async function getTenantProjection(pgClient, { tenantId, planId } = {}) {
  const healthSelect = HEALTH_JOIN_ENABLED
    ? 'COALESCE(chs.status, \'unknown\') AS operational_status'
    : '\'unknown\' AS operational_status';
  const healthJoin = HEALTH_JOIN_ENABLED
    ? 'LEFT JOIN component_health_status chs ON chs.component_key = bse.component_key'
    : '';

  const sql = `
    SELECT bse.*, ${healthSelect}, NULL AS plan_restriction
    FROM backup_scope_entries bse
    ${healthJoin}
    WHERE bse.profile_key = (SELECT profile_key FROM deployment_profile_registry WHERE is_active = true LIMIT 1)
    ORDER BY bse.component_key
  `;

  const { rows } = await pgClient.query(sql);
  return rows.map(mapTenantEntry);
}

export async function resolveOperationalStatus(pgClient, componentKey) {
  if (!HEALTH_JOIN_ENABLED) return 'unknown';
  try {
    const { rows } = await pgClient.query(
      'SELECT status FROM component_health_status WHERE component_key = $1',
      [componentKey]
    );
    return rows[0]?.status ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function getActiveProfile(pgClient) {
  const { rows } = await pgClient.query(
    'SELECT profile_key FROM deployment_profile_registry WHERE is_active = true LIMIT 1'
  );
  return rows[0]?.profile_key ?? 'unknown';
}
