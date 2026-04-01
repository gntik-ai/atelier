interface OperationStatusBadgeProps {
  status: string
}

const statusStyles: Record<string, string> = {
  accepted: 'bg-blue-100 text-blue-800',
  in_progress: 'bg-yellow-100 text-yellow-800',
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  rejected: 'bg-gray-100 text-gray-800',
}

const statusLabels: Record<string, string> = {
  accepted: 'Aceptada',
  in_progress: 'En progreso',
  completed: 'Completada',
  failed: 'Fallida',
  rejected: 'Rechazada',
}

export function OperationStatusBadge({ status }: OperationStatusBadgeProps) {
  const style = statusStyles[status] ?? 'bg-gray-100 text-gray-600'
  const label = statusLabels[status] ?? status

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${style}`}
      data-testid="operation-status-badge"
    >
      {label}
    </span>
  )
}
