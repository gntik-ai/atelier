function countByPosture(dimensions = [], posture) {
  return dimensions.filter((dimension) => dimension.posture === posture).length;
}

function headlineForOverview(overview = {}) {
  if ((overview.hardLimitDimensions ?? []).length > 0) {
    return `${overview.hardLimitDimensions.length} hard-limit breach(es)`;
  }
  if ((overview.softLimitDimensions ?? []).length > 0) {
    return `${overview.softLimitDimensions.length} soft-limit breach(es)`;
  }
  if ((overview.warningDimensions ?? []).length > 0) {
    return `${overview.warningDimensions.length} warning dimension(s)`;
  }
  return 'Within limits';
}

function emphasisForOverview(overview = {}) {
  switch (overview.overallPosture) {
    case 'hard_limit_reached':
      return 'critical';
    case 'soft_limit_exceeded':
      return 'elevated';
    case 'warning_threshold_reached':
      return 'warning';
    case 'evidence_degraded':
    case 'evidence_unavailable':
      return 'degraded';
    default:
      return 'healthy';
  }
}

export function buildTenantQuotaUsageCards(overview = {}) {
  const dimensions = overview.dimensions ?? [];
  return [
    {
      id: 'tenant-overview-status',
      title: 'Quota posture',
      value: headlineForOverview(overview),
      emphasis: emphasisForOverview(overview),
      secondary: `Policies configured: ${overview.policiesConfigured ? 'yes' : 'no'}`
    },
    {
      id: 'tenant-overview-warning-count',
      title: 'Warnings',
      value: `${countByPosture(dimensions, 'warning_threshold_reached')} dimension(s)`,
      emphasis: (overview.warningDimensions ?? []).length > 0 ? 'warning' : 'healthy',
      secondary: `${countByPosture(dimensions, 'evidence_degraded') + countByPosture(dimensions, 'evidence_unavailable')} degraded dimension(s)`
    },
    {
      id: 'tenant-overview-capacity',
      title: 'Capacity pressure',
      value: `${(overview.softLimitDimensions ?? []).length} soft / ${(overview.hardLimitDimensions ?? []).length} hard`,
      emphasis: (overview.hardLimitDimensions ?? []).length > 0 ? 'critical' : (overview.softLimitDimensions ?? []).length > 0 ? 'elevated' : 'healthy',
      secondary: `Generated at ${overview.generatedAt ?? 'n/a'}`
    }
  ];
}

export function buildTenantProvisioningBanner(overview = {}) {
  const provisioning = overview.provisioningState ?? {};
  return {
    id: 'tenant-provisioning-banner',
    title: 'Provisioning state',
    value: provisioning.state ?? 'unknown',
    emphasis: provisioning.visualState ?? 'unknown',
    secondary: provisioning.reasonSummary ?? 'No provisioning summary available.',
    degradedComponents: provisioning.degradedComponents ?? []
  };
}

export function buildQuotaUsageTableRows(overview = {}) {
  return (overview.dimensions ?? []).map((dimension) => ({
    dimensionId: dimension.dimensionId,
    label: dimension.displayName,
    usage: dimension.currentUsage,
    unit: dimension.unit,
    warningThreshold: dimension.warningThreshold,
    softLimit: dimension.softLimit,
    hardLimit: dimension.hardLimit,
    usagePercentage: dimension.usagePercentage,
    posture: dimension.posture,
    visualState: dimension.visualState,
    freshnessStatus: dimension.freshnessStatus,
    blockingState: dimension.blockingState,
    lastUpdatedAt: dimension.lastUpdatedAt
  }));
}

export function buildWorkspaceQuotaUsageRows(overview = {}) {
  return buildQuotaUsageTableRows(overview).map((row) => ({
    workspaceId: overview.workspaceId,
    ...row
  }));
}
