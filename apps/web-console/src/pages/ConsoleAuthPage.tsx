import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatConsoleEnumLabel, useConsoleContext } from '@/lib/console-context'
import { requestConsoleSessionJson } from '@/lib/console-session'

type IamProviderCompatibility = {
  provider: string
  contractVersion: string
  supportedVersions: string[]
  adminApiStability: string
}

type IamCollectionResponse<T> = {
  compatibility?: IamProviderCompatibility
  items?: T[]
}

type IamScope = {
  scopeName: string
  protocol: 'openid-connect' | 'saml'
  isDefault: boolean
  isOptional: boolean
  includeInTokenScope: boolean
  assignedClientIds?: string[]
}

type IamClient = {
  clientId: string
  protocol: 'openid-connect' | 'saml'
  accessType: 'public' | 'confidential' | 'bearer_only'
  enabled: boolean
  state: string
  redirectUris?: string[]
  defaultScopes?: string[]
  optionalScopes?: string[]
}

type ExternalApplicationScope = {
  scopeName: string
}

type FederatedIdentityProvider = {
  providerId: string
  alias: string
  displayName: string
  protocol: 'oidc' | 'saml'
  providerMode: 'metadata_url' | 'inline_metadata' | 'manual_endpoints'
  enabled?: boolean
}

type ExternalApplicationValidationSummary = {
  status: 'valid' | 'warning' | 'invalid' | 'pending'
  checks?: Array<{
    code: string
    severity: 'info' | 'warning' | 'error'
    message: string
  }>
}

type ExternalApplication = {
  applicationId: string
  displayName: string
  slug: string
  protocol: 'oidc' | 'saml' | 'api_key'
  state: string
  authenticationFlows?: string[]
  redirectUris?: string[]
  scopes?: ExternalApplicationScope[]
  federatedProviders?: FederatedIdentityProvider[]
  validation?: ExternalApplicationValidationSummary
}

type ExternalApplicationCollectionResponse = {
  items?: ExternalApplication[]
}

type RealmSurfaceState = {
  loading: boolean
  error: string | null
  usersCount: number
  rolesCount: number
  scopes: IamScope[]
  clients: IamClient[]
  compatibility: IamProviderCompatibility | null
}

type ApplicationsState = {
  loading: boolean
  error: string | null
  applications: ExternalApplication[]
}

type ProviderRow = {
  applicationLabel: string
  providerId: string
  alias: string
  displayName: string
  protocol: 'oidc' | 'saml'
  providerMode: 'metadata_url' | 'inline_metadata' | 'manual_endpoints'
  enabled: boolean
}

const EMPTY_REALM_STATE: RealmSurfaceState = {
  loading: false,
  error: null,
  usersCount: 0,
  rolesCount: 0,
  scopes: [],
  clients: [],
  compatibility: null
}

const EMPTY_APPLICATIONS_STATE: ApplicationsState = {
  loading: false,
  error: null,
  applications: []
}

export function ConsoleAuthPage() {
  const { activeTenant, activeWorkspace } = useConsoleContext()
  const [realmState, setRealmState] = useState<RealmSurfaceState>(EMPTY_REALM_STATE)
  const [applicationsState, setApplicationsState] = useState<ApplicationsState>(EMPTY_APPLICATIONS_STATE)
  const [realmReloadToken, setRealmReloadToken] = useState(0)
  const [applicationsReloadToken, setApplicationsReloadToken] = useState(0)

  const realmId = activeTenant?.consoleUserRealm ?? null
  const workspaceId = activeWorkspace?.workspaceId ?? null

  useEffect(() => {
    if (!activeTenant) {
      setRealmState(EMPTY_REALM_STATE)
      return
    }

    if (!realmId) {
      setRealmState(EMPTY_REALM_STATE)
      return
    }

    let ignore = false
    setRealmState((current) => ({ ...current, loading: true, error: null, scopes: [], clients: [] }))

    Promise.all([
      requestConsoleSessionJson<IamCollectionResponse<unknown>>(`/v1/iam/realms/${realmId}/users?page[size]=100`),
      requestConsoleSessionJson<IamCollectionResponse<unknown>>(`/v1/iam/realms/${realmId}/roles?page[size]=100`),
      requestConsoleSessionJson<IamCollectionResponse<IamScope>>(`/v1/iam/realms/${realmId}/scopes?page[size]=100`),
      requestConsoleSessionJson<IamCollectionResponse<IamClient>>(`/v1/iam/realms/${realmId}/clients?page[size]=100`)
    ])
      .then(([usersResponse, rolesResponse, scopesResponse, clientsResponse]) => {
        if (ignore) {
          return
        }

        setRealmState({
          loading: false,
          error: null,
          usersCount: usersResponse.items?.length ?? 0,
          rolesCount: rolesResponse.items?.length ?? 0,
          scopes: scopesResponse.items ?? [],
          clients: clientsResponse.items ?? [],
          compatibility:
            usersResponse.compatibility ??
            rolesResponse.compatibility ??
            scopesResponse.compatibility ??
            clientsResponse.compatibility ??
            null
        })
      })
      .catch((error: unknown) => {
        if (ignore) {
          return
        }

        setRealmState({
          ...EMPTY_REALM_STATE,
          loading: false,
          error: getErrorMessage(error, 'No se pudo cargar el inventario Auth/IAM del realm.')
        })
      })

    return () => {
      ignore = true
    }
  }, [activeTenant, realmId, realmReloadToken])

  useEffect(() => {
    if (!workspaceId) {
      setApplicationsState(EMPTY_APPLICATIONS_STATE)
      return
    }

    let ignore = false
    setApplicationsState((current) => ({ ...current, loading: true, error: null, applications: [] }))

    requestConsoleSessionJson<ExternalApplicationCollectionResponse>(`/v1/workspaces/${workspaceId}/applications?limit=100`)
      .then((response) => {
        if (ignore) {
          return
        }

        setApplicationsState({
          loading: false,
          error: null,
          applications: response.items ?? []
        })
      })
      .catch((error: unknown) => {
        if (ignore) {
          return
        }

        setApplicationsState({
          ...EMPTY_APPLICATIONS_STATE,
          loading: false,
          error: getErrorMessage(error, 'No se pudieron cargar las aplicaciones externas del workspace.')
        })
      })

    return () => {
      ignore = true
    }
  }, [workspaceId, applicationsReloadToken])

  const providerRows = useMemo<ProviderRow[]>(() => {
    return applicationsState.applications.flatMap((application) =>
      (application.federatedProviders ?? []).map((provider) => ({
        applicationLabel: application.displayName || application.slug,
        providerId: provider.providerId,
        alias: provider.alias,
        displayName: provider.displayName,
        protocol: provider.protocol,
        providerMode: provider.providerMode,
        enabled: provider.enabled ?? true
      }))
    )
  }, [applicationsState.applications])

  if (!activeTenant) {
    return (
      <section className="space-y-4" aria-labelledby="console-auth-title">
        <div className="space-y-2">
          <Badge variant="secondary">Auth / IAM</Badge>
          <h1 id="console-auth-title" className="text-3xl font-semibold tracking-tight text-foreground">
            Gestión Auth/IAM
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Selecciona un tenant para inspeccionar Auth/IAM.
          </p>
        </div>
      </section>
    )
  }

  if (!realmId) {
    return (
      <section className="space-y-4" aria-labelledby="console-auth-title">
        <div className="space-y-2">
          <Badge variant="secondary">Auth / IAM</Badge>
          <h1 id="console-auth-title" className="text-3xl font-semibold tracking-tight text-foreground">
            Gestión Auth/IAM
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Este tenant no tiene un realm IAM de consola configurado.
          </p>
        </div>
      </section>
    )
  }

  return (
    <section className="space-y-6" aria-labelledby="console-auth-title">
      <header className="rounded-3xl border border-border/60 bg-card p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-3">
            <Badge variant="secondary">Auth / IAM</Badge>
            <div className="space-y-2">
              <h1 id="console-auth-title" className="text-3xl font-semibold tracking-tight text-foreground">
                Gestión Auth/IAM
              </h1>
              <p className="max-w-3xl text-sm text-muted-foreground">
                Superficie read-only del realm de consola y de las aplicaciones externas del workspace activo.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">Tenant: {activeTenant.label}</Badge>
              <Badge variant="outline">Realm: {realmId}</Badge>
              <Badge variant="outline">
                Workspace: {activeWorkspace?.label ?? 'No seleccionado'}
              </Badge>
            </div>
          </div>
          <Link
            to="/console/members"
            className="inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground transition hover:bg-accent hover:text-accent-foreground"
          >
            Abrir Members
          </Link>
        </div>
      </header>

      <section className="space-y-4" aria-labelledby="auth-realm-heading">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 id="auth-realm-heading" className="text-xl font-semibold text-foreground">
              Resumen del realm
            </h2>
            <p className="text-sm text-muted-foreground">
              Users y roles se resumen aquí y mantienen su detalle operativo en la vista Members.
            </p>
          </div>
          {realmState.compatibility ? (
            <Badge variant="outline">
              {realmState.compatibility.provider} · {realmState.compatibility.contractVersion}
            </Badge>
          ) : null}
        </div>

        {realmState.loading ? (
          <div className="rounded-2xl border border-dashed border-border/70 bg-card p-6 text-sm text-muted-foreground">
            Cargando inventario del realm…
          </div>
        ) : null}

        {realmState.error ? (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4" role="alert">
            <div className="space-y-3">
              <p className="text-sm text-foreground">{realmState.error}</p>
              <Button type="button" variant="outline" onClick={() => setRealmReloadToken((value) => value + 1)}>
                Reintentar
              </Button>
            </div>
          </div>
        ) : null}

        {!realmState.loading && !realmState.error ? (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <SummaryCard label="Users" value={realmState.usersCount} testId="auth-summary-users" />
              <SummaryCard label="Roles" value={realmState.rolesCount} testId="auth-summary-roles" />
              <SummaryCard label="Scopes" value={realmState.scopes.length} testId="auth-summary-scopes" />
              <SummaryCard label="Clients" value={realmState.clients.length} testId="auth-summary-clients" />
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
              <div className="rounded-3xl border border-border/60 bg-card p-5 shadow-sm">
                <div className="mb-4 space-y-1">
                  <h3 className="text-lg font-semibold text-foreground">Client scopes</h3>
                  <p className="text-sm text-muted-foreground">
                    Scopes gestionados del realm activo con sus flags operativas.
                  </p>
                </div>
                {realmState.scopes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No hay scopes gestionados para este realm.</p>
                ) : (
                  <TableContainer>
                    <table className="min-w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-border/60 text-muted-foreground">
                          <th scope="col" className="px-3 py-2 font-medium">Scope</th>
                          <th scope="col" className="px-3 py-2 font-medium">Protocol</th>
                          <th scope="col" className="px-3 py-2 font-medium">Flags</th>
                          <th scope="col" className="px-3 py-2 font-medium">Clients</th>
                        </tr>
                      </thead>
                      <tbody>
                        {realmState.scopes.map((scope) => (
                          <tr key={scope.scopeName} className="border-b border-border/40 align-top last:border-b-0">
                            <td className="px-3 py-3">
                              <div className="font-medium text-foreground">{scope.scopeName}</div>
                            </td>
                            <td className="px-3 py-3">
                              <Badge variant="outline">{formatConsoleEnumLabel(scope.protocol)}</Badge>
                            </td>
                            <td className="px-3 py-3">
                              <div className="flex flex-wrap gap-2">
                                <BooleanBadge label="Default" value={scope.isDefault} />
                                <BooleanBadge label="Optional" value={scope.isOptional} />
                                <BooleanBadge label="Token" value={scope.includeInTokenScope} />
                              </div>
                            </td>
                            <td className="px-3 py-3 text-muted-foreground">{formatList(scope.assignedClientIds)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableContainer>
                )}
              </div>

              <div className="rounded-3xl border border-border/60 bg-card p-5 shadow-sm">
                <div className="mb-4 space-y-1">
                  <h3 className="text-lg font-semibold text-foreground">IAM clients</h3>
                  <p className="text-sm text-muted-foreground">
                    Clients gestionados del realm con access type, estado y scopes asociados.
                  </p>
                </div>
                {realmState.clients.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No hay clients gestionados para este realm.</p>
                ) : (
                  <TableContainer>
                    <table className="min-w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-border/60 text-muted-foreground">
                          <th scope="col" className="px-3 py-2 font-medium">Client</th>
                          <th scope="col" className="px-3 py-2 font-medium">Protocol</th>
                          <th scope="col" className="px-3 py-2 font-medium">Access</th>
                          <th scope="col" className="px-3 py-2 font-medium">Estado</th>
                          <th scope="col" className="px-3 py-2 font-medium">Redirects</th>
                          <th scope="col" className="px-3 py-2 font-medium">Scopes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {realmState.clients.map((client) => (
                          <tr key={client.clientId} className="border-b border-border/40 align-top last:border-b-0">
                            <td className="px-3 py-3">
                              <div className="font-medium text-foreground">{client.clientId}</div>
                            </td>
                            <td className="px-3 py-3">
                              <Badge variant="outline">{formatConsoleEnumLabel(client.protocol)}</Badge>
                            </td>
                            <td className="px-3 py-3 text-muted-foreground">{formatConsoleEnumLabel(client.accessType)}</td>
                            <td className="px-3 py-3">
                              <div className="flex flex-wrap gap-2">
                                <BooleanBadge label="Enabled" value={client.enabled} />
                                <Badge variant="outline">{formatConsoleEnumLabel(client.state)}</Badge>
                              </div>
                            </td>
                            <td className="px-3 py-3 text-muted-foreground">{formatList(client.redirectUris)}</td>
                            <td className="px-3 py-3 text-muted-foreground">
                              <div>
                                <span className="font-medium text-foreground">Default:</span> {formatList(client.defaultScopes)}
                              </div>
                              <div>
                                <span className="font-medium text-foreground">Optional:</span> {formatList(client.optionalScopes)}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableContainer>
                )}
              </div>
            </div>
          </>
        ) : null}
      </section>

      <section className="space-y-4" aria-labelledby="auth-applications-heading">
        <div>
          <h2 id="auth-applications-heading" className="text-xl font-semibold text-foreground">
            Aplicaciones externas y providers
          </h2>
          <p className="text-sm text-muted-foreground">
            Inventario read-only del workspace activo con sus aplicaciones y federación OIDC/SAML.
          </p>
        </div>

        {!workspaceId ? (
          <div className="rounded-2xl border border-dashed border-border/70 bg-card p-6 text-sm text-muted-foreground">
            Selecciona un workspace para ver aplicaciones externas y providers.
          </div>
        ) : null}

        {workspaceId && applicationsState.loading ? (
          <div className="rounded-2xl border border-dashed border-border/70 bg-card p-6 text-sm text-muted-foreground">
            Cargando aplicaciones externas del workspace…
          </div>
        ) : null}

        {workspaceId && applicationsState.error ? (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4" role="alert">
            <div className="space-y-3">
              <p className="text-sm text-foreground">{applicationsState.error}</p>
              <Button type="button" variant="outline" onClick={() => setApplicationsReloadToken((value) => value + 1)}>
                Reintentar
              </Button>
            </div>
          </div>
        ) : null}

        {workspaceId && !applicationsState.loading && !applicationsState.error ? (
          <div className="grid gap-6 xl:grid-cols-2">
            <div className="rounded-3xl border border-border/60 bg-card p-5 shadow-sm">
              <div className="mb-4 space-y-1">
                <h3 className="text-lg font-semibold text-foreground">Aplicaciones externas</h3>
                <p className="text-sm text-muted-foreground">
                  Estado, protocolo, flows y validaciones del inventario de aplicaciones del workspace activo.
                </p>
              </div>
              {applicationsState.applications.length === 0 ? (
                <p className="text-sm text-muted-foreground">No hay aplicaciones externas vinculadas a este workspace.</p>
              ) : (
                <TableContainer>
                  <table className="min-w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-border/60 text-muted-foreground">
                        <th scope="col" className="px-3 py-2 font-medium">Aplicación</th>
                        <th scope="col" className="px-3 py-2 font-medium">Protocol</th>
                        <th scope="col" className="px-3 py-2 font-medium">Estado</th>
                        <th scope="col" className="px-3 py-2 font-medium">Flows</th>
                        <th scope="col" className="px-3 py-2 font-medium">Redirects</th>
                        <th scope="col" className="px-3 py-2 font-medium">Scopes</th>
                        <th scope="col" className="px-3 py-2 font-medium">Validación</th>
                      </tr>
                    </thead>
                    <tbody>
                      {applicationsState.applications.map((application) => (
                        <tr key={application.applicationId} className="border-b border-border/40 align-top last:border-b-0">
                          <td className="px-3 py-3">
                            <div className="font-medium text-foreground">{application.displayName}</div>
                            <div className="text-xs text-muted-foreground">{application.slug}</div>
                          </td>
                          <td className="px-3 py-3">
                            <Badge variant="outline">{formatConsoleEnumLabel(application.protocol)}</Badge>
                          </td>
                          <td className="px-3 py-3">
                            <Badge variant="outline">{formatConsoleEnumLabel(application.state)}</Badge>
                          </td>
                          <td className="px-3 py-3 text-muted-foreground">{formatList(application.authenticationFlows)}</td>
                          <td className="px-3 py-3 text-muted-foreground">{formatList(application.redirectUris)}</td>
                          <td className="px-3 py-3 text-muted-foreground">
                            {formatList((application.scopes ?? []).map((scope) => scope.scopeName))}
                          </td>
                          <td className="px-3 py-3">
                            <ValidationBadge validation={application.validation} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableContainer>
              )}
            </div>

            <div className="rounded-3xl border border-border/60 bg-card p-5 shadow-sm">
              <div className="mb-4 space-y-1">
                <h3 className="text-lg font-semibold text-foreground">Providers federados</h3>
                <p className="text-sm text-muted-foreground">
                  Providers OIDC/SAML derivados de las aplicaciones externas del workspace activo.
                </p>
              </div>
              {providerRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No hay providers federados asociados a las aplicaciones del workspace.</p>
              ) : (
                <TableContainer>
                  <table className="min-w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-border/60 text-muted-foreground">
                        <th scope="col" className="px-3 py-2 font-medium">Aplicación</th>
                        <th scope="col" className="px-3 py-2 font-medium">Alias</th>
                        <th scope="col" className="px-3 py-2 font-medium">Protocol</th>
                        <th scope="col" className="px-3 py-2 font-medium">Modo</th>
                        <th scope="col" className="px-3 py-2 font-medium">Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {providerRows.map((provider) => (
                        <tr key={`${provider.applicationLabel}-${provider.providerId}`} className="border-b border-border/40 align-top last:border-b-0">
                          <td className="px-3 py-3 text-foreground">{provider.applicationLabel}</td>
                          <td className="px-3 py-3">
                            <div className="font-medium text-foreground">{provider.alias}</div>
                            <div className="text-xs text-muted-foreground">{provider.displayName}</div>
                          </td>
                          <td className="px-3 py-3">
                            <Badge variant="outline">{formatConsoleEnumLabel(provider.protocol)}</Badge>
                          </td>
                          <td className="px-3 py-3 text-muted-foreground">{formatConsoleEnumLabel(provider.providerMode)}</td>
                          <td className="px-3 py-3">
                            <BooleanBadge label="Enabled" value={provider.enabled} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableContainer>
              )}
            </div>
          </div>
        ) : null}
      </section>
    </section>
  )
}

function SummaryCard({ label, value, testId }: { label: string; value: number; testId: string }) {
  return (
    <article className="rounded-3xl border border-border/60 bg-card p-5 shadow-sm" data-testid={testId}>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-foreground">{value}</p>
    </article>
  )
}

function BooleanBadge({ label, value }: { label: string; value: boolean }) {
  return <Badge variant={value ? 'default' : 'secondary'}>{label}: {value ? 'Sí' : 'No'}</Badge>
}

function ValidationBadge({ validation }: { validation?: ExternalApplicationValidationSummary }) {
  if (!validation) {
    return <Badge variant="secondary">Sin validación</Badge>
  }

  return <Badge variant="outline">{formatConsoleEnumLabel(validation.status)}</Badge>
}

function TableContainer({ children }: { children: React.ReactNode }) {
  return <div className="overflow-x-auto">{children}</div>
}

function formatList(values?: string[]): string {
  return values && values.length > 0 ? values.join(', ') : '—'
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message
  }

  return fallback
}
