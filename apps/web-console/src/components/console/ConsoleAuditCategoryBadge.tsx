import { Badge } from '@/components/ui/badge'

export function ConsoleAuditCategoryBadge({ category }: { category: string }) {
  return <Badge variant="outline">{category.replace(/_/g, ' ')}</Badge>
}
