import { expect, test, type Page } from '@playwright/test'

import { installContextAuthMocks, type MockScenario } from './fixtures/context-auth-e2e'
import {
  assertPublicApiOnly,
  installFunctionsMocks,
  installKafkaMocks,
  installMongoMocks,
  installPgMocks,
  installStorageMocks,
  FN_ACTION_NAME,
  KAFKA_TOPIC_NAME,
  MONGO_COL_NAME,
  MONGO_DB_NAME,
  PG_DB_NAME,
  PG_SCHEMA_NAME,
  PG_TABLE_NAME,
  STO_BUCKET_ID,
  STO_BUCKET_NAME,
  STO_OBJECT_KEY
} from './fixtures/service-e2e'

async function loginToConsole(page: Page, scenario: MockScenario) {
  await installContextAuthMocks(page, scenario)
  await page.goto('/login')

  await expect(page.getByRole('heading', { name: /accede a in atelier console/i })).toBeVisible()

  await page.getByLabel(/usuario/i).fill('operaciones')
  await page.getByLabel(/contraseña/i).fill('super-secret-123')
  await page.getByRole('button', { name: /entrar a la consola/i }).click()

  await expect(page).toHaveURL(/\/console\/overview$/)
  await expect(page.getByRole('button', { name: /abrir menú de usuario/i })).toBeVisible()
  await waitForSelectOption(page, /seleccionar tenant/i, 'Alpha Corp')
}

async function waitForSelectOption(page: Page, labelMatcher: RegExp, optionLabel: string) {
  await expect.poll(async () => {
    return page.getByLabel(labelMatcher).locator('option').allTextContents()
  }).toContain(optionLabel)
}

async function selectTenant(page: Page, label: string) {
  await waitForSelectOption(page, /seleccionar tenant/i, label)
  await page.getByLabel(/seleccionar tenant/i).selectOption({ label })
  await expect(page.getByLabel(/seleccionar tenant/i).locator('option:checked')).toHaveText(label)
}

async function selectWorkspace(page: Page, label: string) {
  await waitForSelectOption(page, /seleccionar workspace/i, label)
  await page.getByLabel(/seleccionar workspace/i).selectOption({ label })
  await expect(page.getByLabel(/seleccionar workspace/i).locator('option:checked')).toHaveText(label)
  await expect(page.getByRole('heading', { name: new RegExp(`^${label}$`, 'i'), level: 2 })).toBeVisible()
}

async function registerInterceptedUrls(page: Page, interceptedUrls: string[]) {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.startsWith('/v1/')) {
      interceptedUrls.push(url.pathname)
    }
    await route.fallback()
  })
}

async function openConsoleSection(page: Page, path: string, urlPattern: RegExp) {
  await page.goto(path)
  await expect(page).toHaveURL(urlPattern)
}

async function openConsoleSectionWithWorkspace(page: Page, path: string, urlPattern: RegExp, workspaceLabel = 'Production') {
  await openConsoleSection(page, path, urlPattern)
  await selectWorkspace(page, workspaceLabel)
}

async function loginWithAlphaProduction(page: Page, installMocks: () => Promise<void>, interceptedUrls?: string[]) {
  await loginToConsole(page, 'multi_tenant_nominal')
  await installMocks()
  if (interceptedUrls) {
    await registerInterceptedUrls(page, interceptedUrls)
  }
  await selectTenant(page, 'Alpha Corp')
}

test.describe('J01 — PostgreSQL: listado y exploración de esquemas/tablas', () => {
  test('J01-T1 — Journey nominal: listado de bases y exploración de esquemas/tablas', async ({ page }) => {
    const interceptedUrls: string[] = []
    await loginWithAlphaProduction(page, () => installPgMocks(page, 'nominal'), interceptedUrls)

    await openConsoleSectionWithWorkspace(page, '/console/postgres', /\/console\/postgres$/)

    await expect(page.getByRole('heading', { name: /inventario relacional del tenant activo/i })).toBeVisible()
    await expect(page.getByRole('table', { name: /listado de bases de datos postgresql/i })).toBeVisible()
    await expect(page.getByRole('table', { name: /listado de bases de datos postgresql/i })).toContainText(PG_DB_NAME)
    await page.getByRole('cell', { name: new RegExp(PG_DB_NAME, 'i') }).click()
    await expect(page.getByRole('table', { name: /listado de esquemas postgresql del workspace activo/i })).toBeVisible()
    await expect(page.getByRole('table', { name: /listado de esquemas postgresql/i })).toContainText(PG_SCHEMA_NAME)
    await page.getByRole('cell', { name: new RegExp(PG_SCHEMA_NAME, 'i') }).click()
    await expect(page.getByRole('tabpanel', { name: /tablas postgresql del esquema seleccionado/i })).toBeVisible()
    await expect(page.getByRole('table', { name: /listado de tablas postgresql del esquema seleccionado/i })).toBeVisible()
    await expect(page.getByRole('table', { name: /listado de tablas postgresql/i })).toContainText(PG_TABLE_NAME)

    assertPublicApiOnly(interceptedUrls, 'postgresql')
    expect(interceptedUrls.some((url) => url.includes('/v1/postgres/databases'))).toBeTruthy()
    expect(interceptedUrls.some((url) => url.includes(`/v1/postgres/databases/${PG_DB_NAME}/schemas`))).toBeTruthy()
  })

  test('J01-T2 — Empty state: sin bases de datos', async ({ page }) => {
    await loginWithAlphaProduction(page, () => installPgMocks(page, 'empty'))
    await openConsoleSectionWithWorkspace(page, '/console/postgres', /\/console\/postgres$/)

    await expect(page.getByText('No hay bases de datos disponibles para este tenant.')).toBeVisible()
    await expect(page.getByRole('table', { name: /listado de bases de datos/i })).not.toBeVisible()
  })

  test('J01-T3 — Error de API: listado de bases', async ({ page }) => {
    await loginWithAlphaProduction(page, () => installPgMocks(page, 'error'))
    await openConsoleSectionWithWorkspace(page, '/console/postgres', /\/console\/postgres$/)

    await expect(page.getByRole('alert').first()).toBeVisible()
    await expect(page.getByRole('button', { name: /reintentar/i }).first()).toBeVisible()
  })

  test('J01-T4 — Acceso denegado: sin tenant seleccionado', async ({ page }) => {
    const interceptedUrls: string[] = []
    await loginToConsole(page, 'multi_tenant_nominal')
    await installPgMocks(page, 'nominal')
    await registerInterceptedUrls(page, interceptedUrls)

    await openConsoleSection(page, '/console/postgres', /\/console\/postgres$/)

    await expect(page.getByText('Selecciona un tenant para explorar las bases de datos PostgreSQL.').first()).toBeVisible()
    expect(interceptedUrls.filter((url) => url.startsWith('/v1/postgres/'))).toHaveLength(0)
  })
})

test.describe('J02 — MongoDB: listado y exploración de colecciones', () => {
  test('J02-T1 — Journey nominal: listado de bases y exploración de colecciones', async ({ page }) => {
    const interceptedUrls: string[] = []
    await loginWithAlphaProduction(page, () => installMongoMocks(page, 'nominal'), interceptedUrls)
    await openConsoleSectionWithWorkspace(page, '/console/mongo', /\/console\/mongo$/)

    await expect(page.getByRole('heading', { name: /inventario documental del tenant activo/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: /bases de datos/i })).toBeVisible()
    await expect(page.locator('body')).toContainText(MONGO_DB_NAME)
    await page.getByRole('cell', { name: new RegExp(MONGO_DB_NAME, 'i') }).click()
    await expect(page.getByRole('heading', { name: new RegExp(`base de datos: ${MONGO_DB_NAME}`, 'i') })).toBeVisible()
    await expect(page.locator('body')).toContainText(MONGO_COL_NAME)
    await page.getByRole('cell', { name: new RegExp(MONGO_COL_NAME, 'i') }).click()
    await expect(page.getByRole('heading', { name: new RegExp(`colección: ${MONGO_COL_NAME}`, 'i') })).toBeVisible()
    await expect(page.locator('body')).toContainText('created_at_1')

    assertPublicApiOnly(interceptedUrls, 'mongodb')
    expect(interceptedUrls.some((url) => url.includes('/v1/mongo/databases'))).toBeTruthy()
    expect(interceptedUrls.some((url) => url.includes(`/v1/mongo/databases/${MONGO_DB_NAME}/collections`))).toBeTruthy()
  })

  test('J02-T2 — Empty state: sin bases MongoDB', async ({ page }) => {
    await loginWithAlphaProduction(page, () => installMongoMocks(page, 'empty'))
    await openConsoleSectionWithWorkspace(page, '/console/mongo', /\/console\/mongo$/)

    await expect(page.getByText('No hay bases de datos MongoDB disponibles para este tenant.')).toBeVisible()
  })

  test('J02-T3 — Error de API: listado MongoDB', async ({ page }) => {
    await loginWithAlphaProduction(page, () => installMongoMocks(page, 'error'))
    await openConsoleSectionWithWorkspace(page, '/console/mongo', /\/console\/mongo$/)

    await expect(page.getByRole('alert').first()).toBeVisible()
    await expect(page.getByRole('button', { name: /reintentar/i }).first()).toBeVisible()
  })
})

test.describe('J03 — Kafka: topics y estado de salud', () => {
  test('J03-T1 — Journey nominal: topics y estado de salud', async ({ page }) => {
    const interceptedUrls: string[] = []
    await loginWithAlphaProduction(page, () => installKafkaMocks(page, 'nominal'), interceptedUrls)
    await openConsoleSectionWithWorkspace(page, '/console/kafka', /\/console\/kafka$/)

    await expect(page.getByRole('heading', { name: /kafka \/ events/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: /topics kafka/i })).toBeVisible()
    await expect(page.locator('body')).toContainText(KAFKA_TOPIC_NAME)
    await page.getByRole('cell', { name: new RegExp(KAFKA_TOPIC_NAME.replace('.', '\\.'), 'i') }).click()
    await expect(page.getByRole('heading', { name: new RegExp(KAFKA_TOPIC_NAME.replace('.', '\\.'), 'i'), level: 2 })).toBeVisible()
    await expect(page.locator('body')).toContainText(/healthy|active|platform\.audit\.events/i)

    assertPublicApiOnly(interceptedUrls, 'kafka')
    expect(interceptedUrls.some((url) => url.includes('/v1/events/workspaces/'))).toBeTruthy()
  })

  test('J03-T2 — Empty state: sin topics', async ({ page }) => {
    await loginWithAlphaProduction(page, () => installKafkaMocks(page, 'empty'))
    await openConsoleSectionWithWorkspace(page, '/console/kafka', /\/console\/kafka$/)

    await expect(page.getByText('No hay topics en este workspace.')).toBeVisible()
  })

  test('J03-T3 — Error de API: inventory Kafka', async ({ page }) => {
    await loginWithAlphaProduction(page, () => installKafkaMocks(page, 'error'))
    await openConsoleSectionWithWorkspace(page, '/console/kafka', /\/console\/kafka$/)

    await expect(page.getByRole('alert').first()).toBeVisible()
    await expect(page.getByRole('button', { name: /reintentar/i }).first()).toBeVisible()
  })
})

test.describe('J04 — Functions: listado, estado y activations', () => {
  test('J04-T1 — Journey nominal: listado de funciones y activations', async ({ page }) => {
    const interceptedUrls: string[] = []
    await loginWithAlphaProduction(page, () => installFunctionsMocks(page, 'nominal'), interceptedUrls)
    await openConsoleSectionWithWorkspace(page, '/console/functions', /\/console\/functions$/)

    await expect(page.getByRole('heading', { name: /consola de funciones/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: /inventario/i })).toBeVisible()
    await expect(page.locator('body')).toContainText(FN_ACTION_NAME)
    await page.getByRole('button', { name: new RegExp(FN_ACTION_NAME, 'i') }).click()
    await expect(page.getByRole('heading', { name: new RegExp(FN_ACTION_NAME, 'i'), level: 2 })).toBeVisible()
    await page.getByRole('button', { name: /^Activations$/i }).click()
    await expect(page.locator('body')).toContainText('act_001')

    assertPublicApiOnly(interceptedUrls, 'functions')
    expect(interceptedUrls.some((url) => url.includes('/v1/functions/'))).toBeTruthy()
  })

  test('J04-T2 — Empty state: sin funciones', async ({ page }) => {
    await loginWithAlphaProduction(page, () => installFunctionsMocks(page, 'empty'))
    await openConsoleSectionWithWorkspace(page, '/console/functions', /\/console\/functions$/)

    await expect(page.getByText('No hay funciones en este workspace.')).toBeVisible()
  })

  test('J04-T3 — Error de API: carga de funciones', async ({ page }) => {
    await loginWithAlphaProduction(page, () => installFunctionsMocks(page, 'error'))
    await openConsoleSectionWithWorkspace(page, '/console/functions', /\/console\/functions$/)

    await expect(page.getByRole('alert').first()).toBeVisible()
    await expect(page.getByRole('button', { name: /reintentar/i }).first()).toBeVisible()
  })
})

test.describe('J05 — Storage: buckets, objetos y uso', () => {
  test('J05-T1 — Journey nominal: listado de buckets y exploración de objetos', async ({ page }) => {
    const interceptedUrls: string[] = []
    await loginWithAlphaProduction(page, () => installStorageMocks(page, 'nominal'), interceptedUrls)
    await openConsoleSectionWithWorkspace(page, '/console/storage', /\/console\/storage$/)

    await expect(page.getByRole('heading', { name: /storage \/ objetos/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: /buckets/i })).toBeVisible()
    await expect(page.locator('body')).toContainText(STO_BUCKET_NAME)
    await page.getByRole('button', { name: new RegExp(STO_BUCKET_NAME, 'i') }).click()
    await expect(page.getByRole('heading', { name: new RegExp(STO_BUCKET_NAME, 'i'), level: 2 })).toBeVisible()
    await expect(page.locator('body')).toContainText(STO_OBJECT_KEY)

    assertPublicApiOnly(interceptedUrls, 'storage')
    expect(interceptedUrls.some((url) => url.includes('/v1/storage/buckets'))).toBeTruthy()
    expect(interceptedUrls.some((url) => url.includes(`/v1/storage/buckets/${STO_BUCKET_ID}/objects`))).toBeTruthy()
  })

  test('J05-T2 — Empty state: sin buckets', async ({ page }) => {
    await loginWithAlphaProduction(page, () => installStorageMocks(page, 'empty'))
    await openConsoleSectionWithWorkspace(page, '/console/storage', /\/console\/storage$/)

    await expect(page.getByText('No hay buckets en el workspace seleccionado.')).toBeVisible()
  })

  test('J05-T3 — Error de API: listado de buckets', async ({ page }) => {
    await loginWithAlphaProduction(page, () => installStorageMocks(page, 'error'))
    await openConsoleSectionWithWorkspace(page, '/console/storage', /\/console\/storage$/)

    await expect(page.getByRole('alert').first()).toBeVisible()
    await expect(page.getByRole('button', { name: /reintentar/i }).first()).toBeVisible()
  })
})

test.describe('J06 — Verificación transversal de ausencia de backdoors', () => {
  test('J06-T1 — Ningún journey llama a endpoints fuera del allowlist', async ({ page }) => {
    const interceptedUrls: string[] = []
    await loginToConsole(page, 'multi_tenant_nominal')
    await installPgMocks(page, 'nominal')
    await installMongoMocks(page, 'nominal')
    await installKafkaMocks(page, 'nominal')
    await installFunctionsMocks(page, 'nominal')
    await installStorageMocks(page, 'nominal')
    await registerInterceptedUrls(page, interceptedUrls)

    await selectTenant(page, 'Alpha Corp')

    await openConsoleSectionWithWorkspace(page, '/console/postgres', /\/console\/postgres$/)
    await expect(page.getByRole('heading', { name: /inventario relacional del tenant activo/i })).toBeVisible()

    await openConsoleSectionWithWorkspace(page, '/console/mongo', /\/console\/mongo$/)
    await expect(page.getByRole('heading', { name: /inventario documental del tenant activo/i })).toBeVisible()

    await openConsoleSectionWithWorkspace(page, '/console/kafka', /\/console\/kafka$/)
    await expect(page.getByRole('heading', { name: /kafka \/ events/i })).toBeVisible()

    await openConsoleSectionWithWorkspace(page, '/console/functions', /\/console\/functions$/)
    await expect(page.getByRole('heading', { name: /consola de funciones/i })).toBeVisible()

    await openConsoleSectionWithWorkspace(page, '/console/storage', /\/console\/storage$/)
    await expect(page.getByRole('heading', { name: /storage \/ objetos/i })).toBeVisible()

    expect(interceptedUrls.length).toBeGreaterThan(0)
    assertPublicApiOnly(interceptedUrls, 'transversal')
  })
})
