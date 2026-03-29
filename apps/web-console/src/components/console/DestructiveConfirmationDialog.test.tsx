import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DestructiveConfirmationDialog } from './DestructiveConfirmationDialog'

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
    render(
      <DestructiveConfirmationDialog
        open
        config={buildConfig()}
        opState="ready"
        confirmError={null}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    const confirmButton = screen.getByRole('button', { name: /^eliminar$/i })
    const input = screen.getByRole('textbox')

    expect(confirmButton).toBeDisabled()

    await user.type(input, 'Tenant')
    expect(confirmButton).toBeDisabled()

    await user.clear(input)
    await user.type(input, 'Tenant Alpha')
    expect(confirmButton).toBeEnabled()
  })

  it('muestra degradación cuando falla el cálculo de cascada', () => {
    render(
      <DestructiveConfirmationDialog
        open
        config={buildConfig({ cascadeImpactError: true })}
        opState="ready"
        confirmError={null}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    expect(screen.getByText(/no se pudo calcular el impacto completo/i)).toBeInTheDocument()
  })

  it('en WARNING no muestra input adicional', () => {
    render(
      <DestructiveConfirmationDialog
        open
        config={buildConfig({
          level: 'WARNING',
          operationId: 'detach-provider',
          resourceName: 'Corporate OIDC',
          resourceType: 'provider federado',
          impactDescription: 'El provider dejará de estar asociado a la aplicación actual.'
        })}
        opState="ready"
        confirmError={null}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByText(/esta operación no se puede deshacer/i)).toBeInTheDocument()
  })

  it('deshabilita ambos botones mientras confirma', () => {
    render(
      <DestructiveConfirmationDialog
        open
        config={buildConfig({ level: 'WARNING' })}
        opState="confirming"
        confirmError={null}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: /cancelar/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /confirmar/i })).toBeDisabled()
  })

  it('muestra el error inline', () => {
    render(
      <DestructiveConfirmationDialog
        open
        config={buildConfig({ level: 'WARNING' })}
        opState="error"
        confirmError="Backend exploded"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    expect(screen.getByRole('alert')).toHaveTextContent(/backend exploded/i)
  })

  it('pone el foco inicial en cancelar', async () => {
    render(
      <DestructiveConfirmationDialog
        open
        config={buildConfig({ level: 'WARNING' })}
        opState="ready"
        confirmError={null}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /cancelar/i })).toHaveFocus()
    })
  })

  it('cierra con Escape y click fuera', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(
      <DestructiveConfirmationDialog
        open
        config={buildConfig({ level: 'WARNING' })}
        opState="ready"
        confirmError={null}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />
    )

    const overlay = screen.getByRole('alertdialog').parentElement?.parentElement?.parentElement
    if (!overlay) {
      throw new Error('No overlay found')
    }

    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(1)

    await user.click(overlay)
    expect(onCancel).toHaveBeenCalledTimes(2)
  })
})
