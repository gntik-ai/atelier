import { test, expect } from '@playwright/test'

test('workspace docs page smoke', async ({ page }) => {
  await page.goto('/console/workspaces/wrk-1/docs')
  await expect(page.getByText(/Documentación del workspace/i)).toBeVisible()
})
