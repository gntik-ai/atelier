import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DestructiveConfirmationDialog } from './DestructiveConfirmationDialog'

import { FIXTURE_TENANT_BETA } from '@/test/fixtures/tenants'
import type { DestructiveOpConfig } from '@/lib/destructive-ops'

afterEach(() => {
  cleanup()
})

function buildConfig(overrides: Partial<DestructiveOpConfig> = {}): DestructiveOpConfig {
  return {
    level: 'CRITICAL',
    operationId: 'delete-tenant',
    resourceName: 'Tenant Alpha',
    resourceType: 'tenant',
    resourceId: 'ten_1',
    cascadeImpact: [],
    cascadeImpactError: false,
    onConfirm: vi.fn().mockResolvedValue(undefined),
    ...overrides
  }
}

describe('DestructiveConfirmationDialog', () => {
  it('en CRITICAL deshabilita confirm con input vacío y exige coincidencia exacta', async () => {
    const user = userEvent.setup()
    render(<DestructiveConfirmationDialog open config={buildConfig()} opState="ready" confirmError={null} onConfirm={vi.fn()} onCancel={vi.fn()} />)

    const confirmButton = screen.getByRole('button', { name: /^eliminar$/i })
    const input = screen.getByRole('textbox')

    expect(confirmButton).toBeDisabled()

    await user.type(input, 'Tenant')
    expect(confirmButton).toBeDisabled()

    await user.clear(input)
    await user.type(input, 'Tenant Alpha')
    expect(confirmButton).toBeEnabled()
  })

  it('[RC-03] muestra resumen de cascada en CRITICAL — RF-UI-026 / T03-AC3', () => {
    render(<DestructiveConfirmationDialog open config={buildConfig({ cascadeImpact: [{ resourceType: 'workspace', count: 2 }, { resourceType: 'database', count: 5 }] })} opState="ready" confirmError={null} onConfirm={vi.fn()} onCancel={vi.fn()} />)

    expect(screen.getByText('workspace / 2')).toBeInTheDocument()
    expect(screen.getByText('database / 5')).toBeInTheDocument()
  })

  it('muestra degradación cuando falla el cálculo de cascada', () => {
    render(<DestructiveConfirmationDialog open config={buildConfig({ cascadeImpactError: true })} opState="ready" confirmError={null} onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByText(/no se pudo calcular el impacto completo/i)).toBeInTheDocument()
  })

  it('en WARNING no muestra input adicional', () => {
    render(<DestructiveConfirmationDialog open config={buildConfig({ level: 'WARNING', operationId: 'detach-provider', resourceName: 'Corporate OIDC', resourceType: 'provider federado', impactDescription: 'El provider dejará de estar asociado a la aplicación actual.' })} opState="ready" confirmError={null} onConfirm={vi.fn()} onCancel={vi.fn()} />)

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByText(/esta operación no se puede deshacer/i)).toBeInTheDocument()
  })

  it('deshabilita ambos botones mientras confirma', () => {
    render(<DestructiveConfirmationDialog open config={buildConfig({ level: 'WARNING' })} opState="confirming" confirmError={null} onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('button', { name: /cancelar/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /confirmar|eliminar/i })).toBeDisabled()
  })

  it('muestra el error inline', () => {
    render(<DestructiveConfirmationDialog open config={buildConfig({ level: 'WARNING' })} opState="error" confirmError="Backend exploded" onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('alert')).toHaveTextContent(/backend exploded/i)
  })

  it('pone el foco inicial en cancelar', async () => {
    render(<DestructiveConfirmationDialog open config={buildConfig({ level: 'WARNING' })} opState="ready" confirmError={null} onConfirm={vi.fn()} onCancel={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /cancelar/i })).toHaveFocus()
    })
  })

  it('[RC-06] click fuera del modal cierra el diálogo — RF-UI-026 / T03-AC6', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(<DestructiveConfirmationDialog open config={buildConfig({ level: 'WARNING' })} opState="ready" confirmError={null} onConfirm={vi.fn()} onCancel={onCancel} />)

    const overlay = screen.getByRole('alertdialog').parentElement?.parentElement?.parentElement
    if (!overlay) throw new Error('No overlay found')

    await user.click(overlay)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('cierra con Escape', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(<DestructiveConfirmationDialog open config={buildConfig({ level: 'WARNING' })} opState="ready" confirmError={null} onConfirm={vi.fn()} onCancel={onCancel} />)
    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('[RC-07] tras confirmación exitosa invoca onSuccess — RF-UI-026 / T03-AC7', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    const onSuccess = vi.fn()
    render(<DestructiveConfirmationDialog open config={buildConfig({ level: 'WARNING', onSuccess })} opState="ready" confirmError={null} onConfirm={onConfirm} onCancel={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /confirmar/i }))

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalled()
      expect(onSuccess).toHaveBeenCalled()
    })
  })

  it('[RC-10] no se abren dos diálogos simultáneamente — RF-UI-026 / T03-AC10', () => {
    render(
      <>
        <DestructiveConfirmationDialog open config={buildConfig({ operationId: 'one' })} opState="ready" confirmError={null} onConfirm={vi.fn()} onCancel={vi.fn()} />
        <DestructiveConfirmationDialog open={false} config={buildConfig({ operationId: 'two', resourceName: 'Tenant Two' })} opState="ready" confirmError={null} onConfirm={vi.fn()} onCancel={vi.fn()} />
      </>
    )

    expect(screen.getAllByRole('alertdialog')).toHaveLength(1)
    expect(screen.queryByText(/tenant two/i)).not.toBeInTheDocument()
  })

  it('aisla el contexto multi-tenant activo', () => {
    render(<DestructiveConfirmationDialog open config={buildConfig({ resourceName: 'Tenant Alpha' })} opState="ready" confirmError={null} onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.queryByText(FIXTURE_TENANT_BETA.name)).not.toBeInTheDocument()
    expect(screen.queryByText(FIXTURE_TENANT_BETA.tenantId)).not.toBeInTheDocument()
  })
})
