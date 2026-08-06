# Proposal: OpenShift build-from-source documentation

Issue #922 needs an operator-complete path for chart 0.4.0 source builds. Scope spans the
falcone-charts contract and Falcone documentation; vanilla Kubernetes, Tekton and path filtering
are non-goals. `global` is required because Helm globals propagate into aliased component charts.
The Helm image field remains stable while OpenShift image triggers own post-build updates.
Webhook secrets and source credentials stay in Project Secrets; rollback is `enabled=false`, which
restores prebuilt images and removes Build API objects. Risks are build load, registry trust and
RBAC; mitigations are explicit checks and secret-safe procedures.
