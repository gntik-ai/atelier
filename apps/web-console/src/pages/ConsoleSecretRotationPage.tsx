import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'

import { getConsumerStatus, initiateRotation, listRotationHistory } from '@/actions/secretRotationActions'

function StatusBadge({ state }: { state: string }) {
  const tone = useMemo(() => {
    if (state === 'confirmed') return 'bg-green-100 text-green-800'
    if (state === 'timeout') return 'bg-red-100 text-red-800'
    if (state === 'pending') return 'bg-yellow-100 text-yellow-800'
    return 'bg-slate-100 text-slate-800'
  }, [state])

  return <span className={`rounded px-2 py-1 text-xs ${tone}`}>{state}</span>
}

export function ConsoleSecretRotationPage() {
  const { encodedSecretPath = '' } = useParams()
  const secretPath = decodeURIComponent(encodedSecretPath)
  const [gracePeriodSeconds, setGracePeriodSeconds] = useState(1800)
  const [justification, setJustification] = useState('')
  const [newValue, setNewValue] = useState('')
  const [history, setHistory] = useState<any[]>([])
  const [consumers, setConsumers] = useState<any[]>([])

  useEffect(() => {
    let cancelled = false
    listRotationHistory(secretPath, { limit: 20, offset: 0 }).then((data) => {
      if (!cancelled) setHistory(data.items ?? [])
    }).catch(() => {})
    return () => { cancelled = true }
  }, [secretPath])

  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      try {
        const data = await getConsumerStatus(secretPath)
        if (!active) return
        setConsumers(data.consumers ?? [])
        const done = (data.consumers ?? []).length > 0 && (data.consumers ?? []).every((item) => item.state === 'confirmed' || item.state === 'timeout')
        if (!done) timer = setTimeout(tick, 5000)
      } catch {
        if (active) timer = setTimeout(tick, 5000)
      }
    }
    void tick()
    return () => {
      active = false
      if (timer) clearTimeout(timer)
    }
  }, [secretPath])

  return (
    <section className="space-y-6 p-4">
      <header>
        <h1 className="text-2xl font-semibold">Rotate secret</h1>
        <p className="text-sm text-slate-600">{secretPath}</p>
      </header>

      <div className="rounded border bg-white p-4">
        <h2 className="text-lg font-medium">Rotation form</h2>
        <div className="mt-4 grid gap-4">
          <label className="grid gap-2">
            <span>Grace period (seconds)</span>
            <input aria-label="Grace period slider" type="range" min={300} max={86400} value={gracePeriodSeconds} onChange={(event) => setGracePeriodSeconds(Number(event.target.value))} />
            <input aria-label="Grace period input" type="number" min={300} max={86400} value={gracePeriodSeconds} onChange={(event) => setGracePeriodSeconds(Number(event.target.value))} className="rounded border p-2" />
          </label>
          <label className="grid gap-2">
            <span>Justification</span>
            <textarea aria-label="Justification" required className="rounded border p-2" value={justification} onChange={(event) => setJustification(event.target.value)} />
          </label>
          <label className="grid gap-2">
            <span>New value</span>
            <input aria-label="New value" type="password" className="rounded border p-2" value={newValue} onChange={(event) => setNewValue(event.target.value)} />
          </label>
          <div>
            <button className="rounded bg-blue-600 px-3 py-2 text-white" onClick={async () => {
              await initiateRotation(secretPath, { gracePeriodSeconds, justification, newValue })
            }}>Submit rotation</button>
          </div>
        </div>
      </div>

      <div className="rounded border bg-white p-4">
        <h2 className="text-lg font-medium">Rotation history</h2>
        <table className="mt-3 min-w-full text-sm">
          <thead>
            <tr>
              <th className="px-2 py-1 text-left">Event</th>
              <th className="px-2 py-1 text-left">Actor</th>
              <th className="px-2 py-1 text-left">Timestamp</th>
              <th className="px-2 py-1 text-left">Version new</th>
              <th className="px-2 py-1 text-left">Version old</th>
            </tr>
          </thead>
          <tbody>
            {history.map((item, index) => (
              <tr key={index} className="border-t">
                <td className="px-2 py-1">{String(item.event_type ?? item.eventType ?? '—')}</td>
                <td className="px-2 py-1">{String(item.actor_id ?? item.actorId ?? '—')}</td>
                <td className="px-2 py-1">{String(item.occurred_at ?? item.occurredAt ?? '—')}</td>
                <td className="px-2 py-1">{String(item.vault_version_new ?? item.vaultVersionNew ?? '—')}</td>
                <td className="px-2 py-1">{String(item.vault_version_old ?? item.vaultVersionOld ?? '—')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded border bg-white p-4">
        <h2 className="text-lg font-medium">Consumer status</h2>
        <div className="mt-3 space-y-2">
          {consumers.map((consumer) => (
            <div key={consumer.consumer_id} className="flex items-center justify-between rounded border p-3 text-sm">
              <div>
                <div className="font-medium">{consumer.consumer_id}</div>
                <div className="text-slate-600">{consumer.reload_mechanism}</div>
              </div>
              <StatusBadge state={consumer.state} />
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export { StatusBadge }
