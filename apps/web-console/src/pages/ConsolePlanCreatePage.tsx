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

export function ConsolePlanCreatePage() {
  const navigate = useNavigate()
  const [slug, setSlug] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/.test(slug)) { setError('Slug format is invalid'); return }
    try {
      const created = await api.createPlan({ slug, displayName, description, capabilities: {}, quotaDimensions: {} }) as api.PlanRecord
      navigate(`/console/plans/${created.id}`)
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Unable to create plan')
    }
  }
  return <main className="space-y-6"><header className="rounded-3xl border border-border bg-card/70 p-6"><h1 className="text-2xl font-semibold">Create plan</h1></header><form onSubmit={handleSubmit} className="space-y-4 rounded-3xl border border-border bg-card/70 p-6"><label className="block">Slug<Input aria-label="slug" value={slug} onChange={(e) => setSlug(e.currentTarget.value)} /></label><label className="block">Display name<Input aria-label="display-name" value={displayName} onChange={(e) => setDisplayName(e.currentTarget.value)} /></label><label className="block">Description<textarea aria-label="description" value={description} onChange={(e) => setDescription(e.currentTarget.value)} className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /></label>{error ? <div role="alert">{error}</div> : null}<Button type="submit">Create</Button></form></main>
}
