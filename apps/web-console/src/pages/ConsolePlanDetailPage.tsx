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

export function ConsolePlanDetailPage() {
  const { planId = '' } = useParams()
  const [plan, setPlan] = useState<api.PlanRecord | null>(null)
  const [profile, setProfile] = useState<api.LimitProfileRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'info' | 'capabilities' | 'limits' | 'tenants'>('info')
  useEffect(() => {
    Promise.all([api.getPlan(planId) as Promise<api.PlanRecord>, api.getPlanLimitsProfile(planId)]).then(([nextPlan, limits]) => { setPlan(nextPlan); setProfile(limits.profile); setError(null) }).catch((fetchError) => setError(fetchError instanceof Error ? fetchError.message : 'Error'))
  }, [planId])
  if (error) return <ConsolePageState kind="error" title="Failed to load plan" description={error} />
  if (!plan) return <ConsolePageState kind="loading" title="Loading plan" description="Fetching plan detail." />
  return <main className="space-y-6"><header className="rounded-3xl border border-border bg-card/70 p-6"><h1 className="text-2xl font-semibold">{plan.displayName}</h1><PlanStatusBadge status={plan.status} /><div className="mt-4 flex gap-2"><Button type="button" variant="outline" onClick={() => setTab('info')}>Info</Button><Button type="button" variant="outline" onClick={() => setTab('capabilities')}>Capabilities</Button><Button type="button" variant="outline" onClick={() => setTab('limits')}>Limits</Button><Button type="button" variant="outline" onClick={() => setTab('tenants')}>Tenants</Button></div></header>{tab === 'info' ? <section className="rounded-3xl border border-border bg-card/70 p-6"><p>{plan.description}</p></section> : null}{tab === 'capabilities' ? <section className="rounded-3xl border border-border bg-card/70 p-6 space-y-2">{Object.entries(plan.capabilities ?? {}).map(([key, enabled]) => <div key={key} className="flex items-center justify-between"><span>{key}</span><PlanCapabilityBadge enabled={Boolean(enabled)} label={key} /></div>)}</section> : null}{tab === 'limits' ? <section className="rounded-3xl border border-border bg-card/70 p-6"><PlanLimitsTable dimensions={profile} editable={plan.status === 'draft' || plan.status === 'active'} onUpdate={(key, value) => { api.setPlanLimit(plan.id, key, value); setProfile((current) => current.map((row) => row.dimensionKey === key ? { ...row, explicitValue: value, effectiveValue: value, source: value === -1 ? 'unlimited' : 'explicit' } : row)) }} onRemove={(key) => { api.removePlanLimit(plan.id, key); setProfile((current) => current.map((row) => row.dimensionKey === key ? { ...row, explicitValue: null, effectiveValue: row.defaultValue, source: 'default' } : row)) }} /></section> : null}{tab === 'tenants' ? <section className="rounded-3xl border border-border bg-card/70 p-6">Assigned tenant list is available from the tenant plan page.</section> : null}<DestructiveConfirmationDialog open={false} config={null} opState="idle" confirmError={null} onConfirm={() => {}} onCancel={() => {}} /></main>
}
