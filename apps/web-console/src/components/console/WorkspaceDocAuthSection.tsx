import type { WorkspaceDocsResponse } from '@/lib/console-workspace-docs'

interface Props {
  authInstructions: WorkspaceDocsResponse['authInstructions']
}

export function WorkspaceDocAuthSection({ authInstructions }: Props) {
  return (
    <section aria-label="Authentication instructions" className="rounded-lg border p-4 space-y-2">
      <h2 className="text-lg font-semibold">Autenticación</h2>
      <p>Método: <strong>{authInstructions.method}</strong></p>
      {authInstructions.tokenEndpoint ? <p>Token endpoint: {authInstructions.tokenEndpoint}</p> : null}
      <p>Client ID: {authInstructions.clientIdPlaceholder}</p>
      <p>Client secret: {authInstructions.clientSecretPlaceholder}</p>
      <p>Scopes: {authInstructions.scopeHint}</p>
      <p>Referencia en consola: {authInstructions.consoleRef}</p>
    </section>
  )
}
