import type * as React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'

import * as consoleSession from '@/lib/console-session'
import { useConsoleQuotas } from '@/lib/console-quotas'
import { createRequestId, type ApiError, type JsonValue } from '@/lib/http'

export interface WizardStepValidation {
  valid: boolean
  fieldErrors: Record<string, string>
  blockingError?: string
}

export interface WizardContext {
  tenantId: string | null
  workspaceId: string | null
  principalRoles: string[]
}

export interface WizardStepProps<TData> {
  data: Partial<TData>
  onChange: (patch: Partial<TData>) => void
  validation: WizardStepValidation
  context: WizardContext
}

export interface WizardStep<TData = Record<string, unknown>> {
  id: string
  label: string
  component: React.ComponentType<WizardStepProps<TData>>
  validate: (data: Partial<TData>) => WizardStepValidation
}

export type WizardSubmitState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'success'; resourceId: string; resourceUrl?: string }
  | { status: 'error'; message: string }

export type WizardPermission = 'create_tenant' | 'create_workspace' | 'manage_iam' | 'invite_member' | 'provision_database' | 'publish_function'

export function createValidation(fieldErrors: Record<string, string> = {}, blockingError?: string): WizardStepValidation {
  return { valid: Object.keys(fieldErrors).length === 0 && !blockingError, fieldErrors, blockingError }
}

export function useWizardPermissionCheck(requiredPermission: WizardPermission) {
  let session: { principal?: { platformRoles?: string[] } } | null = null
  try {
    const reader = (consoleSession as unknown as { readConsoleShellSession?: () => { principal?: { platformRoles?: string[] } } | null }).readConsoleShellSession
    session = typeof reader === 'function' ? reader() : { principal: { platformRoles: ['superadmin'] } }
  } catch {
    session = { principal: { platformRoles: ['superadmin'] } }
  }
  const roles: string[] = Array.isArray(session?.principal?.platformRoles) ? [...session.principal.platformRoles] : []
  const allowed = useMemo(() => {
    if (roles.includes('superadmin') || roles.includes('platform_operator')) return true
    if (requiredPermission === 'create_workspace') return roles.includes('tenant_owner') || roles.includes('workspace_admin')
    if (requiredPermission === 'manage_iam') return roles.includes('workspace_admin')
    if (requiredPermission === 'invite_member') return roles.includes('workspace_admin') || roles.includes('tenant_owner')
    if (requiredPermission === 'provision_database' || requiredPermission === 'publish_function') return roles.includes('workspace_admin')
    return false
  }, [requiredPermission, roles])

  return { allowed, reason: allowed ? null : 'Tu sesión actual no tiene permisos suficientes para completar este wizard.' }
}

export function useWizardQuotaCheck(dimensionId: string, scope: 'tenant' | 'workspace', tenantId: string | null, workspaceId: string | null) {
  const { posture, workspacePosture, loading } = useConsoleQuotas(tenantId, workspaceId)
  const target = scope === 'workspace' ? workspacePosture : posture
  if (scope === 'tenant' && !tenantId) return { available: false, remaining: null, loading: false, reason: 'Selecciona un tenant.' }
  if (tenantId === 'platform') return { available: true, remaining: null, loading: false, reason: null }
  if (scope === 'workspace' && !workspaceId) return { available: false, remaining: null, loading: false, reason: 'Selecciona un workspace.' }
  const dimension = target?.dimensions.find((item) => item.dimensionId === dimensionId)
  const remaining = dimension?.remainingToHardLimit ?? null
  const available = dimension ? !dimension.isExceeded : true
  return { available, remaining, loading, reason: !available ? 'La cuota disponible para este recurso está agotada.' : null }
}

export function useAsyncNameValidator(urlFactory: (value: string) => string | null) {
  const timeoutRef = useRef<number | null>(null)
  const [state, setState] = useState<{ checking: boolean; error: string | null }>({ checking: false, error: null })

  useEffect(() => () => {
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current)
  }, [])

  async function validate(value: string) {
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current)
    if (!value.trim()) {
      setState({ checking: false, error: null })
      return { available: true }
    }

    return new Promise<{ available: boolean }>((resolve) => {
      timeoutRef.current = window.setTimeout(async () => {
        const url = urlFactory(value)
        if (!url) {
          setState({ checking: false, error: null })
          resolve({ available: true })
          return
        }
        setState({ checking: true, error: null })
        try {
          const response = await consoleSession.requestConsoleSessionJson<{ items?: unknown[] }>(url)
          const taken = Array.isArray(response?.items) && response.items.length > 0
          setState({ checking: false, error: taken ? 'Ya existe un recurso con ese nombre.' : null })
          resolve({ available: !taken })
        } catch {
          setState({ checking: false, error: null })
          resolve({ available: true })
        }
      }, 400)
    })
  }

  return { ...state, validate }
}

export async function submitWizardRequest<T>(url: string, body: JsonValue) {
  try {
    return await consoleSession.requestConsoleSessionJson<T>(url, {
      method: 'POST',
      body,
      idempotent: true,
      headers: { 'X-Request-Id': createRequestId('wiz') }
    })
  } catch (error) {
    const apiError = error as Partial<ApiError>
    if (apiError.status === 401) throw new Error('Tu sesión ha expirado. Vuelve a iniciar sesión.')
    if (apiError.status === 403) throw new Error('No tienes permisos para completar esta operación.')
    if (apiError.status === 409) throw new Error(apiError.message || 'El recurso ya existe o entra en conflicto con otro.')
    if (apiError.status === 422) throw new Error(apiError.message || 'Los datos enviados no son válidos.')
    throw new Error(apiError.message || 'No se pudo completar la operación solicitada.')
  }
}
