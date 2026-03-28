# Storage Event Notifications — Static E2E Scenario Matrix

## Positive scenarios

1. Kafka topic rule for `object.created` on bucket `assets` matches `uploads/logo.png` and produces one delivery preview.
2. OpenWhisk action rule for `multipart.completed` matches a completed multipart object and produces one delivery preview.
3. Two active rules match the same object-created event and produce two delivery previews in stable order.

## Governance and degradation scenarios

1. Provider profile omits `bucket.event_notifications` and rule creation is rejected with `CAPABILITY_NOT_AVAILABLE`.
2. Governance profile does not allow `openwhisk_action` and rule creation is rejected with `DESTINATION_NOT_ALLOWED`.
3. Tenant/workspace rule limits are exhausted and rule creation is rejected with `RULE_LIMIT_EXCEEDED`.

## Matching edge cases

1. Prefix filter matches but suffix filter fails; no delivery preview is produced.
2. Bucket scope differs; no delivery preview is produced.
3. Disabled rule is ignored during evaluation.

## Audit evidence

1. Rule lifecycle audit events include action, rule ID, bucket scope, destination type, actor, and correlation metadata.
2. Audit payloads do not serialize raw URLs, secret references, or credential-like values.
