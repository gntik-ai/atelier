import { useState } from 'react'
import { useTriggerBackup } from '@/hooks/useTriggerBackup'

interface TriggerBackupButtonProps {
  tenantId: string
  componentType: string
  instanceId: string
  token: string
  capabilities: { triggerBackup: boolean }
  onSuccess?: (operationId: string) => void
}

export function TriggerBackupButton({
  tenantId,
  componentType,
  instanceId,
  token,
  capabilities,
  onSuccess,
}: TriggerBackupButtonProps) {
  if (!capabilities.triggerBackup) return null

  const [showModal, setShowModal] = useState(false)
  const { trigger, isLoading, error } = useTriggerBackup()

  async function handleConfirm() {
    await trigger({ tenant_id: tenantId, component_type: componentType, instance_id: instanceId }, token)
    setShowModal(false)
    if (onSuccess) onSuccess('')
  }

  return (
    <>
      <button
        type="button"
        className="rounded bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-500"
        data-testid="trigger-backup-button"
        onClick={() => setShowModal(true)}
      >
        Iniciar backup
      </button>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" role="dialog" aria-modal="true">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full">
            <h2 className="text-lg font-bold mb-2">Confirmar backup</h2>
            <p className="text-sm text-gray-700 mb-4">
              ¿Iniciar backup bajo demanda para el componente <strong>{componentType}</strong> ({instanceId}) del tenant <strong>{tenantId}</strong>?
            </p>
            {error && <p className="text-red-600 text-sm mb-2">{error.message}</p>}
            <div className="flex gap-2 justify-end">
              <button type="button" className="px-3 py-1.5 text-sm rounded border" onClick={() => setShowModal(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white disabled:opacity-50"
                disabled={isLoading}
                onClick={() => void handleConfirm()}
              >
                {isLoading ? 'Iniciando…' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
