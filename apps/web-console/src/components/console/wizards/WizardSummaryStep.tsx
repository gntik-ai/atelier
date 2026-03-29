import { Link } from 'react-router-dom'

import { AlertTriangle, CheckCircle2 } from 'lucide-react'

import type { WizardSubmitState } from '@/lib/console-wizards'
import { Separator } from '@/components/ui/separator'

export function WizardSummaryStep({ summary, submitState }: { summary: Array<{ label: string; value: string }>; submitState: WizardSubmitState }) {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-4">
        {summary.map((item) => (
          <div key={item.label} className="grid grid-cols-1 gap-1 py-2 sm:grid-cols-[180px_1fr]">
            <div className="text-sm font-medium text-muted-foreground">{item.label}</div>
            <div className="text-sm">{item.value || 'No configurado'}</div>
          </div>
        ))}
      </div>
      <Separator />
      {submitState.status === 'error' ? (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4" />
          <span>{submitState.message}</span>
        </div>
      ) : null}
      {submitState.status === 'success' ? (
        <div role="status" className="flex items-start gap-2 rounded-xl border border-primary/40 bg-primary/10 p-3 text-sm">
          <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary" />
          <div>
            <div>Recurso creado correctamente: <strong>{submitState.resourceId}</strong></div>
            {submitState.resourceUrl ? <Link className="text-primary underline" to={submitState.resourceUrl}>Abrir recurso</Link> : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
