import { describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { render, screen } from '@testing-library/react'
import { ConsoleDocsPage } from '@/pages/ConsoleDocsPage'

vi.mock('@/lib/console-workspace-docs', async () => ({
  fetchWorkspaceDocs: vi.fn().mockResolvedValue({
    workspaceId: 'wrk-1',
    tenantId: 'ten-1',
    generatedAt: new Date().toISOString(),
    baseUrl: 'https://api.example.test',
    authInstructions: { method: 'bearer_oidc', tokenEndpoint: 'https://iam.example.test/token', clientIdPlaceholder: '<YOUR_CLIENT_ID>', clientSecretPlaceholder: '<YOUR_CLIENT_SECRET>', scopeHint: 'openid', consoleRef: 'Settings' },
    enabledServices: [],
    customNotes: []
  }),
  createDocNote: vi.fn(),
  updateDocNote: vi.fn(),
  deleteDocNote: vi.fn()
}))

describe('ConsoleDocsPage', () => {
  it('renders fetched sections', async () => {
    const client = new QueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/console/workspaces/wrk-1/docs']}>
          <Routes>
            <Route path="/console/workspaces/:workspaceId/docs" element={<ConsoleDocsPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )

    expect(await screen.findByText(/Documentación del workspace/i)).toBeInTheDocument()
    expect(screen.getByText(/Autenticación/i)).toBeInTheDocument()
  })
})
