import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react'

import { type ConsoleShellSession, requestConsoleSessionJson } from '@/lib/console-session'
import { getEffectiveCapabilities } from '@/services/planManagementApi'

const CONSOLE_ACTIVE_CONTEXT_STORAGE_KEY = 'in-atelier.console-active-context'

interface TenantCollectionResponse {
  items: Tenant[]
  page: PageInfo
}

interface WorkspaceCollectionResponse {
  items: Workspace[]
  page: PageInfo
}

interface PageInfo {
  after?: string | null
}

interface ProvisioningSummary {
  status?: string
}

interface TenantGovernanceProfile {
  governanceStatus?: string
}

interface TenantIdentityContext {
  consoleUserRealm?: string
}

interface TenantQuotaLimit {
  metricKey: string
  scope: string
  limit: number
  used: number
  remaining: number
  unit?: string
}

interface TenantQuotaProfile {
  governanceStatus?: string
  limits?: TenantQuotaLimit[]
}

interface TenantInventoryWorkspaceSummary {
  workspaceId: string
  workspaceSlug: string
  environment?: string
  state?: string
  applicationCount: number
  serviceAccountCount: number
  managedResourceCount: number
}

interface TenantInventoryResponse {
  tenantId: string
  workspaceCount: number
  applicationCount: number
  managedResourceCount: number
  serviceAccountCount: number
  workspaces?: TenantInventoryWorkspaceSummary[]
}

interface Tenant {
  tenantId: string
  displayName: string
  slug: string
  state?: string
  governance?: TenantGovernanceProfile
  identityContext?: TenantIdentityContext
  provisioning?: ProvisioningSummary
  quotaProfile?: TenantQuotaProfile
  inventorySummary?: TenantInventoryResponse
}

interface Workspace {
  workspaceId: string
  tenantId: string
  displayName: string
  slug: string
  environment?: string
  state?: string
  provisioning?: ProvisioningSummary
}

export type ConsoleQuotaSeverity = 'nominal' | 'warning' | 'blocked'

export interface PersistedConsoleContextSnapshot {
  userId: string
  tenantId: string | null
  workspaceId: string | null
  updatedAt: string
}

export interface ConsoleQuotaSummaryItem {
  metricKey: string
  scope: string
  used: number
  limit: number
  remaining: number
  utilizationPercent: number
  severity: ConsoleQuotaSeverity
  unit: string | null
}

export interface ConsoleQuotaSummary {
  totals: Record<ConsoleQuotaSeverity, number>
  items: ConsoleQuotaSummaryItem[]
}

export interface ConsoleInventoryWorkspaceSummary {
  workspaceId: string
  workspaceSlug: string
  environment: string | null
  state: string | null
  applicationCount: number
  serviceAccountCount: number
  managedResourceCount: number
}

export interface ConsoleTenantInventorySummary {
  tenantId: string
  workspaceCount: number
  applicationCount: number
  managedResourceCount: number
  serviceAccountCount: number
  workspaces: ConsoleInventoryWorkspaceSummary[]
}

export interface ConsoleOperationalAlert {
  key: string
  level: 'warning' | 'destructive' | 'info'
  title: string
  description: string
}

export interface ConsoleTenantOption {
  tenantId: string
  label: string
  secondary: string
  state: string | null
  governanceStatus: string | null
  consoleUserRealm: string | null
  provisioningStatus: string | null
  quotaSummary: ConsoleQuotaSummary | null
  inventorySummary: ConsoleTenantInventorySummary | null
}

export interface ConsoleWorkspaceOption {
  workspaceId: string
  tenantId: string
  label: string
  secondary: string
  environment: string | null
  state: string | null
  provisioningStatus: string | null
}

export interface ConsoleContextValue {
  tenants: ConsoleTenantOption[]
  workspaces: ConsoleWorkspaceOption[]
  activeTenantId: string | null
  activeWorkspaceId: string | null
  activeTenant: ConsoleTenantOption | null
  activeWorkspace: ConsoleWorkspaceOption | null
  operationalAlerts: ConsoleOperationalAlert[]
  tenantsLoading: boolean
  workspacesLoading: boolean
  tenantsError: string | null
  workspacesError: string | null
  selectTenant: (tenantId: string | null) => void
  selectWorkspace: (workspaceId: string | null) => void
  reloadTenants: () => Promise<void>
  reloadWorkspaces: () => Promise<void>
  capabilities: Record<string, boolean>
  capabilitiesLoading: boolean
  refreshCapabilities: () => void
}

const ConsoleContext = createContext<ConsoleContextValue | null>(null)

const emptyConsoleContextValue: ConsoleContextValue = {
  tenants: [],
  workspaces: [],
  activeTenantId: null,
  activeWorkspaceId: null,
  activeTenant: null,
  activeWorkspace: null,
  operationalAlerts: [],
  tenantsLoading: false,
  workspacesLoading: false,
  tenantsError: null,
  workspacesError: null,
  selectTenant: () => undefined,
  selectWorkspace: () => undefined,
  reloadTenants: async () => undefined,
  reloadWorkspaces: async () => undefined,
  capabilities: {},
  capabilitiesLoading: false,
  refreshCapabilities: () => undefined
}

export function ConsoleContextProvider({
  children,
  session
}: {
  children: ReactNode
  session: ConsoleShellSession | null
}) {
  const userId = session?.principal?.userId?.trim() || null
  const tenantIds = useMemo(
    () => (Array.isArray(session?.principal?.tenantIds) ? session?.principal?.tenantIds.filter(Boolean) : []),
    [session?.principal?.tenantIds]
  )
  const workspaceIds = useMemo(
    () => (Array.isArray(session?.principal?.workspaceIds) ? session?.principal?.workspaceIds.filter(Boolean) : []),
    [session?.principal?.workspaceIds]
  )
  const [tenants, setTenants] = useState<ConsoleTenantOption[]>([])
  const [workspaces, setWorkspaces] = useState<ConsoleWorkspaceOption[]>([])
  const [activeTenantId, setActiveTenantId] = useState<string | null>(null)
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null)
  const [tenantsLoading, setTenantsLoading] = useState(false)
  const [workspacesLoading, setWorkspacesLoading] = useState(false)
  const [tenantsError, setTenantsError] = useState<string | null>(null)
  const [workspacesError, setWorkspacesError] = useState<string | null>(null)
  const [tenantReloadKey, setTenantReloadKey] = useState(0)
  const [workspaceReloadKey, setWorkspaceReloadKey] = useState(0)
  const [capabilities, setCapabilities] = useState<Record<string, boolean>>({})
  const [capabilitiesLoading, setCapabilitiesLoading] = useState(true)
  const [capabilityReloadKey, setCapabilityReloadKey] = useState(0)

  const refreshCapabilities = useCallback(() => {
    setCapabilityReloadKey((current) => current + 1)
  }, [])

  const persistSelection = useCallback(
    (tenantId: string | null, workspaceId: string | null) => {
      if (!userId) {
        clearPersistedConsoleContext()
        return
      }

      persistConsoleContextSelection(userId, tenantId, workspaceId)
    },
    [userId]
  )

  const selectTenant = useCallback(
    (tenantId: string | null) => {
      setActiveTenantId(tenantId)
      setActiveWorkspaceId(null)
      setWorkspaces([])
      setWorkspacesError(null)
      setWorkspaceReloadKey(0)
      setCapabilities({})
      setCapabilitiesLoading(true)
      setCapabilityReloadKey((current) => current + 1)
      persistSelection(tenantId, null)
    },
    [persistSelection]
  )

  const selectWorkspace = useCallback(
    (workspaceId: string | null) => {
      setActiveWorkspaceId(workspaceId)
      persistSelection(activeTenantId, workspaceId)
    },
    [activeTenantId, persistSelection]
  )

  const reloadTenants = useCallback(async () => {
    setTenantReloadKey((current) => current + 1)
  }, [])

  const reloadWorkspaces = useCallback(async () => {
    setWorkspaceReloadKey((current) => current + 1)
  }, [])

  useEffect(() => {
    if (!userId) {
      setTenants([])
      setWorkspaces([])
      setActiveTenantId(null)
      setActiveWorkspaceId(null)
      setTenantsLoading(false)
      setWorkspacesLoading(false)
      setTenantsError(null)
      setWorkspacesError(null)
      return
    }

    let cancelled = false
    const persistedSnapshot = readPersistedConsoleContext(userId)

    async function loadTenants() {
      setTenantsLoading(true)
      setTenantsError(null)

      try {
        const collection = await listAccessibleTenants()
        const options = filterTenantOptions(normalizeTenantOptions(collection.items), tenantIds)
        const nextTenantId = resolveInitialTenantId(options, persistedSnapshot?.tenantId ?? null)

        if (cancelled) {
          return
        }

        setTenants(options)
        setActiveTenantId(nextTenantId)
        setActiveWorkspaceId(null)
        setWorkspaces([])
        setWorkspacesError(null)

        if (!nextTenantId) {
          clearPersistedConsoleContext()
        } else if (nextTenantId !== persistedSnapshot?.tenantId || persistedSnapshot?.workspaceId) {
          persistSelection(nextTenantId, null)
        }
      } catch (error) {
        if (cancelled) {
          return
        }

        setTenants([])
        setActiveTenantId(null)
        setActiveWorkspaceId(null)
        setWorkspaces([])
        setTenantsError(getConsoleContextErrorMessage(error, 'No se pudieron cargar los tenants accesibles.'))
      } finally {
        if (!cancelled) {
          setTenantsLoading(false)
        }
      }
    }

    void loadTenants()

    return () => {
      cancelled = true
    }
  }, [persistSelection, tenantIds, tenantReloadKey, userId])

  useEffect(() => {
    if (!userId || !activeTenantId) {
      setWorkspaces([])
      setActiveWorkspaceId(null)
      setWorkspacesLoading(false)
      setWorkspacesError(null)
      return
    }

    let cancelled = false
    const currentTenantId = activeTenantId
    const persistedSnapshot = readPersistedConsoleContext(userId)
    const preferredWorkspaceId = persistedSnapshot?.tenantId === currentTenantId ? persistedSnapshot.workspaceId : null

    async function loadWorkspaces() {
      setWorkspacesLoading(true)
      setWorkspacesError(null)

      try {
        const collection = await listAccessibleWorkspaces(currentTenantId)
        const options = filterWorkspaceOptions(normalizeWorkspaceOptions(collection.items), workspaceIds)
        const nextWorkspaceId = resolveInitialWorkspaceId(options, preferredWorkspaceId)

        if (cancelled) {
          return
        }

        setWorkspaces(options)
        setActiveWorkspaceId(nextWorkspaceId)

        if (nextWorkspaceId || preferredWorkspaceId) {
          persistSelection(currentTenantId, nextWorkspaceId)
        }
      } catch (error) {
        if (cancelled) {
          return
        }

        setWorkspaces([])
        setActiveWorkspaceId(null)
        setWorkspacesError(getConsoleContextErrorMessage(error, 'No se pudieron cargar los workspaces del tenant seleccionado.'))
      } finally {
        if (!cancelled) {
          setWorkspacesLoading(false)
        }
      }
    }

    void loadWorkspaces()

    return () => {
      cancelled = true
    }
  }, [activeTenantId, persistSelection, userId, workspaceIds, workspaceReloadKey])

  useEffect(() => {
    if (!activeTenantId) {
      setCapabilities({})
      setCapabilitiesLoading(false)
      return
    }
    let cancelled = false
    setCapabilitiesLoading(true)

    async function loadCapabilities() {
      try {
        const result = await getEffectiveCapabilities()
        if (!cancelled) {
          setCapabilities(result.capabilities ?? {})
          setCapabilitiesLoading(false)
        }
      } catch {
        if (!cancelled) {
          setCapabilities({})
          setCapabilitiesLoading(false)
        }
      }
    }

    void loadCapabilities()

    return () => {
      cancelled = true
    }
  }, [activeTenantId, capabilityReloadKey])

  const activeTenant = useMemo(
    () => tenants.find((tenant) => tenant.tenantId === activeTenantId) ?? null,
    [activeTenantId, tenants]
  )
  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.workspaceId === activeWorkspaceId) ?? null,
    [activeWorkspaceId, workspaces]
  )
  const operationalAlerts = useMemo(
    () => getConsoleOperationalAlerts(activeTenant, activeWorkspace),
    [activeTenant, activeWorkspace]
  )

  const value = useMemo<ConsoleContextValue>(
    () => ({
      tenants,
      workspaces,
      activeTenantId,
      activeWorkspaceId,
      activeTenant,
      activeWorkspace,
      operationalAlerts,
      tenantsLoading,
      workspacesLoading,
      tenantsError,
      workspacesError,
      selectTenant,
      selectWorkspace,
      reloadTenants,
      reloadWorkspaces,
      capabilities,
      capabilitiesLoading,
      refreshCapabilities
    }),
    [
      activeTenant,
      activeTenantId,
      activeWorkspace,
      activeWorkspaceId,
      capabilities,
      capabilitiesLoading,
      operationalAlerts,
      refreshCapabilities,
      reloadTenants,
      reloadWorkspaces,
      selectTenant,
      selectWorkspace,
      tenants,
      tenantsError,
      tenantsLoading,
      workspaces,
      workspacesError,
      workspacesLoading
    ]
  )

  return <ConsoleContext.Provider value={value}>{children}</ConsoleContext.Provider>
}

export function useConsoleContext(): ConsoleContextValue {
  return useContext(ConsoleContext) ?? emptyConsoleContextValue
}

export function readPersistedConsoleContext(userId: string | null): PersistedConsoleContextSnapshot | null {
  if (!userId) {
    return null
  }

  const rawValue = readContextStorage()
  if (!rawValue) {
    return null
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<PersistedConsoleContextSnapshot>
    if (
      typeof parsed.userId !== 'string' ||
      typeof parsed.updatedAt !== 'string' ||
      (parsed.tenantId !== null && typeof parsed.tenantId !== 'string') ||
      (parsed.workspaceId !== null && typeof parsed.workspaceId !== 'string')
    ) {
      clearPersistedConsoleContext()
      return null
    }

    if (parsed.userId !== userId) {
      return null
    }

    return {
      userId: parsed.userId,
      tenantId: parsed.tenantId ?? null,
      workspaceId: parsed.workspaceId ?? null,
      updatedAt: parsed.updatedAt
    }
  } catch {
    clearPersistedConsoleContext()
    return null
  }
}

export function persistConsoleContextSelection(userId: string, tenantId: string | null, workspaceId: string | null): void {
  if (!userId) {
    clearPersistedConsoleContext()
    return
  }

  if (!tenantId && !workspaceId) {
    clearPersistedConsoleContext()
    return
  }

  writeContextStorage(
    JSON.stringify({
      userId,
      tenantId,
      workspaceId,
      updatedAt: new Date().toISOString()
    } satisfies PersistedConsoleContextSnapshot)
  )
}

export function clearPersistedConsoleContext(): void {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.removeItem(CONSOLE_ACTIVE_CONTEXT_STORAGE_KEY)
}

export function resolveInitialTenantId(options: ConsoleTenantOption[], preferredTenantId: string | null): string | null {
  if (preferredTenantId && options.some((option) => option.tenantId === preferredTenantId)) {
    return preferredTenantId
  }

  return options.length === 1 ? options[0].tenantId : null
}

export function resolveInitialWorkspaceId(options: ConsoleWorkspaceOption[], preferredWorkspaceId: string | null): string | null {
  if (preferredWorkspaceId && options.some((option) => option.workspaceId === preferredWorkspaceId)) {
    return preferredWorkspaceId
  }

  return options.length === 1 ? options[0].workspaceId : null
}

export function getConsoleTenantStatusMeta(tenant: ConsoleTenantOption | null): {
  tone: 'healthy' | 'warning' | 'restricted' | 'neutral'
  label: string
  description: string
} {
  if (!tenant) {
    return {
      tone: 'neutral',
      label: 'Sin tenant activo',
      description: 'Selecciona un tenant para conocer su estado operativo.'
    }
  }

  const quotaBlocked = tenant.quotaSummary?.totals.blocked ?? 0
  const quotaWarning = tenant.quotaSummary?.totals.warning ?? 0

  if (tenant.state === 'suspended' || tenant.state === 'deleted') {
    return {
      tone: 'restricted',
      label: formatConsoleEnumLabel(tenant.state),
      description: 'El tenant activo tiene operaciones restringidas.'
    }
  }

  if (tenant.governanceStatus && ['suspended', 'retention', 'purge_pending'].includes(tenant.governanceStatus)) {
    return {
      tone: 'restricted',
      label: formatConsoleEnumLabel(tenant.governanceStatus),
      description: 'La gobernanza del tenant requiere atención inmediata.'
    }
  }

  if (tenant.state === 'pending_activation') {
    return {
      tone: 'warning',
      label: 'Pending activation',
      description: 'El tenant todavía no está plenamente operativo.'
    }
  }

  if (quotaBlocked > 0) {
    return {
      tone: 'restricted',
      label: 'Cuotas bloqueadas',
      description: `Hay ${quotaBlocked} cuota${quotaBlocked === 1 ? '' : 's'} agotada${quotaBlocked === 1 ? '' : 's'} en el tenant activo.`
    }
  }

  if (tenant.governanceStatus === 'warning' || quotaWarning > 0 || isProvisioningDegraded(tenant.provisioningStatus)) {
    return {
      tone: 'warning',
      label: tenant.governanceStatus === 'warning' ? 'Warning' : 'Con atención',
      description: 'El tenant está operativo, pero presenta señales que conviene revisar.'
    }
  }

  return {
    tone: 'healthy',
    label: 'Operativo',
    description: 'Tenant activo y sin restricciones visibles en la consola.'
  }
}

export function getConsoleWorkspaceStatusMeta(workspace: ConsoleWorkspaceOption | null): {
  tone: 'healthy' | 'warning' | 'restricted' | 'neutral'
  label: string
  description: string
} {
  if (!workspace) {
    return {
      tone: 'neutral',
      label: 'Sin workspace activo',
      description: 'Selecciona un workspace para completar el contexto operativo.'
    }
  }

  if (workspace.state && ['suspended', 'soft_deleted', 'deleted'].includes(workspace.state)) {
    return {
      tone: 'restricted',
      label: formatConsoleEnumLabel(workspace.state),
      description: 'El workspace activo tiene operaciones restringidas.'
    }
  }

  if (workspace.provisioningStatus === 'partially_failed') {
    return {
      tone: 'warning',
      label: 'Provisioning parcial',
      description: 'Algunos recursos del workspace podrían no estar disponibles.'
    }
  }

  if (
    (workspace.state && ['draft', 'provisioning', 'pending_activation'].includes(workspace.state)) ||
    isProvisioningPending(workspace.provisioningStatus)
  ) {
    return {
      tone: 'warning',
      label: 'Provisionando',
      description: 'El workspace todavía no está listo para operar con normalidad.'
    }
  }

  return {
    tone: 'healthy',
    label: 'Operativo',
    description: 'Workspace listo para operar dentro del contexto activo.'
  }
}

export function getConsoleOperationalAlerts(
  tenant: ConsoleTenantOption | null,
  workspace: ConsoleWorkspaceOption | null
): ConsoleOperationalAlert[] {
  const alerts: ConsoleOperationalAlert[] = []

  if (tenant?.state && tenant.state !== 'active') {
    alerts.push({
      key: `tenant-state-${tenant.state}`,
      level: tenant.state === 'pending_activation' ? 'warning' : 'destructive',
      title: `Tenant ${formatConsoleEnumLabel(tenant.state)}`,
      description: 'El tenant activo no está completamente operativo y algunas acciones de la consola pueden fallar o quedar limitadas.'
    })
  }

  if (tenant?.governanceStatus && tenant.governanceStatus !== 'nominal') {
    alerts.push({
      key: `tenant-governance-${tenant.governanceStatus}`,
      level: tenant.governanceStatus === 'warning' ? 'warning' : 'destructive',
      title: `Gobernanza del tenant: ${formatConsoleEnumLabel(tenant.governanceStatus)}`,
      description: 'La gobernanza del tenant activo requiere atención antes de continuar con cambios operativos.'
    })
  }

  if ((tenant?.quotaSummary?.totals.blocked ?? 0) > 0) {
    const blockedItems = tenant?.quotaSummary?.items.filter((item) => item.severity === 'blocked') ?? []
    const blockedLabel = blockedItems.slice(0, 2).map((item) => item.metricKey).join(', ')

    alerts.push({
      key: 'tenant-quota-blocked',
      level: 'destructive',
      title: 'Cuotas agotadas en el tenant activo',
      description: blockedLabel
        ? `Hay cuotas bloqueadas (${blockedLabel}${blockedItems.length > 2 ? ', …' : ''}) y algunas operaciones podrían ser rechazadas.`
        : 'Al menos una cuota del tenant activo está agotada y puede bloquear operaciones.'
    })
  }

  if (workspace?.state && workspace.state !== 'active') {
    alerts.push({
      key: `workspace-state-${workspace.state}`,
      level: ['suspended', 'soft_deleted', 'deleted'].includes(workspace.state) ? 'destructive' : 'warning',
      title: `Workspace ${formatConsoleEnumLabel(workspace.state)}`,
      description: 'El workspace activo no está plenamente disponible para operar desde la consola.'
    })
  }

  if (workspace?.provisioningStatus === 'partially_failed') {
    alerts.push({
      key: 'workspace-provisioning-partially-failed',
      level: 'warning',
      title: 'Provisioning del workspace incompleto',
      description: 'El aprovisionamiento del workspace quedó parcialmente fallido y algunos recursos pueden no estar disponibles.'
    })
  } else if (workspace?.provisioningStatus && isProvisioningPending(workspace.provisioningStatus)) {
    alerts.push({
      key: `workspace-provisioning-${workspace.provisioningStatus}`,
      level: 'warning',
      title: 'Provisioning del workspace en curso',
      description: 'El workspace activo todavía está terminando de aprovisionarse y puede responder de forma parcial.'
    })
  }

  return alerts
}

export function formatConsoleEnumLabel(value: string | null | undefined): string {
  if (!value) {
    return 'No disponible'
  }

  const normalized = value.replace(/_/g, ' ')
  return normalized.charAt(0).toUpperCase() + normalized.slice(1)
}

async function listAccessibleTenants(): Promise<TenantCollectionResponse> {
  const searchParams = new URLSearchParams({ 'page[size]': '100', sort: 'displayName' })
  return requestConsoleSessionJson<TenantCollectionResponse>(`/v1/tenants?${searchParams.toString()}`)
}

async function listAccessibleWorkspaces(tenantId: string): Promise<WorkspaceCollectionResponse> {
  const searchParams = new URLSearchParams({ 'page[size]': '100', sort: 'displayName' })
  searchParams.set('filter[tenantId]', tenantId)

  return requestConsoleSessionJson<WorkspaceCollectionResponse>(`/v1/workspaces?${searchParams.toString()}`)
}

function normalizeTenantOptions(items: Tenant[]): ConsoleTenantOption[] {
  return items.map((tenant) => ({
    tenantId: tenant.tenantId,
    label: tenant.displayName,
    secondary: tenant.slug,
    state: tenant.state ?? null,
    governanceStatus: tenant.governance?.governanceStatus ?? tenant.quotaProfile?.governanceStatus ?? null,
    consoleUserRealm: tenant.identityContext?.consoleUserRealm ?? null,
    provisioningStatus: tenant.provisioning?.status ?? null,
    quotaSummary: summarizeTenantQuotaProfile(tenant.quotaProfile),
    inventorySummary: normalizeTenantInventorySummary(tenant.inventorySummary)
  }))
}

function normalizeWorkspaceOptions(items: Workspace[]): ConsoleWorkspaceOption[] {
  return items.map((workspace) => ({
    workspaceId: workspace.workspaceId,
    tenantId: workspace.tenantId,
    label: workspace.displayName,
    secondary: workspace.environment ? `${workspace.slug} · ${workspace.environment}` : workspace.slug,
    environment: workspace.environment ?? null,
    state: workspace.state ?? null,
    provisioningStatus: workspace.provisioning?.status ?? null
  }))
}

function summarizeTenantQuotaProfile(profile?: TenantQuotaProfile | null): ConsoleQuotaSummary | null {
  if (!profile) {
    return null
  }

  const items = Array.isArray(profile.limits)
    ? profile.limits.map((limit) => {
        const utilizationPercent = deriveUtilizationPercent(limit.limit, limit.used)
        const severity = deriveQuotaSeverity(limit.limit, limit.used, limit.remaining, utilizationPercent)

        return {
          metricKey: limit.metricKey,
          scope: limit.scope,
          used: limit.used,
          limit: limit.limit,
          remaining: limit.remaining,
          utilizationPercent,
          severity,
          unit: limit.unit?.trim() || null
        } satisfies ConsoleQuotaSummaryItem
      })
    : []

  const totals: Record<ConsoleQuotaSeverity, number> = {
    nominal: items.filter((item) => item.severity === 'nominal').length,
    warning: items.filter((item) => item.severity === 'warning').length,
    blocked: items.filter((item) => item.severity === 'blocked').length
  }

  return {
    totals,
    items: items.sort((left, right) => quotaSeverityRank(right.severity) - quotaSeverityRank(left.severity))
  }
}

function normalizeTenantInventorySummary(summary?: TenantInventoryResponse | null): ConsoleTenantInventorySummary | null {
  if (!summary) {
    return null
  }

  return {
    tenantId: summary.tenantId,
    workspaceCount: summary.workspaceCount,
    applicationCount: summary.applicationCount,
    managedResourceCount: summary.managedResourceCount,
    serviceAccountCount: summary.serviceAccountCount,
    workspaces: Array.isArray(summary.workspaces)
      ? summary.workspaces.map((workspace) => ({
          workspaceId: workspace.workspaceId,
          workspaceSlug: workspace.workspaceSlug,
          environment: workspace.environment ?? null,
          state: workspace.state ?? null,
          applicationCount: workspace.applicationCount,
          serviceAccountCount: workspace.serviceAccountCount,
          managedResourceCount: workspace.managedResourceCount
        }))
      : []
  }
}

function filterTenantOptions(options: ConsoleTenantOption[], allowedTenantIds: string[]): ConsoleTenantOption[] {
  if (allowedTenantIds.length === 0) {
    return options
  }

  const allowedSet = new Set(allowedTenantIds)
  return options.filter((option) => allowedSet.has(option.tenantId))
}

function filterWorkspaceOptions(options: ConsoleWorkspaceOption[], allowedWorkspaceIds: string[]): ConsoleWorkspaceOption[] {
  if (allowedWorkspaceIds.length === 0) {
    return options
  }

  const allowedSet = new Set(allowedWorkspaceIds)
  return options.filter((option) => allowedSet.has(option.workspaceId))
}

function deriveUtilizationPercent(limit: number, used: number): number {
  if (limit <= 0) {
    return used > 0 ? 100 : 0
  }

  return Math.round((used / limit) * 1000) / 10
}

function deriveQuotaSeverity(
  limit: number,
  used: number,
  remaining: number,
  utilizationPercent: number
): ConsoleQuotaSeverity {
  if (remaining <= 0 || (limit > 0 && used >= limit)) {
    return 'blocked'
  }

  if (utilizationPercent >= 80) {
    return 'warning'
  }

  return 'nominal'
}

function quotaSeverityRank(value: ConsoleQuotaSeverity): number {
  if (value === 'blocked') {
    return 3
  }

  if (value === 'warning') {
    return 2
  }

  return 1
}

function isProvisioningPending(status: string | null | undefined): boolean {
  return status === 'pending' || status === 'in_progress'
}

function isProvisioningDegraded(status: string | null | undefined): boolean {
  return isProvisioningPending(status) || status === 'partially_failed'
}

function getConsoleContextErrorMessage(rawError: unknown, fallback: string): string {
  const message = typeof rawError === 'object' && rawError !== null && 'message' in rawError ? (rawError.message as string | undefined) : undefined
  return message?.trim() || fallback
}

function readContextStorage(): string | null {
  if (typeof window === 'undefined') {
    return null
  }

  return window.localStorage.getItem(CONSOLE_ACTIVE_CONTEXT_STORAGE_KEY)
}

function writeContextStorage(value: string): void {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(CONSOLE_ACTIVE_CONTEXT_STORAGE_KEY, value)
}
