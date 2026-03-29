export const QUOTA_AVAILABLE = {
  posture: {
    dimensions: [{ dimensionId: 'workspaces.count', isExceeded: false, remainingToHardLimit: 1 }]
  },
  workspacePosture: null,
  loading: false
} as const

export const QUOTA_EXCEEDED = {
  posture: {
    dimensions: [{ dimensionId: 'workspaces.count', isExceeded: true, remainingToHardLimit: 0 }]
  },
  workspacePosture: null,
  loading: false
} as const

export const QUOTA_DB_AVAILABLE = {
  posture: null,
  workspacePosture: {
    dimensions: [{ dimensionId: 'databases.count', isExceeded: false, remainingToHardLimit: 3 }]
  },
  loading: false
} as const

export const QUOTA_DB_EXCEEDED = {
  posture: null,
  workspacePosture: {
    dimensions: [{ dimensionId: 'databases.count', isExceeded: true, remainingToHardLimit: 0 }]
  },
  loading: false
} as const
