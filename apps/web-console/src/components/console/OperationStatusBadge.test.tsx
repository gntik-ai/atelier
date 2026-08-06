import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { OperationStatusBadge } from './OperationStatusBadge'
import { OPERATION_STATUSES, OPERATION_STATUS_LABELS } from '@/lib/generated/async-operation-status-vocabulary.mjs'

describe('OperationStatusBadge', () => {
  it('F01 renders pending state with spanish label', () => {
    render(<OperationStatusBadge status="pending" />)

    const badge = screen.getByText('Pendiente')
    expect(badge).toBeInTheDocument()
    expect(badge.className).toContain('bg-muted/40')
  })

  it('F02 renders running state with motion-safe pulse animation', () => {
    render(<OperationStatusBadge status="running" />)

    const badge = screen.getByText('En curso')
    const classes = badge.className.split(/\s+/)
    expect(classes).toContain('motion-safe:animate-pulse')
    expect(classes).not.toContain('animate-pulse')
  })

  it('F03 renders completed state with dark-root-safe emerald styling', () => {
    render(<OperationStatusBadge status="completed" />)

    const badge = screen.getByText('Completada')
    expect(badge.className).toContain('text-emerald-300')
  })

  it('F04 renders failed state', () => {
    render(<OperationStatusBadge status="failed" />)

    const badge = screen.getByText('Fallida')
    expect(badge.className).toContain('bg-red-500/10')
  })

  it('F05 renders timed out state', () => {
    render(<OperationStatusBadge status="timed_out" />)

    const badge = screen.getByText('Expirada')
    expect(badge.className).toContain('bg-amber-500/10')
  })

  it('F06 renders cancelled state', () => {
    render(<OperationStatusBadge status="cancelled" />)

    const badge = screen.getByText('Cancelada')
    expect(badge.className).toContain('bg-muted/40')
  })

  it('C-12 renders cancelling as accessible visible text', () => {
    render(<OperationStatusBadge status="cancelling" />)

    const badge = screen.getByText('Cancelando')
    expect(badge).toBeVisible()
    const classes = badge.className.split(/\s+/)
    expect(classes).toContain('motion-safe:animate-pulse')
    expect(classes).not.toContain('animate-pulse')
  })

  it('[#744][Scenario: Dark-theme table/panel] no state uses hardcoded light-mode color classes', () => {
    for (const status of OPERATION_STATUSES) {
      const { unmount } = render(<OperationStatusBadge status={status} />)
      const badge = screen.getByText(OPERATION_STATUS_LABELS[status])
      expect(badge.className).not.toMatch(/bg-white|bg-slate-\d|text-slate-\d/)
      unmount()
    }
  })
})
