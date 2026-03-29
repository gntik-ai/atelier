import { cn } from '@/lib/utils'

export function WizardStepIndicator({ currentStep, labels }: { currentStep: number; labels: string[] }) {
  return (
    <ol className="mb-6 grid gap-2 sm:grid-cols-4">
      {labels.map((label, index) => (
        <li key={label} className={cn('rounded-xl border px-3 py-2 text-sm', index <= currentStep ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground')}>
          <span className="font-medium">{index + 1}.</span> {label}
        </li>
      ))}
    </ol>
  )
}
