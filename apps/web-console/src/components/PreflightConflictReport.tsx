/**
 * Panel component showing the full preflight conflict report.
 */

import { useState } from 'react'
import { PreflightRiskBadge } from './PreflightRiskBadge'
import type { PreflightReport, DomainAnalysisResult, ConflictEntry } from '@/api/configPreflightApi'

interface PreflightConflictReportProps {
  report: PreflightReport
}

const SEVERITY_COLORS: Record<string, string> = {
  low: 'bg-green-50 text-green-700 border-green-200',
  medium: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  high: 'bg-orange-50 text-orange-700 border-orange-200',
  critical: 'bg-red-50 text-red-700 border-red-200',
}

const DOMAIN_STATUS_LABEL: Record<string, { label: string; color: string }> = {
  analyzed: { label: 'Analizado', color: 'text-blue-700 bg-blue-50' },
  no_conflicts: { label: 'Sin conflictos', color: 'text-green-700 bg-green-50' },
  skipped_not_exportable: { label: 'No exportado', color: 'text-slate-500 bg-slate-100' },
  analysis_error: { label: 'Error de análisis', color: 'text-red-700 bg-red-50' },
}

function ConflictDetail({ conflict }: { conflict: ConflictEntry }) {
  const [expanded, setExpanded] = useState(false)
  const colorClass = SEVERITY_COLORS[conflict.severity] ?? SEVERITY_COLORS.medium

  return (
    <div className={`rounded-md border p-3 space-y-2 ${colorClass}`} data-testid="conflict-entry">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs">{conflict.resource_type}</span>
          <span className="font-semibold text-sm">{conflict.resource_name}</span>
          <PreflightRiskBadge riskLevel={conflict.severity} size="sm" />
        </div>
        {conflict.diff && (
          <button
            type="button"
            className="text-xs underline"
            onClick={() => setExpanded(!expanded)}
            data-testid="toggle-diff"
          >
            {expanded ? 'Ocultar diff' : 'Ver diff'}
          </button>
        )}
      </div>

      <p className="text-xs">{conflict.recommendation}</p>

      {expanded && conflict.diff && (
        <pre className="mt-2 rounded bg-white/50 p-2 text-xs overflow-x-auto" data-testid="conflict-diff">
          {JSON.stringify(conflict.diff, null, 2)}
        </pre>
      )}
    </div>
  )
}

function DomainSection({ domain }: { domain: DomainAnalysisResult }) {
  const [expanded, setExpanded] = useState(domain.conflicts.length > 0)
  const statusInfo = DOMAIN_STATUS_LABEL[domain.status] ?? DOMAIN_STATUS_LABEL.analyzed

  return (
    <div className="border rounded-lg" data-testid={`domain-section-${domain.domain_key}`}>
      <button
        type="button"
        className="w-full flex items-center justify-between p-3 hover:bg-slate-50"
        onClick={() => setExpanded(!expanded)}
        data-testid={`domain-toggle-${domain.domain_key}`}
      >
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm">{domain.domain_key}</span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusInfo.color}`}>
            {statusInfo.label}
          </span>
          {domain.conflicts.length > 0 && (
            <span className="text-xs text-slate-500">{domain.conflicts.length} conflicto(s)</span>
          )}
        </div>
        <span className="text-xs text-slate-400">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="p-3 pt-0 space-y-2">
          {domain.status === 'analysis_error' && domain.analysis_error_message && (
            <div className="rounded-md bg-red-50 border border-red-200 p-2 text-xs text-red-700" data-testid="analysis-error">
              {domain.analysis_error_message}
            </div>
          )}
          {domain.conflicts.length === 0 && domain.status !== 'analysis_error' && (
            <p className="text-xs text-slate-500">Sin conflictos detectados en este dominio.</p>
          )}
          {domain.conflicts.map((c, i) => (
            <ConflictDetail key={`${c.resource_type}-${c.resource_name}-${i}`} conflict={c} />
          ))}
        </div>
      )}
    </div>
  )
}

export function PreflightConflictReport({ report }: PreflightConflictReportProps) {
  const [showRedacted, setShowRedacted] = useState(false)
  const { summary } = report

  const redactedEntries = report.domains.flatMap(d => d.compatible_with_redacted ?? [])

  return (
    <div className="space-y-4" data-testid="preflight-report">
      {/* Executive summary */}
      <div className="flex items-center gap-4 p-4 rounded-lg bg-slate-50 border" data-testid="executive-summary">
        <PreflightRiskBadge riskLevel={summary.risk_level} size="lg" />
        <div className="flex-1 text-sm text-slate-600 space-y-1">
          <div>Recursos analizados: <span className="font-semibold">{summary.total_resources_analyzed}</span></div>
          <div>Compatibles: <span className="font-semibold">{summary.compatible}</span></div>
          {summary.compatible_with_redacted_fields > 0 && (
            <div>Compatibles (con campos redactados): <span className="font-semibold">{summary.compatible_with_redacted_fields}</span></div>
          )}
          <div className="flex gap-3">
            {Object.entries(summary.conflict_counts)
              .filter(([, v]) => v > 0)
              .map(([sev, count]) => (
                <span key={sev} className="text-xs">
                  {sev}: <span className="font-semibold">{count}</span>
                </span>
              ))}
          </div>
        </div>
      </div>

      {/* Incomplete analysis warning */}
      {summary.incomplete_analysis && (
        <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-700" data-testid="incomplete-warning">
          ⚠ Análisis incompleto. Los siguientes dominios no pudieron evaluarse:{' '}
          <span className="font-semibold">
            {summary.domains_skipped.filter(d =>
              report.domains.find(dr => dr.domain_key === d && dr.status === 'analysis_error')
            ).join(', ')}
          </span>
        </div>
      )}

      {/* Domain sections */}
      <div className="space-y-2" data-testid="domain-list">
        {report.domains.map(d => (
          <DomainSection key={d.domain_key} domain={d} />
        ))}
      </div>

      {/* Redacted resources section */}
      {redactedEntries.length > 0 && (
        <div className="border rounded-lg">
          <button
            type="button"
            className="w-full flex items-center justify-between p-3 hover:bg-slate-50 text-sm"
            onClick={() => setShowRedacted(!showRedacted)}
            data-testid="toggle-redacted"
          >
            <span className="text-slate-500">Recursos con campos redactados ({redactedEntries.length})</span>
            <span className="text-xs text-slate-400">{showRedacted ? '▲' : '▼'}</span>
          </button>
          {showRedacted && (
            <div className="p-3 pt-0 space-y-1" data-testid="redacted-list">
              {redactedEntries.map((r, i) => (
                <div key={i} className="text-xs text-slate-500">
                  <span className="font-mono">{r.resource_type}</span> / <span className="font-semibold">{r.resource_name}</span>
                  — campos no comparados: {r.redacted_fields.join(', ')}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
