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

export function ConsoleTenantPlanPage() {
  const { tenantId = '' } = useParams()
  const [data, setData] = useState<any>(null)
  const [history, setHistory] = useState<any>({ items: [], total: 0, page: 1, pageSize: 20 })
  const [plans, setPlans] = useState<api.PlanRecord[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  useEffect(() => { api.getTenantCurrentPlan(tenantId).then(setData); api.getTenantPlanHistory(tenantId).then(setHistory); api.listPlans({ status: 'active' }).then((response) => setPlans(response.items)) }, [tenantId])
  if (!data) return <ConsolePageState kind="loading" title="Loading tenant plan" description="Fetching assignment and history." />
  return <main className="space-y-6"><header className="rounded-3xl border border-border bg-card/70 p-6"><h1 className="text-2xl font-semibold">Tenant plan</h1><Button type="button" onClick={() => setDialogOpen(true)}>{data?.assignment ? 'Change plan' : 'Assign plan'}</Button></header><section className="rounded-3xl border border-border bg-card/70 p-6"><p>{data?.plan?.displayName ?? 'No plan assigned'}</p>{data?.plan?.status ? <PlanStatusBadge status={data.plan.status} /> : null}</section><section className="rounded-3xl border border-border bg-card/70 p-6"><PlanHistoryTable items={history.items} page={history.page} pageSize={history.pageSize} total={history.total} /></section><PlanAssignmentDialog open={dialogOpen} tenantId={tenantId} currentPlanId={data?.assignment?.planId ?? null} activePlans={plans.map((plan) => ({ id: plan.id, displayName: plan.displayName, status: plan.status }))} onConfirm={async (planId) => { await api.assignPlan(tenantId, { planId, assignedBy: 'console' }); setDialogOpen(false) }} onCancel={() => setDialogOpen(false)} /></main>
}
