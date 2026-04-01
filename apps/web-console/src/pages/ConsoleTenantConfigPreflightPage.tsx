/**
 * Console page for tenant config pre-flight conflict check.
 */

import { useState, useCallback } from 'react'
import { ConfigIdentifierMapEditor } from '@/components/ConfigIdentifierMapEditor'
import { PreflightConflictReport } from '@/components/PreflightConflictReport'
import {
  runPreflightCheck,
  ConfigPreflightApiError,
} from '@/api/configPreflightApi'
import type { PreflightReport, PreflightRequest } from '@/api/configPreflightApi'
import type { IdentifierMapEntry } from '@/api/configReprovisionApi'

type Step = 'upload' | 'map' | 'result'

interface PageProps {
  tenantId: string
  userRole?: string
}

const KNOWN_DOMAINS = ['iam', 'postgres_metadata', 'mongo_metadata', 'kafka', 'functions', 'storage']

export function ConsoleTenantConfigPreflightPage({ tenantId, userRole }: PageProps) {
  const [step, setStep] = useState<Step>('upload')
  const [artifactText, setArtifactText] = useState('')
  const [artifact, setArtifact] = useState<Record<string, unknown> | null>(null)
  const [selectedDomains, setSelectedDomains] = useState<string[]>([])
  const [mapEntries, setMapEntries] = useState<IdentifierMapEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [report, setReport] = useState<PreflightReport | null>(null)

  // Access control
  if (userRole && !['superadmin', 'sre'].includes(userRole)) {
    return (
      <div data-testid="forbidden" className="p-8 text-center text-red-600">
        No tienes permisos para acceder a esta página.
      </div>
    )
  }

  const handleAnalyze = useCallback(async () => {
    setError(undefined)
    setLoading(true)
    try {
      const parsed = JSON.parse(artifactText)
      setArtifact(parsed)

      const req: PreflightRequest = {
        artifact: parsed,
        domains: selectedDomains.length > 0 ? selectedDomains : undefined,
      }
      const result = await runPreflightCheck(tenantId, req)

      if (result.needs_confirmation && result.identifier_map_proposal) {
        const proposal = result.identifier_map_proposal as { entries?: IdentifierMapEntry[] }
        setMapEntries(proposal.entries ?? [])
        setStep('map')
      } else {
        setReport(result)
        setStep('result')
      }
    } catch (err) {
      if (err instanceof SyntaxError) {
        setError('El artefacto no es un JSON válido.')
      } else if (err instanceof ConfigPreflightApiError) {
        setError(err.message)
      } else {
        setError('Error al ejecutar la validación previa.')
      }
    } finally {
      setLoading(false)
    }
  }, [artifactText, tenantId, selectedDomains])

  const handleConfirmMapAndAnalyze = useCallback(async () => {
    if (!artifact) return
    setError(undefined)
    setLoading(true)
    try {
      const req: PreflightRequest = {
        artifact,
        identifier_map: mapEntries.length > 0 ? { entries: mapEntries } : undefined,
        domains: selectedDomains.length > 0 ? selectedDomains : undefined,
      }
      const result = await runPreflightCheck(tenantId, req)
      setReport(result)
      setStep('result')
    } catch (err) {
      if (err instanceof ConfigPreflightApiError) {
        setError(err.message)
      } else {
        setError('Error al ejecutar la validación previa.')
      }
    } finally {
      setLoading(false)
    }
  }, [artifact, mapEntries, tenantId, selectedDomains])

  const handleReset = useCallback(() => {
    setStep('upload')
    setArtifactText('')
    setArtifact(null)
    setSelectedDomains([])
    setMapEntries([])
    setReport(null)
    setError(undefined)
  }, [])

  const handleDomainToggle = useCallback((domain: string) => {
    setSelectedDomains(prev =>
      prev.includes(domain) ? prev.filter(d => d !== domain) : [...prev, domain]
    )
  }, [])

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6" data-testid="preflight-page">
      <h1 className="text-xl font-bold text-slate-800">Validación previa de conflictos</h1>
      <p className="text-sm text-slate-500">
        Tenant destino: <span className="font-mono font-medium">{tenantId}</span>
      </p>

      {error && (
        <div data-testid="page-error" className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Step 1: Upload and analyze */}
      {step === 'upload' && (
        <div className="space-y-3" data-testid="step-upload">
          <h2 className="text-sm font-semibold text-slate-700">Paso 1 — Cargar artefacto y analizar conflictos</h2>
          <textarea
            className="w-full h-48 rounded-md border border-slate-300 p-3 font-mono text-xs focus:ring-blue-500 focus:outline-none focus:ring-1"
            placeholder="Pega aquí el JSON del artefacto de exportación…"
            value={artifactText}
            onChange={(e) => setArtifactText(e.target.value)}
            aria-label="Artefacto de exportación JSON"
            data-testid="artifact-input"
          />

          <div>
            <p className="text-xs font-medium text-slate-500 mb-1">Filtrar dominios (opcional):</p>
            <div className="flex flex-wrap gap-2">
              {KNOWN_DOMAINS.map(d => (
                <label key={d} className="flex items-center gap-1 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={selectedDomains.includes(d)}
                    onChange={() => handleDomainToggle(d)}
                    className="rounded"
                    data-testid={`domain-filter-${d}`}
                  />
                  {d}
                </label>
              ))}
            </div>
          </div>

          <button
            type="button"
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            onClick={handleAnalyze}
            disabled={loading || !artifactText.trim()}
            data-testid="analyze-button"
          >
            {loading ? 'Analizando…' : 'Analizar conflictos'}
          </button>
        </div>
      )}

      {/* Step map: Review identifier map */}
      {step === 'map' && (
        <div className="space-y-3" data-testid="step-map">
          <h2 className="text-sm font-semibold text-slate-700">Confirmar mapa de identificadores</h2>
          <p className="text-xs text-slate-500">
            El artefacto proviene de un tenant diferente. Confirma o ajusta el mapa de identificadores antes de ejecutar el análisis.
          </p>
          <ConfigIdentifierMapEditor entries={mapEntries} onChange={setMapEntries} />
          <button
            type="button"
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            onClick={handleConfirmMapAndAnalyze}
            disabled={loading}
            data-testid="confirm-map-button"
          >
            {loading ? 'Analizando…' : 'Confirmar mapa y analizar'}
          </button>
        </div>
      )}

      {/* Step result */}
      {step === 'result' && report && (
        <div className="space-y-3" data-testid="step-result">
          <PreflightConflictReport report={report} />

          {report.summary.risk_level === 'low' && !report.summary.incomplete_analysis && (
            <div className="rounded-md bg-green-50 border border-green-200 p-3 text-sm text-green-700" data-testid="safe-banner">
              ✅ Sin conflictos detectados. Puede reaprovisionar con confianza.
            </div>
          )}

          {(report.summary.conflict_counts.low + report.summary.conflict_counts.medium +
            report.summary.conflict_counts.high + report.summary.conflict_counts.critical) > 0 && (
            <div className="rounded-md bg-blue-50 border border-blue-200 p-3 text-sm text-blue-700" data-testid="reprovision-link">
              Revise los conflictos antes de proceder. Puede ir a la{' '}
              <a href={`/admin/tenants/${tenantId}/config/reprovision`} className="underline font-medium">
                página de reaprovisionamiento
              </a>{' '}
              cuando esté listo.
            </div>
          )}

          <button
            type="button"
            className="rounded-md bg-slate-600 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
            onClick={handleReset}
            data-testid="reset-button"
          >
            Nueva validación
          </button>
        </div>
      )}
    </div>
  )
}
