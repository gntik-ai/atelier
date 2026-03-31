import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ConsolePageState } from '@/components/console/ConsolePageState'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PlanStatusBadge } from '@/components/console/PlanStatusBadge'
import { PlanCapabilityBadge } from '@/components/console/PlanCapabilityBadge'
import { PlanLimitsTable } from '@/components/console/PlanLimitsTable'
import { PlanAssignmentDialog } from '@/components/console/PlanAssignmentDialog'
import { PlanHistoryTable } from '@/components/console/PlanHistoryTable'
import { DestructiveConfirmationDialog } from '@/components/console/DestructiveConfirmationDialog'
import * as api from '@/services/planManagementApi'

export function ConsolePlanCatalogPage() {
  const navigate = useNavigate()
  const [state, setState] = useState({ items: [] as api.PlanRecord[], total: 0, page: 1, pageSize: 20, loading: true, error: '' as string | null, status: 'all' as api.PlanStatus | 'all' })
  useEffect(() => { api.listPlans({ status: state.status, page: state.page, pageSize: state.pageSize }).then((response) => setState((current) => ({ ...current, ...response, loading: false, error: null }))).catch((error) => setState((current) => ({ ...current, loading: false, error: error.message ?? 'Error' }))) }, [state.page, state.pageSize, state.status])
  if (state.loading) return <ConsolePageState kind="loading" title="Loading plans" description="Fetching plan catalog." />
  if (state.error) return <ConsolePageState kind="error" title="Failed to load plans" description={state.error} />
  if (!state.items.length) return <ConsolePageState kind="empty" title="No plans found" description="Create your first plan." actionLabel="Create plan" onAction={() => navigate('/console/plans/new')} />
  return <main className="space-y-6"><header className="rounded-3xl border border-border bg-card/70 p-6"><h1 className="text-2xl font-semibold">Plan catalog</h1><div className="mt-4 flex gap-3"><select aria-label="status-filter" value={state.status} onChange={(e) => setState((current) => ({ ...current, status: e.currentTarget.value as api.PlanStatus | 'all', page: 1 }))}><option value="all">All</option><option value="draft">Draft</option><option value="active">Active</option><option value="deprecated">Deprecated</option><option value="archived">Archived</option></select><Button type="button" onClick={() => navigate('/console/plans/new')}>Create Plan</Button></div></header><table className="w-full text-sm"><thead><tr><th>Slug</th><th>Name</th><th>Status</th><th>Assigned</th><th>Updated</th></tr></thead><tbody>{state.items.map((plan) => <tr key={plan.id} onClick={() => navigate(`/console/plans/${plan.id}`)}><td>{plan.slug}</td><td>{plan.displayName}</td><td><PlanStatusBadge status={plan.status} /></td><td>{plan.assignedTenantCount ?? 0}</td><td>{plan.updatedAt ?? '—'}</td></tr>)}</tbody></table></main>
}
