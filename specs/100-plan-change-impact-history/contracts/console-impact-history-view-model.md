# Console view-model contract — plan change impact history

## Admin history timeline row

- `historyEntryId`
- `effectiveAt`
- `actorDisplay`
- `previousPlanLabel`
- `newPlanLabel`
- `changeDirection`
- `overLimitDimensionCount`
- `usageCollectionStatus`
- `correlationId`
- `changeReason` (shown only to authorized internal roles if policy allows)

## Admin drilldown payload

- `summary`: plan ids/labels, actor, timestamps, reason, correlation
- `quotaImpacts[]`: all dimensions, including unchanged ones
- `capabilityImpacts[]`: all capabilities, including unchanged ones
- `badges`: counts for increased/decreased/unchanged and over-limit dimensions

## Tenant-owner current summary model

- `planDisplayName`
- `effectiveFrom`
- `latestPlanChangeAt`
- `quotaDimensions[]` with `effectiveValue`, `observedUsage`, `usageStatus`
- `capabilities[]` with enabled/disabled state
- `infoBanner` when one or more dimensions are `over_limit`

## UI behavior requirements

- Preserve ordering of dimensions using catalog order where available.
- Render `unknown` usage distinctly from `within_limit`.
- Render `unlimited` distinctly from numeric values.
- Never hide unchanged dimensions in the detailed snapshot view.
