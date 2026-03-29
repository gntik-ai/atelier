import { useEffect, useId, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { type DestructiveOpConfig, type DestructiveOpState } from '@/lib/destructive-ops'

interface DestructiveConfirmationDialogProps {
  open: boolean
  config: DestructiveOpConfig | null
  opState: DestructiveOpState
  confirmError: string | null
  onConfirm: () => void
  onCancel: () => void
}

export function DestructiveConfirmationDialog({
  open,
  config,
  opState,
  confirmError,
  onConfirm,
  onCancel
}: DestructiveConfirmationDialogProps) {
  const [confirmationText, setConfirmationText] = useState('')
  const titleId = useId()
  const descriptionId = useId()
  const isConfirming = opState === 'confirming'
  const isCritical = config?.level === 'CRITICAL'

  useEffect(() => {
    setConfirmationText('')
  }, [config?.operationId, config?.resourceName, open])

  useEffect(() => {
    if (!open) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !isConfirming) {
        event.preventDefault()
        onCancel()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isConfirming, onCancel, open])

  if (!config) {
    return null
  }

  const confirmDisabled =
    isConfirming ||
    opState === 'loading-impact' ||
    (isCritical && confirmationText !== config.resourceName)

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !isConfirming) {
          onCancel()
        }
      }}
    >
      <DialogContent>
        <div role="alertdialog" aria-labelledby={titleId} aria-describedby={descriptionId}>
          <DialogHeader>
            <DialogTitle id={titleId}>{isCritical ? `Eliminar ${config.resourceType}` : 'Confirmar acción'}</DialogTitle>
            <DialogDescription id={descriptionId}>
              {isCritical
                ? 'Revisa el impacto antes de confirmar la eliminación.'
                : 'Revisa los detalles de la acción antes de continuar.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {isCritical ? (
              <>
                <p className="text-sm text-foreground">
                  Vas a eliminar <strong>{config.resourceName}</strong>.
                </p>
                <section className="rounded-2xl border border-border/60 bg-muted/30 p-4">
                  <h3 className="text-sm font-medium text-foreground">Impacto en cascada</h3>
                  {opState === 'loading-impact' ? <p className="mt-2 text-sm text-muted-foreground">Calculando impacto…</p> : null}
                  {config.cascadeImpactError ? <p className="mt-2 text-sm text-amber-700">No se pudo calcular el impacto completo. Puedes continuar con la información disponible.</p> : null}
                  {!config.cascadeImpactError && opState !== 'loading-impact' && (config.cascadeImpact?.length ?? 0) === 0 ? (
                    <p className="mt-2 text-sm text-muted-foreground">No se detectaron recursos dependientes adicionales.</p>
                  ) : null}
                  {!config.cascadeImpactError && (config.cascadeImpact?.length ?? 0) > 0 ? (
                    <ul className="mt-2 space-y-1 text-sm text-foreground">
                      {config.cascadeImpact?.map((item) => (
                        <li key={`${item.resourceType}-${item.count}`}>{item.resourceType} / {item.count}</li>
                      ))}
                    </ul>
                  ) : null}
                </section>
                <p className="text-sm font-medium text-destructive">Esta operación es irreversible.</p>
                <label className="space-y-2 text-sm text-foreground">
                  <span>Escribe exactamente el nombre del recurso para confirmar.</span>
                  <Input
                    type="text"
                    value={confirmationText}
                    onChange={(event) => setConfirmationText(event.target.value)}
                    placeholder={config.resourceName}
                  />
                </label>
              </>
            ) : (
              <>
                <p className="text-sm text-foreground">
                  Vas a actuar sobre <strong>{config.resourceName}</strong> ({config.resourceType}).
                </p>
                {config.impactDescription ? <p className="text-sm text-muted-foreground">{config.impactDescription}</p> : null}
                <p className="text-sm font-medium text-destructive">Esta operación no se puede deshacer.</p>
              </>
            )}

            {confirmError ? <div role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{confirmError}</div> : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel} disabled={isConfirming} autoFocus>
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={async () => {
                await Promise.resolve(onConfirm())
                config.onSuccess?.()
              }}
              disabled={confirmDisabled}
            >
              {isCritical ? 'Eliminar' : 'Confirmar'}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}
