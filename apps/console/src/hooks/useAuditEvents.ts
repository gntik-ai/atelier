/**
 * React Query hook for backup audit events with cursor-based pagination.
 */

import { useInfiniteQuery } from '@tanstack/react-query'
import { fetchAuditEvents } from '../lib/api/backup-audit.api.js'
import type { AuditQueryFilters } from '../../../../services/backup-status/src/audit/audit-trail.types.js'

interface UseAuditEventsOptions {
  filters: AuditQueryFilters
  token: string
  enabled?: boolean
}

export function useAuditEvents({ filters, token, enabled = true }: UseAuditEventsOptions) {
  return useInfiniteQuery({
    queryKey: ['audit-events', filters],
    queryFn: ({ pageParam }) =>
      fetchAuditEvents({ ...filters, cursor: pageParam as string | undefined }, token),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.pagination.nextCursor ?? undefined,
    enabled,
  })
}
