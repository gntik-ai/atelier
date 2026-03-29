import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { WizardShell } from './WizardShell'

import { createValidation, type WizardStepProps } from '@/lib/console-wizards'

interface TestData {
  name: string
  plan: string
}

function NameStep({ data, onChange, validation }: WizardStepProps<TestData>) {
  return (
    <div>
      <label htmlFor="name">Nombre</label>
      <input id="name" value={data.name ?? ''} onChange={(e) => onChange({ name: e.target.value })} />
      {validation.fieldErrors.name ? <span>{validation.fieldErrors.name}</span> : null}
    </div>
  )
}

function PlanStep({ data, onChange, validation }: WizardStepProps<TestData>) {
  return (
    <div>
      <label htmlFor="plan">Plan</label>
      <select id="plan" value={data.plan ?? ''} onChange={(e) => onChange({ plan: e.target.value })}>
        <option value="">Selecciona</option>
        <option value="starter">starter</option>
      </select>
      {validation.fieldErrors.plan ? <span>{validation.fieldErrors.plan}</span> : null}
    </div>
  )
}

afterEach(() => cleanup())

const steps = [
  { id: 'name', label: 'Nombre', component: NameStep, validate: (data: Partial<TestData>) => createValidation(!data.name ? { name: 'required' } : {}) },
  { id: 'plan', label: 'Plan', component: PlanStep, validate: (data: Partial<TestData>) => createValidation(!data.plan ? { plan: 'required' } : {}) }
]

function renderWizard(onSubmit = vi.fn()) {
  render(
    <MemoryRouter>
      <WizardShell
        open
        onOpenChange={vi.fn()}
        title="Wizard"
        description="desc"
        context={{ tenantId: null, workspaceId: null, principalRoles: [] }}
        steps={steps}
        initialData={{}}
        buildSummary={(data) => [
          { label: 'Nombre', value: data.name ?? '' },
          { label: 'Plan', value: data.plan ?? '' }
        ]}
        onSubmit={onSubmit}
      />
    </MemoryRouter>
  )
}

describe('WizardShell', () => {
  it('[RW-02] bloquea avance con datos inválidos — RF-UI-025 / T02-AC2', () => {
    renderWizard()
    expect(screen.getByRole('button', { name: /siguiente/i })).toBeDisabled()
  })

  it('[RW-01] navega adelante y atrás preservando datos — RF-UI-025 / T02-AC1', async () => {
    const user = userEvent.setup()
    renderWizard()

    await user.type(screen.getByLabelText(/nombre/i), 'Tenant A')
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.selectOptions(screen.getByLabelText(/plan/i), 'starter')
    await user.click(screen.getByRole('button', { name: /anterior/i }))

    expect(screen.getByLabelText(/nombre/i)).toHaveValue('Tenant A')
  })

  it('[RW-03] paso de resumen muestra todos los valores — RF-UI-025 / T02-AC3', async () => {
    const user = userEvent.setup()
    renderWizard()

    await user.type(screen.getByLabelText(/nombre/i), 'Tenant A')
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.selectOptions(screen.getByLabelText(/plan/i), 'starter')
    await user.click(screen.getByRole('button', { name: /siguiente/i }))

    expect(screen.getAllByText('Nombre').length).toBeGreaterThan(0)
    expect(screen.getByText('Tenant A')).toBeInTheDocument()
    expect(screen.getAllByText('Plan').length).toBeGreaterThan(0)
    expect(screen.getByText('starter')).toBeInTheDocument()
  })

  it('[RW-04] desde resumen navegar a paso anterior — RF-UI-025 / T02-AC4', async () => {
    const user = userEvent.setup()
    renderWizard()

    await user.type(screen.getByLabelText(/nombre/i), 'Tenant A')
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.selectOptions(screen.getByLabelText(/plan/i), 'starter')
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.click(screen.getByRole('button', { name: /anterior/i }))

    expect(screen.getByLabelText(/plan/i)).toBeInTheDocument()
  })

  it('[RW-05] confirmación exitosa muestra feedback y URL — RF-UI-025 / T02-AC5', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue({ resourceId: 'res_1', resourceUrl: '/console/test' })
    renderWizard(onSubmit)

    await user.type(screen.getByLabelText(/nombre/i), 'Tenant A')
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.selectOptions(screen.getByLabelText(/plan/i), 'starter')
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.click(screen.getByRole('button', { name: /confirmar/i }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ name: 'Tenant A', plan: 'starter' }))
    expect(await screen.findByText(/recurso creado correctamente/i)).toBeInTheDocument()
  })

  it('[RW-06] error de backend preserva datos del formulario — RF-UI-025 / T02-AC6', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockRejectedValue(new Error('Backend exploded'))
    renderWizard(onSubmit)

    await user.type(screen.getByLabelText(/nombre/i), 'Tenant A')
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.selectOptions(screen.getByLabelText(/plan/i), 'starter')
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.click(screen.getByRole('button', { name: /confirmar/i }))

    expect(await screen.findByText(/backend exploded/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /anterior/i }))
    expect(screen.getByLabelText(/plan/i)).toHaveValue('starter')
    await user.click(screen.getByRole('button', { name: /anterior/i }))
    expect(screen.getByLabelText(/nombre/i)).toHaveValue('Tenant A')
  })
})
