const PROFILES = [
  { key: 'all-in-one', label: 'All-in-One' },
  { key: 'standard', label: 'Standard' },
  { key: 'ha', label: 'HA' },
  { key: 'all', label: 'All' }
]

export function BackupScopeProfileSelector({ value, onChange }: { value: string; onChange: (profile: string) => void }) {
  return (
    <div className="flex gap-1 rounded-lg border border-border p-1" data-testid="profile-selector">
      {PROFILES.map((profile) => (
        <button
          key={profile.key}
          type="button"
          onClick={() => onChange(profile.key)}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            value === profile.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'
          }`}
          data-testid={`profile-tab-${profile.key}`}
        >
          {profile.label}
        </button>
      ))}
    </div>
  )
}
