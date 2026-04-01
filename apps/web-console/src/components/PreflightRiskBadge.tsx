/**
 * Badge component showing the global risk level of a preflight conflict report.
 */

interface PreflightRiskBadgeProps {
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
  size?: 'sm' | 'md' | 'lg'
}

const LEVEL_CONFIG: Record<string, { bg: string; text: string; label: string }> = {
  low:      { bg: 'bg-green-100',  text: 'text-green-800',  label: 'Sin conflictos' },
  medium:   { bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'Riesgo medio' },
  high:     { bg: 'bg-orange-100', text: 'text-orange-800', label: 'Riesgo alto' },
  critical: { bg: 'bg-red-100',    text: 'text-red-800',    label: 'Riesgo crítico' },
}

const SIZE_CLASSES: Record<string, string> = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-3 py-1 text-sm',
  lg: 'px-4 py-1.5 text-base',
}

export function PreflightRiskBadge({ riskLevel, size = 'md' }: PreflightRiskBadgeProps) {
  const config = LEVEL_CONFIG[riskLevel] ?? LEVEL_CONFIG.medium
  const sizeClass = SIZE_CLASSES[size] ?? SIZE_CLASSES.md

  return (
    <span
      className={`inline-flex items-center rounded-full font-semibold ${config.bg} ${config.text} ${sizeClass}`}
      data-testid="risk-badge"
      data-risk-level={riskLevel}
      aria-label={`Nivel de riesgo: ${config.label}`}
    >
      {config.label}
    </span>
  )
}
