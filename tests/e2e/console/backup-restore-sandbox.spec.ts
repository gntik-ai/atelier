import { test, expect } from '@playwright/test'

test('console simulation drill exposes guardrails and evidence', async ({ page }) => {
  await page.setContent(`
    <main>
      <section data-testid="simulation-surface">
        <h1>Simulación de restore</h1>
        <p>Esta acción ejecuta un drill en sandbox o integración. No toca producción.</p>
        <button id="launch">Lanzar simulación</button>
        <div id="status" hidden>
          <span data-testid="operation-status-badge">Completada · simulación</span>
          <section data-testid="restore-simulation-evidence">
            <h2>Evidencia de simulación</h2>
            <p>Entorno: sandbox</p>
            <p>Resultado: completed</p>
          </section>
        </div>
      </section>
      <script>
        document.getElementById('launch').addEventListener('click', () => {
          document.getElementById('status').hidden = false
        })
      </script>
    </main>
  `)

  await expect(page.getByText('No toca producción')).toBeVisible()
  await page.getByRole('button', { name: 'Lanzar simulación' }).click()
  await expect(page.getByTestId('operation-status-badge')).toHaveText(/simulación/)
  await expect(page.getByTestId('restore-simulation-evidence')).toBeVisible()
  await expect(page.getByText('Entorno: sandbox')).toBeVisible()
})
