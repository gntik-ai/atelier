import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConsolePostgresPage } from './ConsolePostgresPage'

const { requestConsoleSessionJsonMock, useConsoleContextMock } = vi.hoisted(() => ({
  requestConsoleSessionJsonMock: vi.fn(),
  useConsoleContextMock: vi.fn()
}))

vi.mock('@/lib/console-session', () => ({
  requestConsoleSessionJson: requestConsoleSessionJsonMock
}))

vi.mock('@/lib/console-context', () => ({
  useConsoleContext: useConsoleContextMock
}))

type ConsoleContextValue = {
  activeTenant: { label: string } | null
  activeTenantId: string | null
  activeWorkspace: { label: string } | null
  activeWorkspaceId: string | null
}

type ApiFixtureState = {
  databases?: Array<ReturnType<typeof dbFixture>>
  schemas?: Array<ReturnType<typeof schemaFixture>>
  tables?: Array<ReturnType<typeof tableFixture>>
  columns?: Array<ReturnType<typeof columnFixture>>
  indexes?: Array<ReturnType<typeof indexFixture>>
  policies?: Array<ReturnType<typeof policyFixture>>
  security?: ReturnType<typeof securityFixture>
  views?: Array<ReturnType<typeof viewFixture>>
  matViews?: Array<ReturnType<typeof matViewFixture>>
  ddlPreview?: ReturnType<typeof ddlPreviewFixture>
  databasesError?: string
  schemasError?: string
  tablesError?: string
  columnsError?: string
  indexesError?: string
  policiesError?: string
  securityError?: string
  viewsError?: string
  matViewsError?: string
  ddlPreviewError?: string
}

describe('ConsolePostgresPage', () => {
  let currentContext: ConsoleContextValue

  beforeEach(() => {
    currentContext = createConsoleContext()
    useConsoleContextMock.mockImplementation(() => currentContext)
  })

  afterEach(() => {
    cleanup()
    requestConsoleSessionJsonMock.mockReset()
    useConsoleContextMock.mockReset()
  })

  it('T01.11.01 Sin tenant activo → empty state global visible', async () => {
    currentContext = createConsoleContext({ activeTenant: null, activeTenantId: null, activeWorkspace: null, activeWorkspaceId: null })
    useConsoleContextMock.mockImplementation(() => currentContext)

    renderPage()

    expect((await screen.findAllByText(/selecciona un tenant para explorar las bases de datos postgresql/i)).length).toBeGreaterThan(0)
    expect(requestConsoleSessionJsonMock).not.toHaveBeenCalled()
  })

  it('T01.11.02 Sin workspace activo → databases visibles; sección de esquemas muestra estado contextual', async () => {
    currentContext = createConsoleContext({ activeWorkspace: null, activeWorkspaceId: null })
    useConsoleContextMock.mockImplementation(() => currentContext)
    mockConsoleApi()
    const user = userEvent.setup()

    renderPage()

    expect(await screen.findByRole('table', { name: /listado de bases de datos postgresql/i })).toBeInTheDocument()
    await user.click(screen.getByText('app_db'))

    expect(await screen.findByText('Selecciona un workspace para ver esquemas.')).toBeInTheDocument()
  })

  it('T01.11.03 Carga de databases: renderiza tabla con databaseName, state, ownerRoleName', async () => {
    mockConsoleApi()

    renderPage()

    expect(await screen.findByRole('table', { name: /listado de bases de datos postgresql/i })).toBeInTheDocument()
    expect(screen.getByText('app_db')).toBeInTheDocument()
    expect(screen.getByText('postgres_owner')).toBeInTheDocument()
    expect(screen.getByText(/schema per tenant/i)).toBeInTheDocument()
  })

  it('T01.11.04 Clic en database: llama a /schemas y renderiza lista de esquemas', async () => {
    mockConsoleApi()
    const user = userEvent.setup()

    renderPage()

    await user.click(await screen.findByText('app_db'))

    expect(await screen.findByRole('table', { name: /listado de esquemas postgresql del workspace activo/i })).toBeInTheDocument()
    expect(screen.getByText('public')).toBeInTheDocument()
    expectRequested('/v1/postgres/databases/app_db/schemas?page%5Bsize%5D=100')
  })

  it('T01.11.05 Clic en schema: llama a tables, views y materialized-views; renderiza tabla de tablas', async () => {
    mockConsoleApi()
    const user = userEvent.setup()

    renderPage()
    await selectSchema(user)

    expect(await screen.findByRole('table', { name: /listado de tablas postgresql del esquema seleccionado/i })).toBeInTheDocument()
    expect(screen.getByText('accounts')).toBeInTheDocument()
    expectRequested('/v1/postgres/databases/app_db/schemas/public/tables?page%5Bsize%5D=100')
    expectRequested('/v1/postgres/databases/app_db/schemas/public/views?page%5Bsize%5D=100')
    expectRequested('/v1/postgres/databases/app_db/schemas/public/materialized-views?page%5Bsize%5D=100')
  })

  it('T01.11.06 Clic en tabla: llama a columns, indexes, policies y security en paralelo', async () => {
    mockConsoleApi()
    const user = userEvent.setup()

    renderPage()
    await selectTable(user)

    expect(await screen.findByRole('table', { name: /listado de columnas de la tabla seleccionada/i })).toBeInTheDocument()
    expectRequested('/v1/postgres/databases/app_db/schemas/public/tables/accounts/columns?page%5Bsize%5D=100')
    expectRequested('/v1/postgres/databases/app_db/schemas/public/tables/accounts/indexes?page%5Bsize%5D=100')
    expectRequested('/v1/postgres/databases/app_db/schemas/public/tables/accounts/policies?page%5Bsize%5D=100')
    expectRequested('/v1/postgres/databases/app_db/schemas/public/tables/accounts/security')
  })

  it('T01.11.07 Tab Columns: muestra columnName, tipo, nullable, default', async () => {
    mockConsoleApi()
    const user = userEvent.setup()

    renderPage()
    await selectTable(user)

    expect(await screen.findByText('id')).toBeInTheDocument()
    expect(screen.getByText('uuid')).toBeInTheDocument()
    expect(screen.getByText('NOT NULL')).toBeInTheDocument()
    expect(screen.getByText('gen_random_uuid()')).toBeInTheDocument()
  })

  it('T01.11.08 Tab Indexes: muestra indexName, método, unicidad', async () => {
    mockConsoleApi()
    const user = userEvent.setup()

    renderPage()
    await selectTable(user)
    await user.click(screen.getByRole('button', { name: /indexes/i }))

    expect(await screen.findByText('accounts_pkey')).toBeInTheDocument()
    expect(screen.getByText('btree')).toBeInTheDocument()
    expect(screen.getByText('Único')).toBeInTheDocument()
  })

  it('T01.11.09 Tab Policies: muestra policyName, policyMode, command, roles', async () => {
    mockConsoleApi()
    const user = userEvent.setup()

    renderPage()
    await selectTable(user)
    await user.click(screen.getByRole('button', { name: /policies/i }))

    expect(await screen.findByText('accounts_select_policy')).toBeInTheDocument()
    expect(screen.getByText(/permissive/i)).toBeInTheDocument()
    expect(screen.getByText('SELECT')).toBeInTheDocument()
    expect(screen.getByText('tenant_user')).toBeInTheDocument()
  })

  it('T01.11.10 Tab Security: muestra rlsEnabled, forceRls, policyCount, estado', async () => {
    mockConsoleApi()
    const user = userEvent.setup()

    renderPage()
    await selectTable(user)
    await user.click(screen.getByRole('button', { name: /security/i }))

    expect(await screen.findByText('RLS enabled')).toBeInTheDocument()
    expect(screen.getAllByText('Sí').length).toBeGreaterThan(0)
    expect(screen.getAllByText('2').length).toBeGreaterThan(0)
    expect(screen.getByText(/tenant scoped/i)).toBeInTheDocument()
    expect(screen.getByText(/review required/i)).toBeInTheDocument()
  })

  it('T01.11.11 Tab Vistas: muestra viewName, estado, columnas expuestas', async () => {
    mockConsoleApi()
    const user = userEvent.setup()

    renderPage()
    await selectSchema(user)
    await user.click(screen.getByRole('button', { name: /^vistas$/i }))

    expect(await screen.findByText('active_accounts')).toBeInTheDocument()
    expect(screen.getByText('id, email')).toBeInTheDocument()
    expect(screen.getByText('Sí')).toBeInTheDocument()
  })

  it('T01.11.12 Tab Vistas materializadas: muestra viewName, withData, diferenciación visual respecto a vistas', async () => {
    mockConsoleApi()
    const user = userEvent.setup()

    renderPage()
    await selectSchema(user)
    await user.click(screen.getByRole('button', { name: /vistas materializadas/i }))

    expect(await screen.findByText('accounts_snapshot')).toBeInTheDocument()
    expect(screen.getByText('daily refresh')).toBeInTheDocument()
    expect(screen.getByText('loaded')).toBeInTheDocument()
    expect(screen.getAllByText('Sí').length).toBeGreaterThan(0)
  })

  it('T01.11.13 Panel DDL Preview: clic en "Preview DDL" → llama al endpoint preview; renderiza statements + warnings + riskProfile', async () => {
    mockConsoleApi()
    const user = userEvent.setup()

    renderPage()
    await selectTable(user)
    await user.click(screen.getByRole('button', { name: /preview ddl/i }))

    expect(await screen.findByText(/preview ddl — accounts/i)).toBeInTheDocument()
    expect(screen.getByText(/create table public.accounts/i)).toBeInTheDocument()
    expect(screen.getByText(/exclusive lock possible/i)).toBeInTheDocument()
    expect(screen.getByText(/locks: 1/i)).toBeInTheDocument()
    expectRequestedWithMethod('PUT', '/v1/postgres/databases/app_db/schemas/public/tables/accounts')
  })

  it('T01.11.14 Warnings con severity=critical o severity=high: clase CSS diferenciada presente en el DOM', async () => {
    mockConsoleApi({ ddlPreview: ddlPreviewFixture({ preExecutionWarnings: [warningFixture({ severity: 'critical', summary: 'Critical warning' })] }) })
    const user = userEvent.setup()

    renderPage()
    await selectTable(user)
    await user.click(screen.getByRole('button', { name: /preview ddl/i }))

    const warningCard = (await screen.findByText('Critical warning')).closest('div[data-severity]')
    expect(warningCard).toHaveAttribute('data-severity', 'critical')
    expect(warningCard).toHaveClass('warning-critical')
  })

  it('T01.11.15 Error parcial en indexes: tab Indexes muestra error aislado; tabs Columns y Policies operativos', async () => {
    mockConsoleApi({ indexesError: 'Índices degradados' })
    const user = userEvent.setup()

    renderPage()
    await selectTable(user)

    expect(await screen.findByText('id')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /indexes/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/índices degradados/i)

    await user.click(screen.getByRole('button', { name: /columns/i }))
    expect(await screen.findByText('gen_random_uuid()')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /policies/i }))
    expect(await screen.findByText('accounts_select_policy')).toBeInTheDocument()
  })

  it('T01.11.16 Tabla sin índices: empty state específico en tab Indexes', async () => {
    mockConsoleApi({ indexes: [] })
    const user = userEvent.setup()

    renderPage()
    await selectTable(user)
    await user.click(screen.getByRole('button', { name: /indexes/i }))

    expect(await screen.findByText(/esta tabla no tiene índices definidos/i)).toBeInTheDocument()
  })

  it('T01.11.17 Reset al cambiar activeTenantId: selección descartada + recarga databases', async () => {
    mockConsoleApi({ databases: [dbFixture(), dbFixture({ databaseName: 'beta_db', ownerRoleName: 'beta_owner' })] })
    const user = userEvent.setup()

    const view = renderPage()
    await selectTable(user)
    expect(await screen.findByRole('heading', { name: /tabla accounts/i })).toBeInTheDocument()

    currentContext = createConsoleContext({
      activeTenant: { label: 'Tenant Beta' },
      activeTenantId: 'ten_beta'
    })
    useConsoleContextMock.mockImplementation(() => currentContext)
    view.rerender(renderUi())

    await waitFor(() => {
      expect(screen.queryByText(/tabla accounts/i)).not.toBeInTheDocument()
      expect(screen.getByText(/tenant: tenant beta/i)).toBeInTheDocument()
    })

    expect(getRequestCount('/v1/postgres/databases?page%5Bsize%5D=100')).toBeGreaterThanOrEqual(2)
  })

  it('T01.11.18 Reset al cambiar activeWorkspaceId con database seleccionada: recarga esquemas', async () => {
    mockConsoleApi()
    const user = userEvent.setup()

    const view = renderPage()
    await user.click(await screen.findByText('app_db'))
    expect(await screen.findByText('public')).toBeInTheDocument()

    currentContext = createConsoleContext({
      activeWorkspace: { label: 'Workspace Beta' },
      activeWorkspaceId: 'wrk_beta'
    })
    useConsoleContextMock.mockImplementation(() => currentContext)
    view.rerender(renderUi())

    await waitFor(() => {
      expect(screen.getByText(/workspace: workspace beta/i)).toBeInTheDocument()
    })

    expect(getRequestCount('/v1/postgres/databases/app_db/schemas?page%5Bsize%5D=100')).toBeGreaterThanOrEqual(2)
  })

  it('T01.11.19 Retry: botón de Reintentar en error de databases relanza la llamada', async () => {
    let shouldFail = true
    requestConsoleSessionJsonMock.mockImplementation(async (url: string) => {
      if (url === '/v1/postgres/databases?page%5Bsize%5D=100' && shouldFail) {
        shouldFail = false
        throw new Error('Bases degradadas')
      }

      if (url === '/v1/postgres/databases?page%5Bsize%5D=100') {
        return collection([dbFixture()])
      }

      throw new Error(`Unexpected request: ${url}`)
    })
    const user = userEvent.setup()

    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent(/bases degradadas/i)
    await user.click(screen.getAllByRole('button', { name: /reintentar/i })[0]!)

    expect(await screen.findByText('app_db')).toBeInTheDocument()
    expect(getRequestCount('/v1/postgres/databases?page%5Bsize%5D=100')).toBe(2)
  })

  it('muestra snippets de conexión para la base seleccionada y usa placeholders de host', async () => {
    mockConsoleApi()
    const user = userEvent.setup()

    renderPage()
    await user.click(await screen.findByText('app_db'))

    expect(await screen.findByRole('heading', { name: 'Snippets de conexión' })).toBeInTheDocument()
    expect(screen.getAllByText(/<RESOURCE_HOST>/).length).toBeGreaterThan(0)
  })

  it('no renderiza snippets cuando no hay base seleccionada', () => {
    mockConsoleApi()

    renderPage()

    expect(screen.queryByRole('heading', { name: 'Snippets de conexión' })).not.toBeInTheDocument()
  })
})

function renderUi() {
  return (
    <MemoryRouter>
      <ConsolePostgresPage />
    </MemoryRouter>
  )
}

function renderPage() {
  return render(renderUi())
}

async function selectSchema(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByText('app_db'))
  await user.click(await screen.findByText('public'))
}

async function selectTable(user: ReturnType<typeof userEvent.setup>) {
  await selectSchema(user)
  await user.click(await screen.findByText('accounts'))
}

function mockConsoleApi(fixtures: ApiFixtureState = {}) {
  const state: Required<ApiFixtureState> = {
    databases: fixtures.databases ?? [dbFixture()],
    schemas: fixtures.schemas ?? [schemaFixture()],
    tables: fixtures.tables ?? [tableFixture()],
    columns: fixtures.columns ?? [columnFixture()],
    indexes: fixtures.indexes ?? [indexFixture()],
    policies: fixtures.policies ?? [policyFixture()],
    security: fixtures.security ?? securityFixture(),
    views: fixtures.views ?? [viewFixture()],
    matViews: fixtures.matViews ?? [matViewFixture()],
    ddlPreview: fixtures.ddlPreview ?? ddlPreviewFixture(),
    databasesError: fixtures.databasesError ?? '',
    schemasError: fixtures.schemasError ?? '',
    tablesError: fixtures.tablesError ?? '',
    columnsError: fixtures.columnsError ?? '',
    indexesError: fixtures.indexesError ?? '',
    policiesError: fixtures.policiesError ?? '',
    securityError: fixtures.securityError ?? '',
    viewsError: fixtures.viewsError ?? '',
    matViewsError: fixtures.matViewsError ?? '',
    ddlPreviewError: fixtures.ddlPreviewError ?? ''
  }

  requestConsoleSessionJsonMock.mockImplementation(async (url: string, init?: { method?: string }) => {
    const method = init?.method ?? 'GET'

    if (method === 'PUT' && url === '/v1/postgres/databases/app_db/schemas/public/tables/accounts') {
      if (state.ddlPreviewError) throw new Error(state.ddlPreviewError)
      return state.ddlPreview
    }

    if (method === 'PUT' && url === '/v1/postgres/databases/app_db/schemas/public/views/active_accounts') {
      if (state.ddlPreviewError) throw new Error(state.ddlPreviewError)
      return state.ddlPreview
    }

    if (method === 'PUT' && url === '/v1/postgres/databases/app_db/schemas/public/materialized-views/accounts_snapshot') {
      if (state.ddlPreviewError) throw new Error(state.ddlPreviewError)
      return state.ddlPreview
    }

    if (url === '/v1/postgres/databases?page%5Bsize%5D=100') {
      if (state.databasesError) throw new Error(state.databasesError)
      return collection(state.databases)
    }

    if (url === '/v1/postgres/databases/app_db/schemas?page%5Bsize%5D=100') {
      if (state.schemasError) throw new Error(state.schemasError)
      return collection(state.schemas)
    }

    if (url === '/v1/postgres/databases/app_db/schemas/public/tables?page%5Bsize%5D=100') {
      if (state.tablesError) throw new Error(state.tablesError)
      return collection(state.tables)
    }

    if (url === '/v1/postgres/databases/app_db/schemas/public/tables/accounts/columns?page%5Bsize%5D=100') {
      if (state.columnsError) throw new Error(state.columnsError)
      return collection(state.columns)
    }

    if (url === '/v1/postgres/databases/app_db/schemas/public/tables/accounts/indexes?page%5Bsize%5D=100') {
      if (state.indexesError) throw new Error(state.indexesError)
      return collection(state.indexes)
    }

    if (url === '/v1/postgres/databases/app_db/schemas/public/tables/accounts/policies?page%5Bsize%5D=100') {
      if (state.policiesError) throw new Error(state.policiesError)
      return collection(state.policies)
    }

    if (url === '/v1/postgres/databases/app_db/schemas/public/tables/accounts/security') {
      if (state.securityError) throw new Error(state.securityError)
      return state.security
    }

    if (url === '/v1/postgres/databases/app_db/schemas/public/views?page%5Bsize%5D=100') {
      if (state.viewsError) throw new Error(state.viewsError)
      return collection(state.views)
    }

    if (url === '/v1/postgres/databases/app_db/schemas/public/materialized-views?page%5Bsize%5D=100') {
      if (state.matViewsError) throw new Error(state.matViewsError)
      return collection(state.matViews)
    }

    throw new Error(`Unexpected request: ${method} ${url}`)
  })
}

function expectRequested(path: string) {
  expect(requestConsoleSessionJsonMock.mock.calls.some(([url]) => url === path)).toBe(true)
}

function expectRequestedWithMethod(method: string, path: string) {
  expect(requestConsoleSessionJsonMock.mock.calls.some(([url, init]) => url === path && (init?.method ?? 'GET') === method)).toBe(true)
}

function getRequestCount(path: string) {
  return requestConsoleSessionJsonMock.mock.calls.filter(([url]) => url === path).length
}

function collection<T>(items: T[]) {
  return { items, page: { total: items.length } }
}

function createConsoleContext(overrides: Partial<ConsoleContextValue> = {}): ConsoleContextValue {
  return {
    activeTenant: { label: 'Tenant Alpha' },
    activeTenantId: 'ten_alpha',
    activeWorkspace: { label: 'Workspace Alpha' },
    activeWorkspaceId: 'wrk_alpha',
    ...overrides
  }
}

function dbFixture(overrides: Partial<ReturnType<typeof dbFixtureBase>> = {}) {
  return { ...dbFixtureBase(), ...overrides }
}

function dbFixtureBase() {
  return {
    databaseName: 'app_db',
    state: 'active',
    ownerRoleName: 'postgres_owner',
    placementMode: 'schema_per_tenant',
    tenantId: 'ten_alpha',
    workspaceId: 'wrk_alpha'
  }
}

function schemaFixture(overrides: Partial<ReturnType<typeof schemaFixtureBase>> = {}) {
  return { ...schemaFixtureBase(), ...overrides }
}

function schemaFixtureBase() {
  return {
    schemaName: 'public',
    state: 'active',
    ownerRoleName: 'postgres_owner',
    objectCounts: {
      tables: 1,
      views: 1,
      materializedViews: 1,
      indexes: 2
    }
  }
}

function tableFixture(overrides: Partial<ReturnType<typeof tableFixtureBase>> = {}) {
  return { ...tableFixtureBase(), ...overrides }
}

function tableFixtureBase() {
  return {
    tableName: 'accounts',
    state: 'active',
    columnCount: 2
  }
}

function columnFixture(overrides: Partial<ReturnType<typeof columnFixtureBase>> = {}) {
  return { ...columnFixtureBase(), ...overrides }
}

function columnFixtureBase() {
  return {
    columnName: 'id',
    dataType: { typeName: 'uuid' },
    nullable: false,
    defaultExpression: 'gen_random_uuid()',
    ordinalPosition: 1
  }
}

function indexFixture(overrides: Partial<ReturnType<typeof indexFixtureBase>> = {}) {
  return { ...indexFixtureBase(), ...overrides }
}

function indexFixtureBase() {
  return {
    indexName: 'accounts_pkey',
    indexMethod: 'btree',
    unique: true,
    keys: [{ columnName: 'id' }],
    includeColumns: ['email']
  }
}

function policyFixture(overrides: Partial<ReturnType<typeof policyFixtureBase>> = {}) {
  return { ...policyFixtureBase(), ...overrides }
}

function policyFixtureBase() {
  return {
    policyName: 'accounts_select_policy',
    policyMode: 'permissive',
    state: 'active',
    appliesTo: {
      command: 'select',
      roles: ['tenant_user']
    },
    usingExpression: 'tenant_id = current_setting(\'app.tenant_id\')'
  }
}

function securityFixture(overrides: Partial<ReturnType<typeof securityFixtureBase>> = {}) {
  return { ...securityFixtureBase(), ...overrides }
}

function securityFixtureBase() {
  return {
    rlsEnabled: true,
    forceRls: true,
    policyCount: 2,
    sharedTableClassification: 'tenant_scoped',
    state: 'review_required'
  }
}

function viewFixture(overrides: Partial<ReturnType<typeof viewFixtureBase>> = {}) {
  return { ...viewFixtureBase(), ...overrides }
}

function viewFixtureBase() {
  return {
    viewName: 'active_accounts',
    state: 'active',
    columns: ['id', 'email'],
    query: 'select id, email from public.accounts where active = true',
    securityBarrier: true
  }
}

function matViewFixture(overrides: Partial<ReturnType<typeof matViewFixtureBase>> = {}) {
  return { ...matViewFixtureBase(), ...overrides }
}

function matViewFixtureBase() {
  return {
    viewName: 'accounts_snapshot',
    state: 'active',
    columns: ['id', 'email'],
    query: 'select id, email from public.accounts',
    withData: true,
    refreshPolicy: 'daily refresh',
    integrityProfile: {
      populationState: 'loaded'
    }
  }
}

function warningFixture(overrides: Partial<ReturnType<typeof warningFixtureBase>> = {}) {
  return { ...warningFixtureBase(), ...overrides }
}

function warningFixtureBase() {
  return {
    warningCode: 'lock_risk',
    severity: 'high',
    category: 'locks',
    summary: 'Exclusive lock possible',
    impactLevel: 'high',
    requiresAcknowledgement: true,
    detail: 'The preview detects an ACCESS EXCLUSIVE lock target.'
  }
}

function ddlPreviewFixture(overrides: Partial<ReturnType<typeof ddlPreviewFixtureBase>> = {}) {
  return { ...ddlPreviewFixtureBase(), ...overrides }
}

function ddlPreviewFixtureBase() {
  return {
    ddlPreview: {
      executionMode: 'preview',
      statementCount: 1,
      statements: [
        {
          ordinal: 1,
          category: 'create',
          destructive: false,
          sql: 'CREATE TABLE public.accounts (id uuid primary key);'
        }
      ],
      transactionMode: 'transactional_ddl',
      safeGuards: ['preview_only'],
      lockTargets: ['public.accounts']
    },
    preExecutionWarnings: [warningFixture()],
    riskProfile: {
      riskLevel: 'high',
      statementCount: 1,
      lockTargetCount: 1,
      blockingLikely: true,
      destructive: false,
      acknowledgementRequired: true
    }
  }
}
