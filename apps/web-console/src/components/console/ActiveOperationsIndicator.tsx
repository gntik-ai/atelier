import { Activity } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { useActiveOperationsCount } from '@/lib/console-operations'

export function ActiveOperationsIndicator() {
  const { count } = useActiveOperationsCount()

  if (count === 0) {
    return null
  }

  return (
    <Link
      to="/console/operations"
      aria-label={`Operaciones activas: ${count}`}
      className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm text-blue-700 transition-colors hover:bg-blue-100"
    >
      <Activity className="h-4 w-4" aria-hidden="true" />
      <span className="text-xs font-medium uppercase tracking-wide">Operaciones</span>
      <Badge className="border-blue-600 bg-blue-600 text-white">{count}</Badge>
    </Link>
  )
}

export default ActiveOperationsIndicator
