import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { CreateIamClientWizard } from '@/components/console/wizards/CreateIamClientWizard'
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

type ExternalApplicationAuthenticationFlow =
  | 'oidc_authorization_code_pkce'
  | 'oidc_authorization_code_client_secret'
  | 'oidc_client_credentials'
  | 'saml_sp_initiated'
  | 'saml_idp_initiated'

type ExternalApplicationScope = {
  scopeName: string
  consentRequired?: boolean
  description?: string
}

type ExternalApplicationLoginPolicy = {
  allowIdpInitiated?: boolean
  defaultProviderAlias?: string
  defaultRedirectUri?: string
  initiateLoginUri?: string
  redirectUris?: string[]
}

type ExternalApplicationLogoutPolicy = {
  backChannelLogoutUri?: string
  frontChannelLogoutUri?: string
  postLogoutRedirectUris?: string[]
  signedRequestsRequired?: boolean
}

type FederatedIdentityProvider = {
  providerId: string
  alias: string
  displayName: string
  protocol: 'oidc' | 'saml'
  providerMode: 'metadata_url' | 'inline_metadata' | 'manual_endpoints'
  enabled?: boolean
  authorizationUrl?: string
  tokenUrl?: string
  userInfoUrl?: string
  requestedScopes?: string[]
  metadataUrl?: string
  metadataXml?: string
  entityId?: string
  issuer?: string
  ssoServiceUrl?: string
  sloServiceUrl?: string
  metadata?: Record<string, string>
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
  entityType?: 'external_application'
  displayName: string
  slug: string
  protocol: 'oidc' | 'saml' | 'api_key'
  state: string
  authenticationFlows?: ExternalApplicationAuthenticationFlow[]
  redirectUris?: string[]
  scopes?: ExternalApplicationScope[]
  federatedProviders?: FederatedIdentityProvider[]
  validation?: ExternalApplicationValidationSummary
  login?: ExternalApplicationLoginPolicy
  logout?: ExternalApplicationLogoutPolicy
  metadata?: Record<string, string>
}

type ExternalApplicationCollectionResponse = {
  items?: ExternalApplication[]
}

type MutationAccepted = {
  status: 'accepted' | 'queued'
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

type MutationFeedback = {
  tone: 'success' | 'error'
  message: string
}

type ApplicationFormState = {
  displayName: string
  slug: string
  protocol: 'oidc' | 'saml' | 'api_key'
  redirectUris: string
  logoutUrl: string
  scopes: string
  authenticationFlows: string[]
}

type ProviderFormState = {
  providerId: string
  alias: string
  displayName: string
  protocol: 'oidc' | 'saml'
  providerMode: 'metadata_url' | 'inline_metadata' | 'manual_endpoints'
  enabled: boolean
  authorizationUrl: string
  tokenUrl: string
  userInfoUrl: string
  requestedScopes: string
  metadataUrl: string
  metadataXml: string
  entityId: string
  issuer: string
  ssoServiceUrl: string
  sloServiceUrl: string
}

type FormErrors = Record<string, string>

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

const APPLICATION_FLOW_OPTIONS: ExternalApplicationAuthenticationFlow[] = [
  'oidc_authorization_code_pkce',
  'oidc_authorization_code_client_secret',
  'oidc_client_credentials',
  'saml_sp_initiated',
  'saml_idp_initiated'
]

const EMPTY_APPLICATION_FORM: ApplicationFormState = {
  displayName: '',
  slug: '',
  protocol: 'oidc',
  redirectUris: '',
  logoutUrl: '',
  scopes: '',
  authenticationFlows: []
}

const EMPTY_PROVIDER_FORM: ProviderFormState = {
  providerId: '',
  alias: '',
  displayName: '',
  protocol: 'oidc',
  providerMode: 'manual_endpoints',
  enabled: true,
  authorizationUrl: '',
  tokenUrl: '',
  userInfoUrl: '',
  requestedScopes: '',
  metadataUrl: '',
  metadataXml: '',
  entityId: '',
  issuer: '',
  ssoServiceUrl: '',
  sloServiceUrl: ''
}

export function ConsoleAuthPage() {
  const { activeTenant, activeWorkspace } = useConsoleContext()
  const [realmState, setRealmState] = useState<RealmSurfaceState>(EMPTY_REALM_STATE)
  const [applicationsState, setApplicationsState] = useState<ApplicationsState>(EMPTY_APPLICATIONS_STATE)
  const [realmReloadToken, setRealmReloadToken] = useState(0)
  const [applicationsReloadToken, setApplicationsReloadToken] = useState(0)
  const [feedback, setFeedback] = useState<MutationFeedback | null>(null)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [editingApplicationId, setEditingApplicationId] = useState<string | null>(null)
  const [providerPanelApplicationId, setProviderPanelApplicationId] = useState<string | null>(null)
  const [providerEditingId, setProviderEditingId] = useState<string | null>(null)
  const [applicationForm, setApplicationForm] = useState<ApplicationFormState>(EMPTY_APPLICATION_FORM)
  const [providerForm, setProviderForm] = useState<ProviderFormState>(EMPTY_PROVIDER_FORM)
  const [applicationErrors, setApplicationErrors] = useState<FormErrors>({})
  const [providerErrors, setProviderErrors] = useState<FormErrors>({})
  const [isSubmittingApplication, setIsSubmittingApplication] = useState(false)
  const [isSubmittingProvider, setIsSubmittingProvider] = useState(false)
  const [iamWizardOpen, setIamWizardOpen] = useState(false)
  const [pendingDeleteApplicationId, setPendingDeleteApplicationId] = useState<string | null>(null)
  const [pendingDetachProviderId, setPendingDetachProviderId] = useState<string | null>(null)

  const realmId = activeTenant?.consoleUserRealm ?? null
  const workspaceId = activeWorkspace?.workspaceId ?? null
  const writeBlockedReason = !realmId
    ? 'Este tenant no tiene un realm IAM de consola configurado.'
    : !workspaceId
      ? 'Selecciona un workspace para operar aplicaciones externas y providers.'
      : null

  useEffect(() => {
    if (!activeTenant || !realmId) {
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
        if (ignore) return
        setRealmState({
          loading: false,
          error: null,
          usersCount: usersResponse.items?.length ?? 0,
          rolesCount: rolesResponse.items?.length ?? 0,
          scopes: scopesResponse.items ?? [],
          clients: clientsResponse.items ?? [],
          compatibility:
            usersResponse.compatibility ?? rolesResponse.compatibility ?? scopesResponse.compatibility ?? clientsResponse.compatibility ?? null
        })
      })
      .catch((error: unknown) => {
        if (ignore) return
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
        if (ignore) return
        setApplicationsState({ loading: false, error: null, applications: response.items ?? [] })
      })
      .catch((error: unknown) => {
        if (ignore) return
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

  useEffect(() => {
    setIsCreateOpen(false)
    setEditingApplicationId(null)
    setProviderPanelApplicationId(null)
    setProviderEditingId(null)
    setPendingDeleteApplicationId(null)
    setPendingDetachProviderId(null)
    setApplicationForm(EMPTY_APPLICATION_FORM)
    setProviderForm(EMPTY_PROVIDER_FORM)
    setApplicationErrors({})
    setProviderErrors({})
    setFeedback(null)
  }, [activeTenant?.tenantId, workspaceId])

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

  const editingApplication = applicationsState.applications.find((app) => app.applicationId === editingApplicationId) ?? null
  const providerApplication = applicationsState.applications.find((app) => app.applicationId === providerPanelApplicationId) ?? null

  if (!activeTenant) {
    return (
      <section data-testid="console-section-empty" className="space-y-4" aria-labelledby="console-auth-title">
        <div className="space-y-2">
          <Badge variant="secondary">Auth / IAM</Badge>
          <h1 id="console-auth-title" className="text-3xl font-semibold tracking-tight text-foreground">
            Gestión Auth/IAM
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground">Selecciona un tenant para inspeccionar Auth/IAM.</p>
        </div>
      </section>
    )
  }

  if (!realmId) {
    return (
      <section data-testid="console-section-empty" className="space-y-4" aria-labelledby="console-auth-title">
        <div className="space-y-2">
          <Badge variant="secondary">Auth / IAM</Badge>
          <h1 id="console-auth-title" className="text-3xl font-semibold tracking-tight text-foreground">
            Gestión Auth/IAM
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground">Este tenant no tiene un realm IAM de consola configurado.</p>
        </div>
      </section>
    )
  }

  async function reloadApplications(successMessage?: string) {
    setApplicationsReloadToken((value) => value + 1)
    if (successMessage) {
      setFeedback({ tone: 'success', message: successMessage })
    }
  }

  async function submitCreateOrUpdateApplication(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!workspaceId) {
      setFeedback({ tone: 'error', message: 'Selecciona un workspace antes de guardar una aplicación.' })
      return
    }

    const validation = validateApplicationForm(applicationForm)
    setApplicationErrors(validation)
    if (Object.keys(validation).length > 0) return

    const payload = buildApplicationPayload(applicationForm, editingApplication)
    const isEditing = Boolean(editingApplication)

    setIsSubmittingApplication(true)
    setFeedback(null)
    try {
      if (isEditing) {
        await requestConsoleSessionJson<MutationAccepted>(
          `/v1/workspaces/${workspaceId}/applications/${editingApplication!.applicationId}`,
          { method: 'PUT', body: payload as never }
        )
      } else {
        await requestConsoleSessionJson<MutationAccepted>(`/v1/workspaces/${workspaceId}/applications`, {
          method: 'POST',
          body: payload as never,
          idempotent: true
        })
      }

      setApplicationForm(EMPTY_APPLICATION_FORM)
      setApplicationErrors({})
      setIsCreateOpen(false)
      setEditingApplicationId(null)
      await reloadApplications(isEditing ? 'Aplicación actualizada. Refrescando inventario…' : 'Aplicación creada. Refrescando inventario…')
    } catch (error) {
      setFeedback({ tone: 'error', message: getErrorMessage(error, 'No se pudo guardar la aplicación.') })
    } finally {
      setIsSubmittingApplication(false)
    }
  }

  async function confirmSoftDeleteApplication() {
    if (!workspaceId || !pendingDeleteApplicationId) return
    const application = applicationsState.applications.find((item) => item.applicationId === pendingDeleteApplicationId)
    if (!application) return

    setIsSubmittingApplication(true)
    setFeedback(null)
    try {
      await requestConsoleSessionJson<MutationAccepted>(
        `/v1/workspaces/${workspaceId}/applications/${application.applicationId}`,
        { method: 'PUT', body: { ...buildApplicationPayload(toApplicationForm(application), application), desiredState: 'soft_deleted' } as never }
      )
      setPendingDeleteApplicationId(null)
      await reloadApplications(`La aplicación ${application.displayName} se marcó como soft_deleted.`)
    } catch (error) {
      setFeedback({ tone: 'error', message: getErrorMessage(error, 'No se pudo eliminar lógicamente la aplicación.') })
    } finally {
      setIsSubmittingApplication(false)
    }
  }

  async function submitProvider(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!workspaceId || !providerApplication) {
      setFeedback({ tone: 'error', message: 'Selecciona un workspace y una aplicación antes de guardar un provider.' })
      return
    }

    const validation = validateProviderForm(providerForm)
    setProviderErrors(validation)
    if (Object.keys(validation).length > 0) return

    const payload = buildProviderPayload(providerForm)
    const isEditing = Boolean(providerEditingId)
    setIsSubmittingProvider(true)
    setFeedback(null)
    try {
      if (isEditing) {
        await requestConsoleSessionJson<MutationAccepted>(
          `/v1/workspaces/${workspaceId}/applications/${providerApplication.applicationId}/federation/providers/${providerEditingId}`,
          { method: 'PUT', body: payload as never }
        )
      } else {
        await requestConsoleSessionJson<MutationAccepted>(
          `/v1/workspaces/${workspaceId}/applications/${providerApplication.applicationId}/federation/providers`,
          { method: 'POST', body: payload as never, idempotent: true }
        )
      }

      setProviderForm(EMPTY_PROVIDER_FORM)
      setProviderErrors({})
      setProviderEditingId(null)
      await reloadApplications(isEditing ? 'Provider actualizado. Refrescando inventario…' : 'Provider añadido. Refrescando inventario…')
    } catch (error) {
      setFeedback({ tone: 'error', message: getErrorMessage(error, 'No se pudo guardar el provider.') })
    } finally {
      setIsSubmittingProvider(false)
    }
  }

  async function toggleProvider(provider: FederatedIdentityProvider) {
    if (!workspaceId || !providerApplication) return
    setIsSubmittingProvider(true)
    setFeedback(null)
    try {
      await requestConsoleSessionJson<MutationAccepted>(
        `/v1/workspaces/${workspaceId}/applications/${providerApplication.applicationId}/federation/providers/${provider.providerId}`,
        { method: 'PUT', body: { ...provider, enabled: !(provider.enabled ?? true) } as never }
      )
      await reloadApplications(`Provider ${provider.alias} actualizado.`)
    } catch (error) {
      setFeedback({ tone: 'error', message: getErrorMessage(error, 'No se pudo cambiar el estado del provider.') })
    } finally {
      setIsSubmittingProvider(false)
    }
  }

  async function confirmDetachProvider() {
    if (!workspaceId || !providerApplication || !pendingDetachProviderId) return
    const nextProviders = (providerApplication.federatedProviders ?? []).filter((provider) => provider.providerId !== pendingDetachProviderId)
    setIsSubmittingProvider(true)
    setFeedback(null)
    try {
      await requestConsoleSessionJson<MutationAccepted>(
        `/v1/workspaces/${workspaceId}/applications/${providerApplication.applicationId}`,
        {
          method: 'PUT',
          body: {
            ...buildApplicationPayload(toApplicationForm(providerApplication), providerApplication),
            federatedProviders: nextProviders
          } as never
        }
      )
      setPendingDetachProviderId(null)
      setProviderEditingId(null)
      setProviderForm(EMPTY_PROVIDER_FORM)
      await reloadApplications('Provider desasociado. Refrescando inventario…')
    } catch (error) {
      setFeedback({ tone: 'error', message: getErrorMessage(error, 'No se pudo desasociar el provider.') })
    } finally {
      setIsSubmittingProvider(false)
    }
  }

  function openCreateForm() {
    setApplicationForm(EMPTY_APPLICATION_FORM)
    setApplicationErrors({})
    setEditingApplicationId(null)
    setIsCreateOpen(true)
    setFeedback(null)
  }

  function openEditForm(application: ExternalApplication) {
    setApplicationForm(toApplicationForm(application))
    setApplicationErrors({})
    setIsCreateOpen(false)
    setEditingApplicationId(application.applicationId)
    setFeedback(null)
  }

  function openProviderPanel(application: ExternalApplication) {
    setProviderPanelApplicationId(application.applicationId)
    setProviderEditingId(null)
    setProviderForm(EMPTY_PROVIDER_FORM)
    setProviderErrors({})
    setFeedback(null)
  }

  function openProviderEditor(provider: FederatedIdentityProvider) {
    setProviderEditingId(provider.providerId)
    setProviderForm(toProviderForm(provider))
    setProviderErrors({})
    setFeedback(null)
  }

  return (
    <section className="space-y-6" aria-labelledby="console-auth-title">
      <header className="rounded-3xl border border-border/60 bg-card p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-3">
            <Badge variant="secondary">Auth / IAM</Badge>
            <div className="space-y-2">
              <h1 id="console-auth-title" className="text-3xl font-semibold tracking-tight text-foreground">Gestión Auth/IAM</h1>
              <p className="max-w-3xl text-sm text-muted-foreground">Superficie operativa del realm de consola y de las aplicaciones externas del workspace activo.</p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">Tenant: {activeTenant.label}</Badge>
              <Badge variant="outline">Realm: {realmId}</Badge>
              <Badge variant="outline">Workspace: {activeWorkspace?.label ?? 'No seleccionado'}</Badge>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => setIamWizardOpen(true)}>Nuevo cliente IAM</Button>
            <Link to="/console/members" className="inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground transition hover:bg-accent hover:text-accent-foreground">Abrir Members</Link>
          </div>
        </div>
      </header>

      {iamWizardOpen ? <CreateIamClientWizard open={iamWizardOpen} onOpenChange={setIamWizardOpen} /> : null}

      {feedback ? (
        <div className={`rounded-2xl border p-4 ${feedback.tone === 'error' ? 'border-destructive/30 bg-destructive/5' : 'border-emerald-500/30 bg-emerald-500/5'}`} role="alert">
          <p className="text-sm text-foreground">{feedback.message}</p>
        </div>
      ) : null}

      <section className="space-y-4" aria-labelledby="auth-realm-heading">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 id="auth-realm-heading" className="text-xl font-semibold text-foreground">Resumen del realm</h2>
            <p className="text-sm text-muted-foreground">Users y roles se resumen aquí y mantienen su detalle operativo en la vista Members.</p>
          </div>
          {realmState.compatibility ? <Badge variant="outline">{realmState.compatibility.provider} · {realmState.compatibility.contractVersion}</Badge> : null}
        </div>

        {realmState.loading ? <div className="rounded-2xl border border-dashed border-border/70 bg-card p-6 text-sm text-muted-foreground">Cargando inventario del realm…</div> : null}

        {realmState.error ? (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4" role="alert">
            <div className="space-y-3">
              <p className="text-sm text-foreground">{realmState.error}</p>
              <Button type="button" variant="outline" onClick={() => setRealmReloadToken((value) => value + 1)}>Reintentar</Button>
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
                  <p className="text-sm text-muted-foreground">Scopes gestionados del realm activo con sus flags operativas.</p>
                </div>
                {realmState.scopes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No hay scopes gestionados para este realm.</p>
                ) : (
                  <TableContainer>
                    <table className="min-w-full text-left text-sm">
                      <thead><tr className="border-b border-border/60 text-muted-foreground"><th scope="col" className="px-3 py-2 font-medium">Scope</th><th scope="col" className="px-3 py-2 font-medium">Protocol</th><th scope="col" className="px-3 py-2 font-medium">Flags</th><th scope="col" className="px-3 py-2 font-medium">Clients</th></tr></thead>
                      <tbody>
                        {realmState.scopes.map((scope) => (
                          <tr key={scope.scopeName} className="border-b border-border/40 align-top last:border-b-0">
                            <td className="px-3 py-3"><div className="font-medium text-foreground">{scope.scopeName}</div></td>
                            <td className="px-3 py-3"><Badge variant="outline">{formatConsoleEnumLabel(scope.protocol)}</Badge></td>
                            <td className="px-3 py-3"><div className="flex flex-wrap gap-2"><BooleanBadge label="Default" value={scope.isDefault} /><BooleanBadge label="Optional" value={scope.isOptional} /><BooleanBadge label="Token" value={scope.includeInTokenScope} /></div></td>
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
                  <p className="text-sm text-muted-foreground">Clients gestionados del realm con access type, estado y scopes asociados.</p>
                </div>
                {realmState.clients.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No hay clients gestionados para este realm.</p>
                ) : (
                  <TableContainer>
                    <table className="min-w-full text-left text-sm">
                      <thead><tr className="border-b border-border/60 text-muted-foreground"><th scope="col" className="px-3 py-2 font-medium">Client</th><th scope="col" className="px-3 py-2 font-medium">Protocol</th><th scope="col" className="px-3 py-2 font-medium">Access</th><th scope="col" className="px-3 py-2 font-medium">Estado</th><th scope="col" className="px-3 py-2 font-medium">Redirects</th><th scope="col" className="px-3 py-2 font-medium">Scopes</th></tr></thead>
                      <tbody>
                        {realmState.clients.map((client) => (
                          <tr key={client.clientId} className="border-b border-border/40 align-top last:border-b-0">
                            <td className="px-3 py-3"><div className="font-medium text-foreground">{client.clientId}</div></td>
                            <td className="px-3 py-3"><Badge variant="outline">{formatConsoleEnumLabel(client.protocol)}</Badge></td>
                            <td className="px-3 py-3 text-muted-foreground">{formatConsoleEnumLabel(client.accessType)}</td>
                            <td className="px-3 py-3"><div className="flex flex-wrap gap-2"><BooleanBadge label="Enabled" value={client.enabled} /><Badge variant="outline">{formatConsoleEnumLabel(client.state)}</Badge></div></td>
                            <td className="px-3 py-3 text-muted-foreground">{formatList(client.redirectUris)}</td>
                            <td className="px-3 py-3 text-muted-foreground"><div><span className="font-medium text-foreground">Default:</span> {formatList(client.defaultScopes)}</div><div><span className="font-medium text-foreground">Optional:</span> {formatList(client.optionalScopes)}</div></td>
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
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 id="auth-applications-heading" className="text-xl font-semibold text-foreground">Aplicaciones externas y providers</h2>
            <p className="text-sm text-muted-foreground">Gestión operativa del workspace activo con mutaciones inline y feedback inmediato.</p>
          </div>
          <Button type="button" onClick={openCreateForm} disabled={Boolean(writeBlockedReason)}>Crear aplicación externa</Button>
        </div>

        {writeBlockedReason ? <div className="rounded-2xl border border-dashed border-border/70 bg-card p-6 text-sm text-muted-foreground">{writeBlockedReason}</div> : null}

        {(isCreateOpen || editingApplication) && !writeBlockedReason ? (
          <form className="space-y-4 rounded-3xl border border-border/60 bg-card p-5 shadow-sm" onSubmit={submitCreateOrUpdateApplication}>
            <div className="flex items-center justify-between gap-3"><h3 className="text-lg font-semibold text-foreground">{editingApplication ? `Editar ${editingApplication.displayName}` : 'Crear aplicación externa'}</h3><Button type="button" variant="outline" onClick={() => { setIsCreateOpen(false); setEditingApplicationId(null); setApplicationForm(EMPTY_APPLICATION_FORM); setApplicationErrors({}) }}>Cancelar</Button></div>
            <div className="grid gap-4 md:grid-cols-2">
              <TextField label="Display name" name="displayName" value={applicationForm.displayName} onChange={(value) => setApplicationForm((current) => ({ ...current, displayName: value }))} error={applicationErrors.displayName} />
              <TextField label="Slug" name="slug" value={applicationForm.slug} onChange={(value) => setApplicationForm((current) => ({ ...current, slug: value }))} error={applicationErrors.slug} disabled={Boolean(editingApplication)} />
              <label className="space-y-2 text-sm text-foreground"><span>Protocol</span><select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={applicationForm.protocol} onChange={(event) => setApplicationForm((current) => ({ ...current, protocol: event.target.value as ApplicationFormState['protocol'] }))}><option value="oidc">OIDC</option><option value="saml">SAML</option><option value="api_key">API key</option></select></label>
              <TextField label="Logout URL" name="logoutUrl" value={applicationForm.logoutUrl} onChange={(value) => setApplicationForm((current) => ({ ...current, logoutUrl: value }))} error={applicationErrors.logoutUrl} />
            </div>
            <TextAreaField label="Redirect URIs (una por línea)" name="redirectUris" value={applicationForm.redirectUris} onChange={(value) => setApplicationForm((current) => ({ ...current, redirectUris: value }))} error={applicationErrors.redirectUris} />
            <TextField label="Scopes (CSV)" name="scopes" value={applicationForm.scopes} onChange={(value) => setApplicationForm((current) => ({ ...current, scopes: value }))} />
            <fieldset className="space-y-2"><legend className="text-sm font-medium text-foreground">Authentication flows</legend><div className="grid gap-2 md:grid-cols-2">{APPLICATION_FLOW_OPTIONS.map((flow) => (<label key={flow} className="flex items-center gap-2 text-sm text-foreground"><input type="checkbox" checked={applicationForm.authenticationFlows.includes(flow)} onChange={(event) => setApplicationForm((current) => ({ ...current, authenticationFlows: event.target.checked ? [...current.authenticationFlows, flow] : current.authenticationFlows.filter((item) => item !== flow) }))} />{formatConsoleEnumLabel(flow)}</label>))}</div></fieldset>
            <div className="flex justify-end"><Button type="submit" disabled={isSubmittingApplication}>{isSubmittingApplication ? 'Guardando…' : editingApplication ? 'Guardar cambios' : 'Crear aplicación'}</Button></div>
          </form>
        ) : null}

        {applicationsState.loading ? <div className="rounded-2xl border border-dashed border-border/70 bg-card p-6 text-sm text-muted-foreground">Cargando aplicaciones externas del workspace…</div> : null}
        {applicationsState.error ? <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4" role="alert"><div className="space-y-3"><p className="text-sm text-foreground">{applicationsState.error}</p><Button type="button" variant="outline" onClick={() => setApplicationsReloadToken((value) => value + 1)}>Reintentar</Button></div></div> : null}

        {!applicationsState.loading && !applicationsState.error && workspaceId ? (
          <div className="grid gap-6 xl:grid-cols-2">
            <div className="rounded-3xl border border-border/60 bg-card p-5 shadow-sm">
              <div className="mb-4 space-y-1"><h3 className="text-lg font-semibold text-foreground">Aplicaciones externas</h3><p className="text-sm text-muted-foreground">Alta, edición, baja lógica y acceso a providers por aplicación.</p></div>
              {applicationsState.applications.length === 0 ? <p className="text-sm text-muted-foreground">No hay aplicaciones externas vinculadas a este workspace.</p> : (
                <div className="space-y-4">{applicationsState.applications.filter((application) => application.state !== 'soft_deleted').map((application) => (<article key={application.applicationId} className="rounded-2xl border border-border/60 p-4"><div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div className="space-y-2"><div className="flex flex-wrap items-center gap-2"><h4 className="text-base font-semibold text-foreground">{application.displayName}</h4><Badge variant="outline">{formatConsoleEnumLabel(application.protocol)}</Badge><Badge variant="outline">{formatConsoleEnumLabel(application.state)}</Badge></div><p className="text-xs text-muted-foreground">{application.slug}</p><p className="text-sm text-muted-foreground">Flows: {formatList(application.authenticationFlows)}</p><p className="text-sm text-muted-foreground">Redirects: {formatList(application.redirectUris)}</p><p className="text-sm text-muted-foreground">Scopes: {formatList((application.scopes ?? []).map((scope) => scope.scopeName))}</p><ValidationBadge validation={application.validation} /></div><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => openEditForm(application)} disabled={Boolean(writeBlockedReason)}>Editar</Button><Button type="button" variant="outline" onClick={() => openProviderPanel(application)} disabled={Boolean(writeBlockedReason) || application.protocol === 'api_key'}>Providers</Button><Button type="button" variant="outline" onClick={() => setPendingDeleteApplicationId(application.applicationId)} disabled={Boolean(writeBlockedReason)}>Eliminar</Button></div></div>{pendingDeleteApplicationId === application.applicationId ? <div className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/5 p-4"><p className="text-sm text-foreground">Confirma la baja lógica de {application.displayName}. Sus providers asociados se desvincularán con la baja.</p><div className="mt-3 flex gap-2"><Button type="button" variant="outline" onClick={() => setPendingDeleteApplicationId(null)}>Cancelar</Button><Button type="button" onClick={confirmSoftDeleteApplication} disabled={isSubmittingApplication}>Confirmar eliminación</Button></div></div> : null}</article>))}</div>
              )}
            </div>

            <div className="rounded-3xl border border-border/60 bg-card p-5 shadow-sm">
              <div className="mb-4 space-y-1"><h3 className="text-lg font-semibold text-foreground">Providers federados</h3><p className="text-sm text-muted-foreground">Providers OIDC/SAML derivados de las aplicaciones externas del workspace activo.</p></div>
              {providerRows.length === 0 ? <p className="text-sm text-muted-foreground">No hay providers federados asociados a las aplicaciones del workspace.</p> : (<TableContainer><table className="min-w-full text-left text-sm"><thead><tr className="border-b border-border/60 text-muted-foreground"><th scope="col" className="px-3 py-2 font-medium">Aplicación</th><th scope="col" className="px-3 py-2 font-medium">Alias</th><th scope="col" className="px-3 py-2 font-medium">Protocol</th><th scope="col" className="px-3 py-2 font-medium">Modo</th><th scope="col" className="px-3 py-2 font-medium">Estado</th></tr></thead><tbody>{providerRows.map((provider) => (<tr key={`${provider.applicationLabel}-${provider.providerId}`} className="border-b border-border/40 align-top last:border-b-0"><td className="px-3 py-3 text-foreground">{provider.applicationLabel}</td><td className="px-3 py-3"><div className="font-medium text-foreground">{provider.alias}</div><div className="text-xs text-muted-foreground">{provider.displayName}</div></td><td className="px-3 py-3"><Badge variant="outline">{formatConsoleEnumLabel(provider.protocol)}</Badge></td><td className="px-3 py-3 text-muted-foreground">{formatConsoleEnumLabel(provider.providerMode)}</td><td className="px-3 py-3"><BooleanBadge label="Enabled" value={provider.enabled} /></td></tr>))}</tbody></table></TableContainer>)}
            </div>
          </div>
        ) : null}

        {providerApplication ? (
          <section className="space-y-4 rounded-3xl border border-border/60 bg-card p-5 shadow-sm" aria-label={`Providers de ${providerApplication.displayName}`}>
            <div className="flex items-center justify-between gap-3"><div><h3 className="text-lg font-semibold text-foreground">Providers de {providerApplication.displayName}</h3><p className="text-sm text-muted-foreground">Gestiona alta, edición, toggle y desasociación.</p></div><div className="flex gap-2"><Button type="button" variant="outline" onClick={() => { setProviderPanelApplicationId(null); setProviderEditingId(null); setProviderForm(EMPTY_PROVIDER_FORM) }}>Cerrar</Button><Button type="button" onClick={() => { setProviderEditingId(null); setProviderForm(EMPTY_PROVIDER_FORM); setProviderErrors({}) }} disabled={providerApplication.protocol === 'api_key'}>Añadir provider</Button></div></div>

            {providerApplication.protocol === 'api_key' ? <div className="rounded-2xl border border-dashed border-border/70 bg-background p-4 text-sm text-muted-foreground">Las aplicaciones API key no soportan providers federados en esta consola.</div> : null}

            {providerApplication.protocol !== 'api_key' ? (
              <>
                <div className="space-y-3">{(providerApplication.federatedProviders ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No hay providers asociados a esta aplicación.</p> : (providerApplication.federatedProviders ?? []).map((provider) => (<article key={provider.providerId} className="rounded-2xl border border-border/60 p-4"><div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between"><div className="space-y-1"><div className="flex flex-wrap items-center gap-2"><h4 className="font-medium text-foreground">{provider.alias}</h4><Badge variant="outline">{formatConsoleEnumLabel(provider.protocol)}</Badge><Badge variant="outline">{formatConsoleEnumLabel(provider.providerMode)}</Badge></div><p className="text-sm text-muted-foreground">{provider.displayName}</p><BooleanBadge label="Enabled" value={provider.enabled ?? true} /></div><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => openProviderEditor(provider)}>Editar</Button><Button type="button" variant="outline" onClick={() => toggleProvider(provider)} disabled={isSubmittingProvider}>{provider.enabled ?? true ? 'Deshabilitar' : 'Habilitar'}</Button><Button type="button" variant="outline" onClick={() => setPendingDetachProviderId(provider.providerId)}>Desasociar</Button></div></div>{pendingDetachProviderId === provider.providerId ? <div className="mt-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-4"><p className="text-sm text-foreground">Confirma la desasociación del provider {provider.alias}.</p><div className="mt-3 flex gap-2"><Button type="button" variant="outline" onClick={() => setPendingDetachProviderId(null)}>Cancelar</Button><Button type="button" onClick={confirmDetachProvider} disabled={isSubmittingProvider}>Confirmar desasociación</Button></div></div> : null}</article>))}</div>
                <form className="space-y-4 rounded-2xl border border-border/60 p-4" onSubmit={submitProvider}>
                  <h4 className="text-base font-semibold text-foreground">{providerEditingId ? `Editar provider ${providerEditingId}` : 'Añadir provider federado'}</h4>
                  <div className="grid gap-4 md:grid-cols-2"><TextField label="Provider ID" name="providerId" value={providerForm.providerId} onChange={(value) => setProviderForm((current) => ({ ...current, providerId: value }))} error={providerErrors.providerId} disabled={Boolean(providerEditingId)} /><TextField label="Alias" name="alias" value={providerForm.alias} onChange={(value) => setProviderForm((current) => ({ ...current, alias: value }))} error={providerErrors.alias} /><TextField label="Display name" name="providerDisplayName" value={providerForm.displayName} onChange={(value) => setProviderForm((current) => ({ ...current, displayName: value }))} error={providerErrors.displayName} /><label className="space-y-2 text-sm text-foreground"><span>Protocol</span><select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={providerForm.protocol} onChange={(event) => setProviderForm((current) => ({ ...current, protocol: event.target.value as ProviderFormState['protocol'] }))}><option value="oidc">OIDC</option><option value="saml">SAML</option></select></label><label className="space-y-2 text-sm text-foreground"><span>Provider mode</span><select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={providerForm.providerMode} onChange={(event) => setProviderForm((current) => ({ ...current, providerMode: event.target.value as ProviderFormState['providerMode'] }))}><option value="manual_endpoints">Manual endpoints</option><option value="metadata_url">Metadata URL</option><option value="inline_metadata">Inline metadata</option></select></label><label className="flex items-center gap-2 pt-8 text-sm text-foreground"><input type="checkbox" checked={providerForm.enabled} onChange={(event) => setProviderForm((current) => ({ ...current, enabled: event.target.checked }))} />Enabled</label></div>
                  {providerForm.providerMode === 'metadata_url' ? <TextField label="Metadata URL" name="metadataUrl" value={providerForm.metadataUrl} onChange={(value) => setProviderForm((current) => ({ ...current, metadataUrl: value }))} error={providerErrors.metadataUrl} /> : null}
                  {providerForm.protocol === 'oidc' && providerForm.providerMode === 'manual_endpoints' ? <div className="grid gap-4 md:grid-cols-2"><TextField label="Authorization URL" name="authorizationUrl" value={providerForm.authorizationUrl} onChange={(value) => setProviderForm((current) => ({ ...current, authorizationUrl: value }))} error={providerErrors.authorizationUrl} /><TextField label="Token URL" name="tokenUrl" value={providerForm.tokenUrl} onChange={(value) => setProviderForm((current) => ({ ...current, tokenUrl: value }))} error={providerErrors.tokenUrl} /><TextField label="User info URL" name="userInfoUrl" value={providerForm.userInfoUrl} onChange={(value) => setProviderForm((current) => ({ ...current, userInfoUrl: value }))} error={providerErrors.userInfoUrl} /><TextField label="Requested scopes (CSV)" name="requestedScopes" value={providerForm.requestedScopes} onChange={(value) => setProviderForm((current) => ({ ...current, requestedScopes: value }))} /></div> : null}
                  {providerForm.protocol === 'saml' && providerForm.providerMode === 'manual_endpoints' ? <div className="grid gap-4 md:grid-cols-2"><TextField label="Entity ID" name="entityId" value={providerForm.entityId} onChange={(value) => setProviderForm((current) => ({ ...current, entityId: value }))} error={providerErrors.entityId} /><TextField label="Issuer" name="issuer" value={providerForm.issuer} onChange={(value) => setProviderForm((current) => ({ ...current, issuer: value }))} /><TextField label="SSO service URL" name="ssoServiceUrl" value={providerForm.ssoServiceUrl} onChange={(value) => setProviderForm((current) => ({ ...current, ssoServiceUrl: value }))} error={providerErrors.ssoServiceUrl} /><TextField label="SLO service URL" name="sloServiceUrl" value={providerForm.sloServiceUrl} onChange={(value) => setProviderForm((current) => ({ ...current, sloServiceUrl: value }))} error={providerErrors.sloServiceUrl} /></div> : null}
                  {providerForm.providerMode === 'inline_metadata' ? <TextAreaField label="Metadata XML" name="metadataXml" value={providerForm.metadataXml} onChange={(value) => setProviderForm((current) => ({ ...current, metadataXml: value }))} error={providerErrors.metadataXml} rows={5} /> : null}
                  <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => { setProviderEditingId(null); setProviderForm(EMPTY_PROVIDER_FORM); setProviderErrors({}) }}>Reset</Button><Button type="submit" disabled={isSubmittingProvider}>{isSubmittingProvider ? 'Guardando…' : providerEditingId ? 'Guardar provider' : 'Crear provider'}</Button></div>
                </form>
              </>
            ) : null}
          </section>
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
  if (!validation) return <Badge variant="secondary">Sin validación</Badge>
  return <Badge variant="outline">{formatConsoleEnumLabel(validation.status)}</Badge>
}

function TableContainer({ children }: { children: React.ReactNode }) {
  return <div className="overflow-x-auto">{children}</div>
}

function TextField({ label, value, onChange, error, name, ...props }: { label: string; value: string; onChange: (value: string) => void; error?: string; name: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'name'>) {
  return (
    <label className="space-y-2 text-sm text-foreground">
      <span>{label}</span>
      <input {...props} name={name} value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
      {error ? <span className="text-sm text-destructive" role="alert">{error}</span> : null}
    </label>
  )
}

function TextAreaField({ label, value, onChange, error, name, rows = 3 }: { label: string; value: string; onChange: (value: string) => void; error?: string; name: string; rows?: number }) {
  return (
    <label className="space-y-2 text-sm text-foreground">
      <span>{label}</span>
      <textarea name={name} value={value} rows={rows} onChange={(event) => onChange(event.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
      {error ? <span className="text-sm text-destructive" role="alert">{error}</span> : null}
    </label>
  )
}

function formatList(values?: string[]): string {
  return values && values.length > 0 ? values.join(', ') : '—'
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') return error.message
  return fallback
}

function splitLines(value: string): string[] {
  return value.split('\n').map((entry) => entry.trim()).filter(Boolean)
}

function splitCsv(value: string): string[] {
  return value.split(',').map((entry) => entry.trim()).filter(Boolean)
}

function isValidUrl(value: string): boolean {
  try { new URL(value); return true } catch { return false }
}

function validateApplicationForm(form: ApplicationFormState): FormErrors {
  const errors: FormErrors = {}
  if (!form.displayName.trim()) errors.displayName = 'El nombre es obligatorio.'
  if (!form.slug.trim()) errors.slug = 'El slug es obligatorio.'
  else if (!/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/.test(form.slug.trim())) errors.slug = 'El slug debe usar minúsculas, números y guiones.'
  const redirectUris = splitLines(form.redirectUris)
  if (redirectUris.length === 0) errors.redirectUris = 'Indica al menos una redirect URI válida.'
  else if (redirectUris.some((uri) => !isValidUrl(uri))) errors.redirectUris = 'Todas las redirect URI deben ser válidas.'
  if (form.logoutUrl.trim() && !isValidUrl(form.logoutUrl.trim())) errors.logoutUrl = 'La logout URL debe ser válida.'
  return errors
}

function validateProviderForm(form: ProviderFormState): FormErrors {
  const errors: FormErrors = {}
  if (!form.providerId.trim()) errors.providerId = 'El providerId es obligatorio.'
  if (!form.alias.trim()) errors.alias = 'El alias es obligatorio.'
  if (!form.displayName.trim()) errors.displayName = 'El displayName es obligatorio.'
  if (form.providerMode === 'metadata_url') {
    if (!form.metadataUrl.trim()) errors.metadataUrl = 'La metadata URL es obligatoria.'
    else if (!isValidUrl(form.metadataUrl.trim())) errors.metadataUrl = 'La metadata URL debe ser válida.'
  }
  if (form.providerMode === 'inline_metadata' && form.protocol === 'saml' && form.metadataXml.trim().length < 32) errors.metadataXml = 'El metadata XML debe tener contenido suficiente.'
  if (form.protocol === 'oidc' && form.providerMode === 'manual_endpoints') {
    if (!form.authorizationUrl.trim() || !isValidUrl(form.authorizationUrl.trim())) errors.authorizationUrl = 'La authorization URL es obligatoria y debe ser válida.'
    if (!form.tokenUrl.trim() || !isValidUrl(form.tokenUrl.trim())) errors.tokenUrl = 'La token URL es obligatoria y debe ser válida.'
    if (form.userInfoUrl.trim() && !isValidUrl(form.userInfoUrl.trim())) errors.userInfoUrl = 'La user info URL debe ser válida.'
  }
  if (form.protocol === 'saml' && form.providerMode === 'manual_endpoints') {
    if (!form.entityId.trim()) errors.entityId = 'El entityId es obligatorio.'
    if (!form.ssoServiceUrl.trim() || !isValidUrl(form.ssoServiceUrl.trim())) errors.ssoServiceUrl = 'La SSO service URL es obligatoria y debe ser válida.'
    if (form.sloServiceUrl.trim() && !isValidUrl(form.sloServiceUrl.trim())) errors.sloServiceUrl = 'La SLO service URL debe ser válida.'
  }
  return errors
}

function toApplicationForm(application: ExternalApplication): ApplicationFormState {
  return {
    displayName: application.displayName,
    slug: application.slug,
    protocol: application.protocol,
    redirectUris: (application.redirectUris ?? application.login?.redirectUris ?? []).join('\n'),
    logoutUrl: application.logout?.frontChannelLogoutUri ?? '',
    scopes: (application.scopes ?? []).map((scope) => scope.scopeName).join(', '),
    authenticationFlows: application.authenticationFlows ?? []
  }
}

function buildApplicationPayload(form: ApplicationFormState, existing?: ExternalApplication | null) {
  const redirectUris = splitLines(form.redirectUris)
  const scopes = splitCsv(form.scopes).map((scopeName) => ({ scopeName }))
  return {
    entityType: 'external_application' as const,
    displayName: form.displayName.trim(),
    slug: form.slug.trim(),
    protocol: form.protocol,
    desiredState: (existing?.state as 'active' | 'soft_deleted' | undefined) ?? 'active',
    metadata: existing?.metadata ?? { managedBy: 'web-console', surface: 'console-auth' },
    redirectUris,
    login: { ...(existing?.login ?? {}), redirectUris, defaultRedirectUri: redirectUris[0] },
    logout: form.logoutUrl.trim() ? { ...(existing?.logout ?? {}), frontChannelLogoutUri: form.logoutUrl.trim(), postLogoutRedirectUris: [form.logoutUrl.trim()] } : existing?.logout,
    scopes,
    authenticationFlows: form.authenticationFlows,
    federatedProviders: existing?.federatedProviders ?? []
  }
}

function toProviderForm(provider: FederatedIdentityProvider): ProviderFormState {
  return {
    providerId: provider.providerId,
    alias: provider.alias,
    displayName: provider.displayName,
    protocol: provider.protocol,
    providerMode: provider.providerMode,
    enabled: provider.enabled ?? true,
    authorizationUrl: provider.authorizationUrl ?? '',
    tokenUrl: provider.tokenUrl ?? '',
    userInfoUrl: provider.userInfoUrl ?? '',
    requestedScopes: (provider.requestedScopes ?? []).join(', '),
    metadataUrl: provider.metadataUrl ?? '',
    metadataXml: provider.metadataXml ?? '',
    entityId: provider.entityId ?? '',
    issuer: provider.issuer ?? '',
    ssoServiceUrl: provider.ssoServiceUrl ?? '',
    sloServiceUrl: provider.sloServiceUrl ?? ''
  }
}

function buildProviderPayload(form: ProviderFormState): FederatedIdentityProvider {
  return {
    providerId: form.providerId.trim(),
    alias: form.alias.trim(),
    displayName: form.displayName.trim(),
    protocol: form.protocol,
    providerMode: form.providerMode,
    enabled: form.enabled,
    authorizationUrl: form.authorizationUrl.trim() || undefined,
    tokenUrl: form.tokenUrl.trim() || undefined,
    userInfoUrl: form.userInfoUrl.trim() || undefined,
    requestedScopes: splitCsv(form.requestedScopes),
    metadataUrl: form.metadataUrl.trim() || undefined,
    metadataXml: form.metadataXml.trim() || undefined,
    entityId: form.entityId.trim() || undefined,
    issuer: form.issuer.trim() || undefined,
    ssoServiceUrl: form.ssoServiceUrl.trim() || undefined,
    sloServiceUrl: form.sloServiceUrl.trim() || undefined,
    metadata: { managedBy: 'web-console', surface: 'console-auth' }
  }
}
