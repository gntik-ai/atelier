interface BackupNotAvailableProps {
  message?: string
}

export function BackupNotAvailable({
  message = 'La visibilidad de estado de backup no está disponible para su plan actual.',
}: BackupNotAvailableProps) {
  return (
    <div
      className="rounded-lg border border-dashed p-6 text-center text-muted-foreground"
      data-testid="backup-not-available"
    >
      <p>{message}</p>
    </div>
  )
}
