import { useMemo, useState } from 'react'
import type { InitiateRestoreBody } from '@/services/backupOperationsApi'

interface RestoreSimulationDialogProps {
  tenantId: string
  componentType: string
  instanceId: string
  snapshotId: string
  onLaunch: (body: InitiateRestoreBody) => Promise<void>
  onClose: () => void
  disabled?: boolean
}

export function RestoreSimulationDialog({
  tenantId,
  componentType,
  instanceId,
  snapshotId,
  onLaunch,
  onClose,
  disabled = false,
}: RestoreSimulationDialogProps) {
  const [submitted, setSubmitted] = useState(false)
  const body = useMemo<InitiateRestoreBody>(() => ({
    tenant_id: tenantId,
    component_type: componentType,
    instance_id: instanceId,
    snapshot_id: snapshotId,
    execution_mode: 'simulation',
  }), [tenantId, componentType, instanceId, snapshotId])

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-xl rounded-lg bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold">Simulación de restore</h2>
        <p className="mt-2 text-sm text-slate-600">
          Esta acción ejecuta un drill en un entorno seguro. No toca producción.
        </p>
        <div className="mt-4 space-y-1 text-sm text-slate-700">
          <p><strong>Tenant:</strong> {tenantId}</p>
          <p><strong>Componente:</strong> {componentType}</p>
          <p><strong>Instancia:</strong> {instanceId}</p>
          <p><strong>Snapshot:</strong> {snapshotId}</p>
        </div>
        <div className="mt-6 flex items-center justify-end gap-3">
          <button type="button" className="rounded border px-4 py-2 text-sm" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            disabled={disabled || submitted}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            onClick={async () => {
              setSubmitted(true)
              await onLaunch(body)
            }}
          >
            {submitted ? 'Lanzando…' : 'Lanzar simulación'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default RestoreSimulationDialog
