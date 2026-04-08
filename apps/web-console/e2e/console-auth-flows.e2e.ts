import { expect, test, type Page, type Route } from '@playwright/test'

const consoleSession = {
  sessionId: 'ses_e2e_console_001',
  authenticationState: 'active',
  statusView: 'login',
  issuedAt: '2026-03-28T21:00:00.000Z',
  lastActivityAt: '2026-03-28T21:00:05.000Z',
  expiresAt: '2099-03-28T22:00:00.000Z',
  idleExpiresAt: '2099-03-28T21:30:00.000Z',
  refreshExpiresAt: '2099-03-29T21:00:00.000Z',
  sessionPolicy: {
    idleTimeout: 'PT30M',
    maxLifetime: 'PT12H',
    refreshTokenMaxAge: 'P1D'
  },
  tokenSet: {
    accessToken: 'access.console.token',
    expiresAt: '2099-03-28T22:00:00.000Z',
    expiresIn: 3600,
    refreshExpiresAt: '2099-03-29T21:00:00.000Z',
    refreshExpiresIn: 86400,
    refreshToken: 'refresh.console.token',
    scope: 'openid profile email',
    tokenType: 'Bearer'
  },
  principal: {
    displayName: 'Operaciones Plataforma',
    primaryEmail: 'ops@example.com',
    state: 'active',
    userId: 'usr_ops_001',
    username: 'operaciones',
    platformRoles: ['superadmin'],
    tenantIds: ['tenant_001'],
    workspaceIds: ['workspace_ops']
  }
} as const

const signupPolicyAllowed = {
  allowed: true,
  approvalRequired: false,
  effectiveMode: 'auto_activate',
  globalMode: 'auto_activate',
  environmentModes: {},
  planModes: {}
} as const

const signupPolicyApprovalRequired = {
  allowed: true,
  approvalRequired: true,
  effectiveMode: 'approval_required',
  globalMode: 'approval_required',
  environmentModes: {},
  planModes: {},
  reason: 'El acceso requiere aprobación antes de entrar en la consola.'
} as const

const pendingActivationRegistration = {
  registrationId: 'reg_console_001',
  userId: 'usr_pending_001',
  activationMode: 'approval_required',
  state: 'pending_activation',
  statusView: 'pending_activation',
  createdAt: '2026-03-28T21:05:00.000Z',
  message: 'Tu registro está pendiente de activación.'
} as const

const pendingActivationView = {
  statusView: 'pending_activation',
  title: 'Tu registro está pendiente de activación',
  message: 'Hemos recibido tu solicitud de acceso y todavía requiere aprobación.',
  allowedActions: []
} as const

test('redirige desde deep link protegido a login, restaura el destino y permite navegación base', async ({ page }) => {
  await installConsoleAuthMocks(page, {
    signupPolicy: signupPolicyAllowed
  })

  await page.goto('/console/workspaces?tab=active')

  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: /accede a in falcone console/i })).toBeVisible()

  await page.getByLabel(/usuario/i).fill('operaciones')
  await page.getByLabel(/contraseña/i).fill('super-secret-123')
  await page.getByRole('button', { name: /entrar a la consola/i }).click()

  await expect(page).toHaveURL(/\/console\/workspaces\?tab=active$/)
  await expect(page.getByRole('heading', { name: /gestión de workspaces/i })).toBeVisible()
  await expect(page.getByText(/Operaciones Plataforma/i)).toBeVisible()

  await page.getByRole('link', { name: /functions/i }).first().click()

  await expect(page).toHaveURL(/\/console\/functions$/)
  await expect(page.getByRole('heading', { name: /functions y runtime serverless/i })).toBeVisible()
})

test('permite cerrar sesión desde el shell y vuelve a proteger las rutas', async ({ page }) => {
  await installConsoleAuthMocks(page, {
    signupPolicy: signupPolicyAllowed
  })

  await page.goto('/login')
  await expect(page.getByRole('heading', { name: /accede a in falcone console/i })).toBeVisible()

  await page.getByLabel(/usuario/i).fill('operaciones')
  await page.getByLabel(/contraseña/i).fill('super-secret-123')
  await page.getByRole('button', { name: /entrar a la consola/i }).click()

  await expect(page).toHaveURL(/\/console\/overview$/)
  await expect(page.getByRole('heading', { name: /vista general de la consola/i })).toBeVisible()

  await page.getByTestId('console-shell-avatar').click()
  await page.getByRole('menuitem', { name: /logout/i }).click()

  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: /accede a in falcone console/i })).toBeVisible()

  await expect
    .poll(() =>
      page.evaluate(() => window.sessionStorage.getItem('in-falcone.console-shell-session'))
    )
    .toBeNull()

  await page.goto('/console/overview')
  await expect(page).toHaveURL(/\/login$/)
})

test('permite signup con aprobación y aterriza en pending activation', async ({ page }) => {
  await installConsoleAuthMocks(page, {
    signupPolicy: signupPolicyApprovalRequired,
    registration: pendingActivationRegistration,
    pendingActivationView
  })

  await page.goto('/signup')

  await expect(page).toHaveURL(/\/signup$/)
  await expect(page.getByLabel(/nombre visible/i)).toBeVisible()

  await page.locator('input[name="username"]').fill('nuevo-operador')
  await page.locator('input[name="displayName"]').fill('Nuevo Operador')
  await page.locator('input[name="primaryEmail"]').fill('nuevo@example.com')
  await page.locator('input[name="password"]').fill('super-secret-123')
  await page.locator('button[type="submit"]').click()

  await expect(page).toHaveURL(/\/signup\/pending-activation$/)
  await expect(page.getByRole('heading', { level: 1, name: /tu registro está pendiente de activación/i })).toBeVisible()
  await expect(page.getByText(/reg_console_001/i)).toBeVisible()
  await expect(page.getByText(/Modo de activación: approval_required/i)).toBeVisible()
})

interface ConsoleAuthMockOptions {
  signupPolicy?: typeof signupPolicyAllowed | typeof signupPolicyApprovalRequired
  registration?: typeof pendingActivationRegistration
  pendingActivationView?: typeof pendingActivationView
}

async function installConsoleAuthMocks(page: Page, options: ConsoleAuthMockOptions = {}): Promise<void> {
  const signupPolicy = options.signupPolicy ?? signupPolicyAllowed
  const registration = options.registration ?? pendingActivationRegistration
  const pendingView = options.pendingActivationView ?? pendingActivationView

  await page.route('**/v1/auth/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const pathname = url.pathname
    const method = request.method()

    if (method === 'GET' && pathname === '/v1/auth/signups/policy') {
      await fulfillJson(route, 200, signupPolicy)
      return
    }

    if (method === 'POST' && pathname === '/v1/auth/login-sessions') {
      await fulfillJson(route, 200, consoleSession)
      return
    }

    if (method === 'DELETE' && pathname === `/v1/auth/login-sessions/${consoleSession.sessionId}`) {
      await fulfillJson(route, 202, {
        sessionId: consoleSession.sessionId,
        status: 'accepted',
        acceptedAt: '2026-03-28T21:10:00.000Z'
      })
      return
    }

    if (method === 'POST' && pathname === '/v1/auth/signups') {
      await fulfillJson(route, 201, registration)
      return
    }

    if (method === 'GET' && pathname === '/v1/auth/status-views/pending_activation') {
      await fulfillJson(route, 200, pendingView)
      return
    }

    if (method === 'POST' && pathname === `/v1/auth/login-sessions/${consoleSession.sessionId}/refresh`) {
      await fulfillJson(route, 200, consoleSession)
      return
    }

    await route.abort('failed')
  })
}

async function fulfillJson(route: Route, status: number, body: unknown): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body)
  })
}
