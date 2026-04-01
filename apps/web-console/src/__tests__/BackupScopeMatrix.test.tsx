import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { BackupScopeMatrix } from '@/components/console/BackupScopeMatrix'
import { mockEntries } from './fixtures/backupScopeFixtures'

afterEach(cleanup)

describe('BackupScopeMatrix', () => {
  it('renders table with 7 rows', () => {
    render(<BackupScopeMatrix entries={mockEntries} isLoading={false} />)
    expect(screen.getByTestId('backup-scope-matrix')).toBeInTheDocument()
    expect(screen.getAllByTestId(/^matrix-row-/)).toHaveLength(7)
  })

  it('renders platform-managed entries with green badge class', () => {
    render(<BackupScopeMatrix entries={mockEntries} isLoading={false} />)
    const pgRow = screen.getByTestId('matrix-row-postgresql')
    const badge = pgRow.querySelector('.bg-emerald-100')
    expect(badge).not.toBeNull()
    expect(badge?.textContent).toBe('platform-managed')
  })

  it('renders not-supported entries with red badge class', () => {
    render(<BackupScopeMatrix entries={mockEntries} isLoading={false} />)
    const apisixRow = screen.getByTestId('matrix-row-apisix_config')
    const badge = apisixRow.querySelector('.bg-red-100')
    expect(badge).not.toBeNull()
    expect(badge?.textContent).toBe('not-supported')
  })

  it('renders operator-managed entries with amber badge class', () => {
    render(<BackupScopeMatrix entries={mockEntries} isLoading={false} />)
    const kafkaRow = screen.getByTestId('matrix-row-kafka')
    const badge = kafkaRow.querySelector('.bg-amber-100')
    expect(badge).not.toBeNull()
    expect(badge?.textContent).toBe('operator-managed')
  })

  it('renders RPO tooltip for entries with rpoRangeMinutes', () => {
    render(<BackupScopeMatrix entries={mockEntries} isLoading={false} />)
    const pgRow = screen.getByTestId('matrix-row-postgresql')
    const rpoCell = pgRow.querySelectorAll('td')[4]
    expect(rpoCell.getAttribute('title')).toContain('RPO')
  })

  it('renders loading skeleton when isLoading=true', () => {
    render(<BackupScopeMatrix entries={[]} isLoading={true} />)
    expect(screen.getByTestId('matrix-loading')).toBeInTheDocument()
  })

  it('renders empty state when no entries', () => {
    render(<BackupScopeMatrix entries={[]} isLoading={false} />)
    expect(screen.getByTestId('matrix-empty')).toBeInTheDocument()
  })
})
