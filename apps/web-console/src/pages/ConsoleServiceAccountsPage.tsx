import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { ConsoleCredentialStatusBadge } from '@/components/console/ConsoleCredentialStatusBadge'
import { ConsolePageState } from '@/components/console/ConsolePageState'
import {
  createServiceAccount,
  issueServiceAccountCredential,
  revokeServiceAccountCredential,
  rotateServiceAccountCredential,
  useConsoleServiceAccounts,
  type ConsoleIssuedCredential
} from '@/lib/console-service-accounts'
import { useConsoleContext } from '@/lib/console-context'
import { readConsoleShellSession } from '@/lib/console-session'

export function ConsoleServiceAccountsPage() {
  const { activeTenant, activeTenantId, activeWorkspace, activeWorkspaceId } = useConsoleContext()
  const { accounts, loading, error, reload, knownIds } = useConsoleServiceAccounts(activeWorkspaceId)
  const [displayName, setDisplayName] = useState('')
  const [feedback, setFeedback] = useState<string | null>(null)
  const [issuedCredential, setIssuedCredential] = useState<ConsoleIssuedCredential | null>(null)
  const session = readConsoleShellSession()
  const principalUserId = session?.principal?.userId ?? 'unknown-user'
  const writesBlocked = activeTenant?.state !== 'active'
  const isEmpty = !loading && !error && knownIds.length === 0

  const header = useMemo(() => [activeTenant?.label, activeWorkspace?.label].filter(Boolean).join(' · '), [activeTenant?.label, activeWorkspace?.label])

  if (!activeTenantId) {
    return <ConsolePageState kind="blocked" title="Service accounts bloqueadas" description="Selecciona un tenant para continuar." />
  }
  if (!activeWorkspaceId) {
    return <ConsolePageState kind="blocked" title="Service accounts bloqueadas" description="Selecciona un workspace para gestionar credenciales." />
  }

  const workspaceId = activeWorkspaceId

  async function handleCreate() {
    const result = await createServiceAccount(workspaceId, { displayName, entityType: 'service_account', desiredState: 'active' })
    setFeedback(`Service account creada: ${result.serviceAccountId}`)
    setDisplayName('')
    reload()
  }

  async function handleIssue(serviceAccountId: string) {
    const credential = await issueServiceAccountCredential(workspaceId, serviceAccountId, { requestedByUserId: principalUserId })
    setIssuedCredential(credential)
    reload()
  }

  async function handleRevoke(serviceAccountId: string) {
    await revokeServiceAccountCredential(workspaceId, serviceAccountId, { reason: 'Console revoke' })
    setFeedback('Credencial revocada.')
    reload()
  }

  async function handleRotate(serviceAccountId: string) {
    const credential = await rotateServiceAccountCredential(workspaceId, serviceAccountId, { reason: 'Console rotate' })
    setIssuedCredential(credential)
    reload()
  }

  return (
    <section className="space-y-6">
      <header className="rounded-3xl border border-border bg-card/70 p-6">
        <p className="text-sm text-muted-foreground">{header || 'Workspace activo'}</p>
        <h1 className="text-2xl font-semibold tracking-tight">Service Accounts</h1>
        {writesBlocked ? <p className="mt-2 text-sm text-amber-700">El tenant no está activo; las acciones de escritura están deshabilitadas.</p> : null}
      </header>

      <section className="rounded-3xl border border-border bg-card/70 p-6">
        <h2 className="text-lg font-semibold">Crear service account</h2>
        <div className="mt-4 flex flex-col gap-3 md:flex-row">
          <input aria-label="Nombre de service account" value={displayName} onChange={(event) => setDisplayName(event.target.value)} className="flex-1 rounded-xl border border-input bg-background px-3 py-2" />
          <Button type="button" onClick={() => void handleCreate()} disabled={writesBlocked || !displayName.trim()}>Crear</Button>
        </div>
        {feedback ? <p className="mt-3 text-sm text-emerald-700">{feedback}</p> : null}
      </section>

      {loading ? <ConsolePageState kind="loading" title="Cargando service accounts" description="Rehidratando las fichas conocidas del workspace." /> : null}
      {error ? <ConsolePageState kind="error" title="No se pudieron cargar las service accounts" description={error} actionLabel="Reintentar" onAction={reload} /> : null}
      {isEmpty ? <ConsolePageState kind="empty" title="No hay service accounts conocidas todavía en este navegador" description="Crea una nueva para empezar; el listado global llegará cuando exista un endpoint dedicado." /> : null}

      {accounts.length > 0 ? (
        <div className="overflow-hidden rounded-3xl border border-border bg-card/70">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3">Nombre</th>
                <th className="px-4 py-3">Cliente</th>
                <th className="px-4 py-3">Credencial</th>
                <th className="px-4 py-3">Acceso</th>
                <th className="px-4 py-3">Expira</th>
                <th className="px-4 py-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.serviceAccountId} className="border-b border-border/60">
                  <td className="px-4 py-3">{account.displayName ?? account.serviceAccountId}</td>
                  <td className="px-4 py-3">{account.accessProjection?.clientState ?? account.desiredState ?? 'unknown'}</td>
                  <td className="px-4 py-3"><ConsoleCredentialStatusBadge status={account.credentialStatus?.state} /></td>
                  <td className="px-4 py-3">{account.accessProjection?.effectiveAccess ?? 'unknown'}</td>
                  <td className="px-4 py-3">{account.expiresAt ?? '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" size="sm" disabled={writesBlocked} onClick={() => void handleIssue(account.serviceAccountId)}>Emitir</Button>
                      <Button type="button" variant="outline" size="sm" disabled={writesBlocked} onClick={() => void handleRevoke(account.serviceAccountId)}>Revocar</Button>
                      <Button type="button" variant="outline" size="sm" disabled={writesBlocked} onClick={() => void handleRotate(account.serviceAccountId)}>Rotar</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {issuedCredential ? (
        <div role="dialog" aria-label="Credencial emitida" className="rounded-3xl border border-border bg-card/70 p-6">
          <h2 className="text-lg font-semibold">Secreto visible una sola vez</h2>
          <p className="mt-2 text-sm text-muted-foreground">Cópialo ahora: no podrá recuperarse después de cerrar este panel.</p>
          <pre className="mt-4 overflow-x-auto rounded-xl bg-background p-4">{issuedCredential.secret}</pre>
          <div className="mt-4 flex gap-3">
            <Button type="button" variant="outline" onClick={() => navigator.clipboard?.writeText(issuedCredential.secret)}>Copiar</Button>
            <Button type="button" onClick={() => setIssuedCredential(null)}>Cerrar</Button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
