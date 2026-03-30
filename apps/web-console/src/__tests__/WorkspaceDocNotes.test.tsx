import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WorkspaceDocNotes } from '@/components/console/WorkspaceDocNotes'

describe('WorkspaceDocNotes', () => {
  it('admin sees add button', () => {
    render(<WorkspaceDocNotes notes={[]} workspaceId="wrk-1" isAdmin onCreate={vi.fn()} />)
    expect(screen.getByText('Add note')).toBeInTheDocument()
  })

  it('viewer sees readonly note', () => {
    render(<WorkspaceDocNotes notes={[{ noteId: 'n1', content: 'hola', authorId: 'u1', createdAt: '', updatedAt: '' }]} workspaceId="wrk-1" isAdmin={false} />)
    expect(screen.getByText('hola')).toBeInTheDocument()
  })

  it('admin can submit draft', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined)
    render(<WorkspaceDocNotes notes={[]} workspaceId="wrk-1" isAdmin onCreate={onCreate} />)
    fireEvent.change(screen.getByLabelText('New note'), { target: { value: 'nota' } })
    fireEvent.click(screen.getByText('Add note'))
    expect(onCreate).toHaveBeenCalledWith('nota')
  })
})
