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

interface Tenant {
  tenantId: string
  displayName: string
  slug: string
  state?: string
}

interface Workspace {
  workspaceId: string
  tenantId: string
  displayName: string
  slug: string
  environment?: string
  state?: string
}

export interface PersistedConsoleContextSnapshot {
  userId: string
  tenantId: string | null
  workspaceId: string | null
  updatedAt: string
}

export interface ConsoleTenantOption {
  tenantId: string
  label: string
  secondary: string
  state: string | null
}

export interface ConsoleWorkspaceOption {
  workspaceId: string
  tenantId: string
  label: string
  secondary: string
  environment: string | null
  state: string | null
}

export interface ConsoleContextValue {
  tenants: ConsoleTenantOption[]
  workspaces: ConsoleWorkspaceOption[]
  activeTenantId: string | null
  activeWorkspaceId: string | null
  activeTenant: ConsoleTenantOption | null
  activeWorkspace: ConsoleWorkspaceOption | null
  tenantsLoading: boolean
  workspacesLoading: boolean
  tenantsError: string | null
  workspacesError: string | null
  selectTenant: (tenantId: string | null) => void
  selectWorkspace: (workspaceId: string | null) => void
  reloadTenants: () => Promise<void>
  reloadWorkspaces: () => Promise<void>
}

const ConsoleContext = createContext<ConsoleContextValue | null>(null)

const emptyConsoleContextValue: ConsoleContextValue = {
  tenants: [],
  workspaces: [],
  activeTenantId: null,
  activeWorkspaceId: null,
  activeTenant: null,
  activeWorkspace: null,
  tenantsLoading: false,
  workspacesLoading: false,
  tenantsError: null,
  workspacesError: null,
  selectTenant: () => undefined,
  selectWorkspace: () => undefined,
  reloadTenants: async () => undefined,
  reloadWorkspaces: async () => undefined
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

  const activeTenant = useMemo(
    () => tenants.find((tenant) => tenant.tenantId === activeTenantId) ?? null,
    [activeTenantId, tenants]
  )
  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.workspaceId === activeWorkspaceId) ?? null,
    [activeWorkspaceId, workspaces]
  )

  const value = useMemo<ConsoleContextValue>(
    () => ({
      tenants,
      workspaces,
      activeTenantId,
      activeWorkspaceId,
      activeTenant,
      activeWorkspace,
      tenantsLoading,
      workspacesLoading,
      tenantsError,
      workspacesError,
      selectTenant,
      selectWorkspace,
      reloadTenants,
      reloadWorkspaces
    }),
    [
      activeTenant,
      activeTenantId,
      activeWorkspace,
      activeWorkspaceId,
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
    state: tenant.state ?? null
  }))
}

function normalizeWorkspaceOptions(items: Workspace[]): ConsoleWorkspaceOption[] {
  return items.map((workspace) => ({
    workspaceId: workspace.workspaceId,
    tenantId: workspace.tenantId,
    label: workspace.displayName,
    secondary: workspace.environment ? `${workspace.slug} · ${workspace.environment}` : workspace.slug,
    environment: workspace.environment ?? null,
    state: workspace.state ?? null
  }))
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
