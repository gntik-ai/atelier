import { type ChangeEvent } from 'react'

import type { ConsoleMetricRange } from '@/lib/console-metrics'

export function ConsoleTimeRangeSelector({ value, onChange }: { value: ConsoleMetricRange; onChange: (value: ConsoleMetricRange) => void }) {
  function handlePresetChange(event: ChangeEvent<HTMLSelectElement>) {
    const preset = event.target.value as ConsoleMetricRange['preset']
    onChange({ preset, from: preset === 'custom' ? value.from : undefined, to: preset === 'custom' ? value.to : undefined })
  }

  return (
    <fieldset className="space-y-3 rounded-2xl border border-border bg-card/50 p-4">
      <legend className="text-sm font-medium">Rango temporal</legend>
      <label className="block text-sm">
        <span className="mb-1 block">Preset</span>
        <select aria-label="Rango temporal" value={value.preset} onChange={handlePresetChange} className="w-full rounded-xl border border-input bg-background px-3 py-2">
          <option value="24h">24h</option>
          <option value="7d">7d</option>
          <option value="30d">30d</option>
          <option value="custom">custom</option>
        </select>
      </label>
      {value.preset === 'custom' ? (
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block">Desde</span>
            <input aria-label="Desde" type="datetime-local" value={value.from ?? ''} onChange={(event) => onChange({ ...value, from: event.target.value })} className="w-full rounded-xl border border-input bg-background px-3 py-2" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block">Hasta</span>
            <input aria-label="Hasta" type="datetime-local" value={value.to ?? ''} onChange={(event) => onChange({ ...value, to: event.target.value })} className="w-full rounded-xl border border-input bg-background px-3 py-2" />
          </label>
        </div>
      ) : null}
    </fieldset>
  )
}
