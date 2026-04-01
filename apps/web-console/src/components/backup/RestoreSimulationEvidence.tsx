import type { OperationResponse } from '@/services/backupOperationsApi'

interface RestoreSimulationEvidenceProps {
  operation: OperationResponse['operation'] | null
}

export function RestoreSimulationEvidence({ operation }: RestoreSimulationEvidenceProps) {
  if (!operation || operation.execution_mode !== 'simulation') return null

  const checks = operation.validation_summary?.checks ?? []

  return (
    <section className="rounded-lg border border-slate-200 bg-slate-50 p-4" data-testid="restore-simulation-evidence">
      <h3 className="text-sm font-semibold text-slate-900">Evidencia de simulación</h3>
      <dl className="mt-3 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
        <div><dt className="font-medium">Entorno</dt><dd>{operation.target_environment ?? 'n/a'}</dd></div>
        <div><dt className="font-medium">Resultado</dt><dd>{operation.validation_summary?.outcome ?? operation.status}</dd></div>
        <div><dt className="font-medium">Chequeado por</dt><dd>{operation.validation_summary?.checkedBy ?? 'n/a'}</dd></div>
        <div><dt className="font-medium">Chequeado en</dt><dd>{operation.validation_summary?.checkedAt ? new Date(operation.validation_summary.checkedAt).toLocaleString() : 'n/a'}</dd></div>
      </dl>
      {checks.length > 0 && (
        <ul className="mt-4 space-y-2 text-sm">
          {checks.map((check) => (
            <li key={check.code} className="rounded border bg-white p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium">{check.code}</span>
                <span className="text-xs uppercase tracking-wide text-slate-500">{check.result}</span>
              </div>
              <p className="mt-1 text-slate-600">{check.message}</p>
            </li>
          ))}
        </ul>
      )}
      {operation.evidence_refs && operation.evidence_refs.length > 0 && (
        <div className="mt-4 text-sm text-slate-700">
          <h4 className="font-medium">Referencias</h4>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {operation.evidence_refs.map((ref) => (
              <li key={`${ref.kind}:${ref.id}`}>
                {ref.label ?? ref.kind}: {ref.id}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

export default RestoreSimulationEvidence
