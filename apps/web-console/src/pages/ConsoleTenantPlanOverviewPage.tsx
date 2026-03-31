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

export function ConsoleTenantPlanOverviewPage() {
  const [planData, setPlanData] = useState<any>(null)
  const [limits, setLimits] = useState<api.LimitProfileRow[] | null>(null)
  useEffect(() => { api.getMyPlan().then(setPlanData); api.getMyPlanLimits().then((response) => setLimits(response.profile)) }, [])
  if (!limits) return <ConsolePageState kind="loading" title="Loading plan overview" description="Fetching current tenant plan." />
  if (planData?.noAssignment) return <ConsolePageState kind="empty" title="No plan assigned" description="Your tenant does not currently have a plan assignment." />
  return <main className="space-y-6"><header className="rounded-3xl border border-border bg-card/70 p-6"><h1 className="text-2xl font-semibold">My plan</h1><p>{planData?.plan?.displayName}</p><p>{planData?.plan?.description}</p></header><section className="rounded-3xl border border-border bg-card/70 p-6 space-y-2">{Object.entries(planData?.plan?.capabilities ?? {}).map(([key, enabled]) => <div key={key} className="flex items-center justify-between"><span>{key}</span><PlanCapabilityBadge enabled={Boolean(enabled)} label={key} /></div>)}</section><section className="rounded-3xl border border-border bg-card/70 p-6"><PlanLimitsTable dimensions={limits} editable={false} /></section></main>
}
