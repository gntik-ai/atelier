# Console component contracts

Reference contracts for the console-facing plan-management components.

## PlanStatusBadge

- Props: `status: 'draft' | 'active' | 'deprecated' | 'archived'`
- Renders visible text label and color-coded badge.

## PlanCapabilityBadge

- Props: `enabled: boolean`, `label?: string`
- Renders accessible enabled/disabled state via text and `aria-label`.

## PlanLimitsTable

- Props: `dimensions`, `editable`, `onUpdate?`, `onRemove?`
- Supports explicit numeric values, inherited defaults, and unlimited (`-1`).

## PlanComparisonView

- Props: `currentPlan`, `targetPlan`
- Renders side-by-side comparison with `increased`, `decreased`, `unchanged` markers.

## PlanAssignmentDialog

- Props: `open`, `tenantId`, `activePlans`, `currentPlanId`, `onConfirm`, `onCancel`
- Only active plans may be selectable.

## PlanHistoryTable

- Props: `items`, `page`, `pageSize`, `total`, `onPageChange?`
- Displays `Current` when `supersededAt` is null.
