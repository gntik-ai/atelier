import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useDestructiveOp } from './useDestructiveOp'

import type { DestructiveOpConfig } from '@/lib/destructive-ops'
import { fetchCascadeImpact } from '@/lib/destructive-ops'

vi.mock('@/lib/destructive-ops', async () => {
  const actual = await vi.importActual<typeof import('@/lib/destructive-ops')>('@/lib/destructive-ops')
  return {
    ...actual,
    fetchCascadeImpact: vi.fn()
  }
})

const fetchCascadeImpactMock = vi.mocked(fetchCascadeImpact)

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function buildConfig(overrides: Partial<Omit<DestructiveOpConfig, 'cascadeImpact' | 'cascadeImpactError'>> = {}): Omit<DestructiveOpConfig, 'cascadeImpact' | 'cascadeImpactError'> {
  return {
    level: 'WARNING',
    operationId: 'soft-delete-application',
    resourceName: 'Portal Clientes',
    resourceType: 'aplicación externa',
    onConfirm: vi.fn().mockResolvedValue(undefined),
    ...overrides
  }
}

describe('useDestructiveOp', () => {
  it('carga impacto para operaciones CRITICAL', async () => {
    fetchCascadeImpactMock.mockResolvedValue([{ resourceType: 'workspace', count: 2 }])
    const { result } = renderHook(() => useDestructiveOp())

    act(() => {
      result.current.openDialog(buildConfig({
        level: 'CRITICAL',
        operationId: 'delete-tenant',
        resourceName: 'Tenant Alpha',
        resourceType: 'tenant',
        resourceId: 'ten_1'
      }))
    })

    await waitFor(() => {
      expect(fetchCascadeImpactMock).toHaveBeenCalledWith('tenant', 'ten_1', expect.any(AbortSignal))
      expect(result.current.opState).toBe('ready')
      expect(result.current.config?.cascadeImpact).toEqual([{ resourceType: 'workspace', count: 2 }])
    })
  })

  it('no carga impacto para operaciones WARNING', () => {
    const { result } = renderHook(() => useDestructiveOp())

    act(() => {
      result.current.openDialog(buildConfig())
    })

    expect(fetchCascadeImpactMock).not.toHaveBeenCalled()
    expect(result.current.opState).toBe('ready')
  })

  it('degrada a ready cuando falla la carga de cascada', async () => {
    fetchCascadeImpactMock.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useDestructiveOp())

    act(() => {
      result.current.openDialog(buildConfig({
        level: 'CRITICAL',
        operationId: 'delete-workspace',
        resourceName: 'Workspace Alpha',
        resourceType: 'workspace',
        resourceId: 'wrk_1'
      }))
    })

    await waitFor(() => {
      expect(result.current.opState).toBe('ready')
      expect(result.current.config?.cascadeImpactError).toBe(true)
    })
  })

  it('cierra tras confirmar y ejecuta onSuccess', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    const onSuccess = vi.fn()
    const { result } = renderHook(() => useDestructiveOp())

    act(() => {
      result.current.openDialog(buildConfig({
        operationId: 'detach-provider',
        resourceName: 'Corp OIDC',
        resourceType: 'provider federado',
        onConfirm,
        onSuccess
      }))
    })

    await act(async () => {
      await result.current.handleConfirm()
    })

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1)
      expect(onSuccess).toHaveBeenCalledTimes(1)
      expect(result.current.isOpen).toBe(false)
      expect(result.current.opState).toBe('idle')
    })
  })

  it.each([
    [{ status: 401, message: 'Unauthorized' }, 'Tu sesión ha expirado. Vuelve a iniciar sesión.'],
    [{ status: 404, message: 'Missing' }, 'El recurso ya no existe o ha sido eliminado.'],
    [new Error('Backend exploded'), 'Backend exploded']
  ])('muestra el mensaje correcto al fallar la confirmación', async (error, expectedMessage) => {
    const { result } = renderHook(() => useDestructiveOp())

    act(() => {
      result.current.openDialog(buildConfig({
        operationId: 'revoke-service-account-credential',
        resourceName: 'Ops SA',
        resourceType: 'credencial de service account',
        onConfirm: vi.fn().mockRejectedValue(error)
      }))
    })

    await act(async () => {
      await result.current.handleConfirm()
    })

    await waitFor(() => {
      expect(result.current.opState).toBe('error')
      expect(result.current.confirmError).toBe(expectedMessage)
      expect(result.current.isOpen).toBe(true)
    })
  })

  it('resetea todo al cancelar', async () => {
    fetchCascadeImpactMock.mockResolvedValue([{ resourceType: 'database', count: 1 }])
    const { result } = renderHook(() => useDestructiveOp())

    act(() => {
      result.current.openDialog(buildConfig({
        level: 'CRITICAL',
        operationId: 'delete-database',
        resourceName: 'DB Alpha',
        resourceType: 'database',
        resourceId: 'db_1'
      }))
    })

    await waitFor(() => expect(result.current.opState).toBe('ready'))
    act(() => {
      result.current.handleCancel()
    })

    expect(result.current.isOpen).toBe(false)
    expect(result.current.opState).toBe('idle')
    expect(result.current.config).toBeNull()
    expect(result.current.confirmError).toBeNull()
  })
})
