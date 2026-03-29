import { Badge } from '@/components/ui/badge'

export function ConsoleCredentialStatusBadge({ status }: { status: string | null | undefined }) {
  return <Badge variant="outline">{status ?? 'unknown'}</Badge>
}
