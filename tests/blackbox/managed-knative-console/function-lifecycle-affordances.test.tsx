/**
 * Public console regressions for Function dependency and cleanup lifecycle states.
 *
 * bbx-933-console-function-unavailable-08 | fn-function-runtime-availability-gate
 * OpenSpec #### Scenario: Degraded metadata read remains honest
 * bbx-933-console-function-delete-pending-09 | fn-function-runtime-availability-gate
 * OpenSpec #### Scenario: Delete during an outage is accepted as pending cleanup
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ConsoleFunctionsPage } from '../../../apps/web-console/src/pages/ConsoleFunctionsPage'

const publicApi = vi.hoisted(() => ({
  request: vi.fn(),
  deleteFunction: vi.fn()
}))

vi.mock('../../../apps/web-console/src/lib/console-context', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../apps/web-console/src/lib/console-context')>()
  return {
    ...original,
    useConsoleContext: () => ({ activeTenantId: 'ten_alpha', activeWorkspaceId: 'wrk_alpha' })
  }
})

vi.mock('../../../apps/web-console/src/lib/console-session', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../apps/web-console/src/lib/console-session')>()
  return { ...original, requestConsoleSessionJson: publicApi.request }
})

vi.mock('../../../apps/web-console/src/services/functionsApi', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../apps/web-console/src/services/functionsApi')>()
  return { ...original, deleteFunction: publicApi.deleteFunction }
})

type BlockedState = 'unavailable' | 'deletion_pending'

function functionAction(state: BlockedState) {
  return {
    resourceId: `res_${state.replace('_', '')}`,
    tenantId: 'ten_alpha',
    workspaceId: 'wrk_alpha',
    actionName: `orders-${state.replace('_', '-')}`,
    status: state,
    activeVersionId: 'fnv_active',
    rollbackAvailable: true,
    versionCount: 2,
    provisioning: { state },
    runtimeDependency: {
      mode: 'managed',
      state: state === 'unavailable' ? 'unavailable' : 'degraded',
      reason: state === 'unavailable' ? 'SERVING_UNAVAILABLE' : 'CLEANUP_PENDING',
      ready: false
    },
    execution: {
      runtime: 'nodejs:20',
      entrypoint: 'main',
      limits: { timeoutMs: 60_000, memoryMb: 256 }
    },
    source: {
      kind: 'inline_code',
      inlineCode: 'export async function main() { return { ok: true } }',
      entryFile: 'index.js'
    },
    activationPolicy: { mode: 'workspace_default' },
    secretReferences: [],
    timestamps: {
      createdAt: '2026-08-07T09:00:00.000Z',
      updatedAt: '2026-08-07T09:00:00.000Z'
    }
  }
}

function installFunctionResponses(state: BlockedState) {
  const action = functionAction(state)
  publicApi.request.mockImplementation(async (url: string) => {
    if (url === '/v1/functions/workspaces/wrk_alpha/inventory') {
      return {
        workspaceId: 'wrk_alpha',
        actions: [action],
        counts: { actions: 1, packages: 0, rules: 0, triggers: 0, httpExposures: 0 }
      }
    }
    if (url === `/v1/functions/actions/${action.resourceId}`) return action
    if (url === `/v1/functions/actions/${action.resourceId}/versions?page[size]=50`) {
      return {
        items: [{
          versionId: 'fnv_prior',
          resourceId: action.resourceId,
          versionNumber: 1,
          status: 'historical',
          rollbackEligible: true,
          timestamps: { createdAt: '2026-08-07T08:00:00.000Z' }
        }],
        page: { size: 1 }
      }
    }
    throw new Error(`Unexpected public console request: ${url}`)
  })
  return action
}

async function expectAllFunctionWritesBlocked(
  state: BlockedState,
  explanation: RegExp
) {
  const action = installFunctionResponses(state)
  render(<MemoryRouter><ConsoleFunctionsPage /></MemoryRouter>)

  const inventoryEntry = await screen.findByRole('button', { name: new RegExp(action.actionName, 'i') })
  await userEvent.click(inventoryEntry)
  await waitFor(() => expect(publicApi.request).toHaveBeenCalledWith(
    `/v1/functions/actions/${action.resourceId}`,
    expect.anything()
  ))

  const deleteButton = await screen.findByRole('button', { name: new RegExp(`Eliminar función ${action.actionName}`, 'i') })
  expect(deleteButton).toBeDisabled()
  expect(deleteButton).toHaveAttribute('aria-describedby', 'functions-write-disabled-reason')
  expect(screen.getByText(explanation)).toBeInTheDocument()

  await userEvent.click(screen.getByRole('tab', { name: 'Versiones' }))
  const rollbackPanel = screen.getByRole('tabpanel')
  const rollbackButton = await within(rollbackPanel).findByRole('button', { name: 'Revertir' })
  expect(rollbackButton).toBeDisabled()
  expect(rollbackButton).toHaveAttribute('aria-describedby', 'functions-write-disabled-reason')

  await userEvent.click(screen.getByRole('tab', { name: 'Invocar' }))
  const invokeButton = within(screen.getByRole('tabpanel')).getByRole('button', { name: 'Invocar' })
  expect(invokeButton).toBeDisabled()
  expect(invokeButton).toHaveAttribute('aria-describedby', 'functions-write-disabled-reason')

  await userEvent.click(screen.getByRole('tab', { name: 'Desplegar' }))
  const updateButton = within(screen.getByRole('tabpanel')).getByRole('button', { name: 'Actualizar función' })
  expect(updateButton).toBeDisabled()
  expect(updateButton).toHaveAttribute('aria-describedby', 'functions-write-disabled-reason')

  expect(publicApi.deleteFunction).not.toHaveBeenCalled()
}

beforeEach(() => {
  publicApi.request.mockReset()
  publicApi.deleteFunction.mockReset()
})

describe('issue #933 Function lifecycle affordances', () => {
  /**
   * bbx-933-console-function-unavailable-08 | fn-function-runtime-availability-gate
   * OpenSpec #### Scenario: Degraded metadata read remains honest
   */
  it('bbx-933-console-function-unavailable-08 disables and explains edit, invoke, rollback, and delete while unavailable', async () => {
    await expectAllFunctionWritesBlocked(
      'unavailable',
      /runtime.*no (?:está )?disponible|no disponible.*runtime/i
    )
  })

  /**
   * bbx-933-console-function-delete-pending-09 | fn-function-runtime-availability-gate
   * OpenSpec #### Scenario: Delete during an outage is accepted as pending cleanup
   */
  it('bbx-933-console-function-delete-pending-09 disables and explains edit, invoke, rollback, and delete while deletion is pending', async () => {
    await expectAllFunctionWritesBlocked(
      'deletion_pending',
      /eliminación.*pendiente|pendiente.*eliminación/i
    )
  })
})
