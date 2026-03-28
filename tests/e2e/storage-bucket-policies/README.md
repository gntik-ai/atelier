# Storage bucket policies E2E scenario matrix

This directory intentionally stores a static scenario matrix for `US-STO-02-T02`.
No live provider I/O is introduced in this task.

## Covered scenarios

1. **Bucket policy allow/deny**
   - viewer can `object.get`
   - viewer cannot `object.put` or `object.delete`
   - deny wins when both allow and deny match

2. **Workspace default fallback**
   - no bucket policy present
   - workspace default governs `object.put`, `object.list`, and `object.head`

3. **Tenant template inheritance**
   - tenant owner defines a template
   - new workspace receives the template as its initial workspace default
   - later tenant template changes do not mutate previously seeded workspace defaults

4. **Service-account evaluation**
   - service account principal can be explicitly granted `object.put`
   - role-derived service account permissions are honored
   - non-granted actions remain denied

5. **Superadmin override**
   - override policy temporarily supersedes the bucket policy
   - original policy reference remains preserved for restoration

6. **Presigned URL generation-time evaluation**
   - `presigned.generate_download` and `presigned.generate_upload` are checked at URL generation time
   - already-issued URLs are outside the scope of this task's pure evaluator

7. **Multipart per-operation evaluation**
   - `multipart.initiate`
   - `multipart.upload_part`
   - `multipart.complete`
   - `multipart.abort`
   - `multipart.list`

8. **Isolation rejection vs policy denial**
   - cross-tenant/cross-workspace rejection occurs before policy evaluation
   - policy denial only applies after isolation succeeds

9. **Policy mutation auditing**
   - attach
   - update
   - detach
   - override
   - remove override
   - events sanitize URL-like and secret-reference substrings
