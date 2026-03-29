import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { WizardShell } from './WizardShell'

import { createValidation, type WizardStepProps } from '@/lib/console-wizards'

function StepOne({ data, onChange, validation }: WizardStepProps<{ name: string }>) {
  return <div><label htmlFor="name">Nombre</label><input id="name" value={data.name ?? ''} onChange={(e) => onChange({ name: e.target.value })} />{validation.fieldErrors.name ? <span>{validation.fieldErrors.name}</span> : null}</div>
}

afterEach(() => cleanup())

const steps = [
  { id: 'name', label: 'Nombre', component: StepOne, validate: (data: Partial<{ name: string }>) => createValidation(!data.name ? { name: 'required' } : {}) }
]

describe('WizardShell', () => {
  it('renderiza el primer paso y bloquea siguiente si falla validación', () => {
    render(<MemoryRouter><WizardShell open onOpenChange={vi.fn()} title="Wizard" description="desc" context={{ tenantId: null, workspaceId: null, principalRoles: [] }} steps={steps} initialData={{}} buildSummary={() => []} onSubmit={vi.fn()} /></MemoryRouter>)
    expect(screen.getByRole('button', { name: /siguiente/i })).toBeDisabled()
  })

  it('navega al resumen y confirma con payload acumulado', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue({ resourceId: 'res_1', resourceUrl: '/console/test' })
    render(<MemoryRouter><WizardShell open onOpenChange={vi.fn()} title="Wizard" description="desc" context={{ tenantId: null, workspaceId: null, principalRoles: [] }} steps={steps} initialData={{}} buildSummary={(data) => [{ label: 'Nombre', value: data.name ?? '' }]} onSubmit={onSubmit} /></MemoryRouter>)
    await user.type(screen.getByLabelText(/nombre/i), 'Tenant A')
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.click(screen.getByRole('button', { name: /confirmar/i }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ name: 'Tenant A' }))
    expect(await screen.findByText(/recurso creado correctamente/i)).toBeInTheDocument()
  })
})
