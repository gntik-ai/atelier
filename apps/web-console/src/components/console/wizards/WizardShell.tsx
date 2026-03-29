import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { WizardStepIndicator } from '@/components/console/wizards/WizardStepIndicator'
import { WizardSummaryStep } from '@/components/console/wizards/WizardSummaryStep'
import type { WizardContext, WizardStep, WizardSubmitState } from '@/lib/console-wizards'

export function WizardShell<TData>({
  open,
  onOpenChange,
  title,
  description,
  context,
  steps,
  initialData,
  buildSummary,
  onSubmit
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  context: WizardContext
  steps: WizardStep<TData>[]
  initialData: Partial<TData>
  buildSummary: (data: Partial<TData>) => Array<{ label: string; value: string }>
  onSubmit: (data: Partial<TData>) => Promise<{ resourceId: string; resourceUrl?: string }>
}) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0)
  const [formData, setFormData] = useState<Partial<TData>>(initialData)
  const [submitState, setSubmitState] = useState<WizardSubmitState>({ status: 'idle' })

  const isSummary = currentStepIndex >= steps.length
  const currentStep = steps[Math.min(currentStepIndex, steps.length - 1)]
  const validation = useMemo(() => (currentStep ? currentStep.validate(formData) : { valid: true, fieldErrors: {} }), [currentStep, formData])

  function close() {
    onOpenChange(false)
    setCurrentStepIndex(0)
    setFormData(initialData)
    setSubmitState({ status: 'idle' })
  }

  const StepComponent = currentStep?.component

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <WizardStepIndicator currentStep={Math.min(currentStepIndex, steps.length - 1)} labels={[...steps.map((step) => step.label), 'Resumen']} />
        {!isSummary && StepComponent ? (
          <StepComponent
            data={formData}
            onChange={(patch) => setFormData((current) => ({ ...current, ...patch }))}
            validation={validation}
            context={context}
          />
        ) : (
          <WizardSummaryStep summary={buildSummary(formData)} submitState={submitState} />
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => (currentStepIndex === 0 ? close() : setCurrentStepIndex((value) => value - 1))}>
            {currentStepIndex === 0 ? 'Cancelar' : 'Anterior'}
          </Button>
          {!isSummary ? (
            <Button type="button" onClick={() => setCurrentStepIndex((value) => value + 1)} disabled={!validation.valid || Boolean(validation.blockingError)}>
              Siguiente
            </Button>
          ) : (
            <Button
              type="button"
              onClick={async () => {
                setSubmitState({ status: 'submitting' })
                try {
                  const result = await onSubmit(formData)
                  setSubmitState({ status: 'success', resourceId: result.resourceId, resourceUrl: result.resourceUrl })
                } catch (error) {
                  setSubmitState({ status: 'error', message: error instanceof Error ? error.message : 'No se pudo completar la operación.' })
                }
              }}
              disabled={submitState.status === 'submitting'}
            >
              {submitState.status === 'submitting' ? 'Confirmando…' : 'Confirmar'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
