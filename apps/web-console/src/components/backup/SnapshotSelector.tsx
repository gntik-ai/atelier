import type { SnapshotItem } from '@/services/backupOperationsApi'

interface SnapshotSelectorProps {
  snapshots: SnapshotItem[]
  selected: string | null
  onSelect: (snapshotId: string) => void
}

export function SnapshotSelector({ snapshots, selected, onSelect }: SnapshotSelectorProps) {
  return (
    <div className="space-y-1" data-testid="snapshot-selector">
      <label className="block text-sm font-medium text-gray-700">Seleccionar snapshot</label>
      <select
        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
        value={selected ?? ''}
        onChange={(e) => onSelect(e.target.value)}
      >
        <option value="" disabled>— Seleccione un snapshot —</option>
        {snapshots.map((s) => (
          <option key={s.snapshot_id} value={s.snapshot_id} disabled={!s.available}>
            {s.snapshot_id} — {new Date(s.created_at).toLocaleString()}{!s.available ? ' (no disponible)' : ''}
          </option>
        ))}
      </select>
    </div>
  )
}
