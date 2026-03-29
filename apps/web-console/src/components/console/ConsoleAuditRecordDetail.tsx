import type { ConsoleAuditRecord } from '@/lib/console-metrics'

export function ConsoleAuditRecordDetail({ record }: { record: ConsoleAuditRecord }) {
  return (
    <div className="space-y-2 rounded-2xl bg-muted/30 p-4 text-sm">
      <p><strong>Actor:</strong> {record.actor.displayName ?? record.actor.actorId} ({record.actor.actorType})</p>
      <p><strong>Recurso:</strong> {record.resource ? `${record.resource.resourceType} · ${record.resource.resourceId}` : 'Sin recurso'}</p>
      <p><strong>Correlation:</strong> {record.correlationId ?? 'n/a'}</p>
      <p><strong>Origin:</strong> {record.origin?.originSurface ?? 'n/a'} · {record.origin?.ipAddress ?? 'sin IP'}</p>
      <pre className="overflow-x-auto rounded-xl bg-background p-3">{JSON.stringify({ scope: record.scope, metadata: record.metadata }, null, 2)}</pre>
    </div>
  )
}
