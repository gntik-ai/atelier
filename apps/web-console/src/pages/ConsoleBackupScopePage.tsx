import React, { useCallback, useEffect, useState } from 'react'

import type { BackupScopeEntry, BackupScopeMatrixResponse, TenantBackupScopeResponse } from '@/lib/backupScopeApi'
import { fetchAdminBackupScope, fetchTenantBackupScope } from '@/lib/backupScopeApi'
import { BackupScopeLegend } from '@/components/console/BackupScopeLegend'
import { BackupScopeMatrix } from '@/components/console/BackupScopeMatrix'
import { BackupScopeProfileSelector } from '@/components/console/BackupScopeProfileSelector'

export function ConsoleBackupScopePage({
  role = 'superadmin',
  tenantId,
  adminFetcher = fetchAdminBackupScope,
  tenantFetcher = fetchTenantBackupScope
}: {
  role?: string
  tenantId?: string
  adminFetcher?: (profile?: string) => Promise<BackupScopeMatrixResponse>
  tenantFetcher?: (tenantId: string) => Promise<TenantBackupScopeResponse>
}) {
  const [entries, setEntries] = useState<BackupScopeEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [profile, setProfile] = useState('all')
  const isAdmin = role === 'superadmin' || role === 'sre'

  const fetchData = useCallback(async (selectedProfile: string) => {
    setLoading(true)
    setError(null)
    try {
      if (isAdmin) {
        const response = await adminFetcher(selectedProfile)
        setEntries(response.entries)
      } else if (tenantId) {
        const response = await tenantFetcher(tenantId)
        // Map tenant entries to BackupScopeEntry shape for the matrix
        setEntries(response.entries.map((entry) => ({
          ...entry,
          profileKey: response.activeProfile,
          supportedByProfile: entry.coverageStatus !== 'not-supported' && entry.coverageStatus !== 'unknown',
          maxBackupFrequencyMinutes: null,
          maxRetentionDays: null,
          maxConcurrentJobs: null,
          maxBackupSizeGb: null,
          preconditions: [],
          limitations: [],
          airGapNotes: null,
          planCapabilityKey: null
        })))
      }
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError : new Error('Unknown error'))
    } finally {
      setLoading(false)
    }
  }, [isAdmin, tenantId, adminFetcher, tenantFetcher])

  useEffect(() => {
    fetchData(profile)
  }, [fetchData, profile])

  const handleProfileChange = (newProfile: string) => {
    setProfile(newProfile)
  }

  if (error) {
    return <div data-testid="scope-error" className="text-red-600">Error loading backup scope: {error.message}</div>
  }

  return (
    <div className="space-y-6" data-testid="backup-scope-page">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Backup Scope & Limits</h1>
        {isAdmin && <BackupScopeProfileSelector value={profile} onChange={handleProfileChange} />}
      </div>
      <BackupScopeMatrix entries={entries} isLoading={loading} />
      <BackupScopeLegend />
    </div>
  )
}
