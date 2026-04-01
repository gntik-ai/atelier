import { OperationStatusBadge } from './OperationStatusBadge'

interface Operation {
  id: string
  type: string
  component_type: string
  requester_id: string
  status: string
  accepted_at: string
  completed_at?: string | null
  failed_at?: string | null
}

interface OperationHistoryPanelProps {
  operations: Operation[]
}

export function OperationHistoryPanel({ operations }: OperationHistoryPanelProps) {
  if (operations.length === 0) {
    return <p className="text-sm text-gray-500">No hay operaciones recientes.</p>
  }

  return (
    <div data-testid="operation-history-panel">
      <h3 className="text-lg font-semibold mb-2">Operaciones recientes</h3>
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead>
          <tr>
            <th className="px-3 py-2 text-left">Tipo</th>
            <th className="px-3 py-2 text-left">Componente</th>
            <th className="px-3 py-2 text-left">Actor</th>
            <th className="px-3 py-2 text-left">Estado</th>
            <th className="px-3 py-2 text-left">Fecha</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {operations.map((op) => (
            <tr key={op.id}>
              <td className="px-3 py-2">{op.type}</td>
              <td className="px-3 py-2">{op.component_type}</td>
              <td className="px-3 py-2">{op.requester_id}</td>
              <td className="px-3 py-2"><OperationStatusBadge status={op.status} /></td>
              <td className="px-3 py-2">{new Date(op.accepted_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
