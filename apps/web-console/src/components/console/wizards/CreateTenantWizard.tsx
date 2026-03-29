import { useState } from 'react'

import { ConsolePageState } from '@/components/console/ConsolePageState'
import { WizardShell } from '@/components/console/wizards/WizardShell'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { useWizardPermissionCheck, useWizardQuotaCheck, createValidation, submitWizardRequest, type WizardStepProps } from '@/lib/console-wizards'

interface TenantData { name: string; planId: string; region: string; locale: string }

function NameStep({ data, onChange, validation }: WizardStepProps<TenantData>) {
  return <div className="space-y-2"><Label htmlFor="tenant-name">Nombre del tenant</Label><Input id="tenant-name" value={data.name ?? ''} onChange={(e) => onChange({ name: e.target.value })} />{validation.fieldErrors.name ? <p className="text-sm text-destructive">{validation.fieldErrors.name}</p> : null}</div>
}
function PlanStep({ data, onChange, validation }: WizardStepProps<TenantData>) {
  return <div className="space-y-2"><Label htmlFor="tenant-plan">Plan</Label><Select id="tenant-plan" value={data.planId ?? ''} onChange={(e) => onChange({ planId: e.target.value })}><option value="">Selecciona un plan</option><option value="starter">Starter</option><option value="growth">Growth</option></Select>{validation.blockingError ? <p className="text-sm text-destructive">{validation.blockingError}</p> : null}</div>
}
function RegionStep({ data, onChange, validation }: WizardStepProps<TenantData>) {
  return <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="tenant-region">Región</Label><Select id="tenant-region" value={data.region ?? ''} onChange={(e) => onChange({ region: e.target.value })}><option value="">Selecciona una región</option><option value="eu-west">EU West</option><option value="us-east">US East</option></Select>{validation.fieldErrors.region ? <p className="text-sm text-destructive">{validation.fieldErrors.region}</p> : null}</div><div className="space-y-2"><Label htmlFor="tenant-locale">Locale</Label><Select id="tenant-locale" value={data.locale ?? 'es'} onChange={(e) => onChange({ locale: e.target.value })}><option value="es">es</option><option value="en">en</option></Select></div></div>
}

export function CreateTenantWizard({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated?: () => void }) {
  const permission = useWizardPermissionCheck('create_tenant')
  const quota = useWizardQuotaCheck('tenants.count', 'tenant', 'platform', null)
  const [openBlocked, setOpenBlocked] = useState(false)
  if (!permission.allowed && (open || openBlocked)) return <ConsolePageState kind="blocked" title="Acceso bloqueado" description={permission.reason ?? 'No permitido.'} actionLabel="Cerrar" onAction={() => { setOpenBlocked(false); onOpenChange(false) }} />
  return <WizardShell<TenantData>
    open={open}
    onOpenChange={onOpenChange}
    title="Nuevo tenant"
    description="Alta guiada de tenant administrativo."
    context={{ tenantId: null, workspaceId: null, principalRoles: [] }}
    initialData={{ locale: 'es' }}
    steps={[
      { id: 'name', label: 'Nombre', component: NameStep, validate: (data) => createValidation(!data.name?.trim() ? { name: 'El nombre es obligatorio.' } : {}) },
      { id: 'plan', label: 'Plan', component: PlanStep, validate: (data) => createValidation(!data.planId ? { planId: 'Selecciona un plan.' } : {}, quota.available ? undefined : quota.reason ?? 'Sin cuota disponible.') },
      { id: 'region', label: 'Región', component: RegionStep, validate: (data) => createValidation(!data.region ? { region: 'Selecciona una región.' } : {}) }
    ]}
    buildSummary={(data) => [
      { label: 'Nombre', value: data.name ?? '' },
      { label: 'Plan', value: data.planId ?? '' },
      { label: 'Región', value: data.region ?? '' },
      { label: 'Locale', value: data.locale ?? 'es' }
    ]}
    onSubmit={async (data) => {
      const response = await submitWizardRequest<{ tenantId: string; tenantSlug?: string }>('/v1/admin/tenants', { name: data.name ?? '', planId: data.planId ?? '', region: data.region ?? '', preferences: { locale: data.locale ?? 'es' } })
      onCreated?.()
      return { resourceId: response.tenantId, resourceUrl: '/console/tenants' }
    }}
  />
}
