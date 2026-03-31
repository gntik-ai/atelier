import type { AssignmentRecord } from '@/services/planManagementApi'
import { Button } from '@/components/ui/button'

export function PlanHistoryTable({ items, page, pageSize, total, onPageChange }: { items: AssignmentRecord[]; page: number; pageSize: number; total: number; onPageChange?: (page: number) => void }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  return (
    <div>
      <table className="w-full text-sm">
        <thead><tr><th>Plan</th><th>Effective from</th><th>Superseded at</th><th>Actor</th></tr></thead>
        <tbody>
          {items.map((item) => <tr key={item.assignmentId}><td>{item.planId}</td><td>{item.effectiveFrom}</td><td>{item.supersededAt ?? 'Current'}</td><td>{item.assignedBy ?? 'unknown'}</td></tr>)}
        </tbody>
      </table>
      <div className="mt-4 flex gap-2">
        <Button type="button" variant="outline" onClick={() => onPageChange?.(Math.max(1, page - 1))} disabled={page <= 1}>Previous</Button>
        <span>{page} / {totalPages}</span>
        <Button type="button" variant="outline" onClick={() => onPageChange?.(Math.min(totalPages, page + 1))} disabled={page >= totalPages}>Next</Button>
      </div>
    </div>
  )
}
