# Design

The chart renders six ImageStreams and Docker BuildConfigs when `global.openshiftBuild.enabled` is true. Deployment images and runtime image references use internal ImageStreamTags; default registry behavior is unchanged. Helm owns the initial image field and the OpenShift image-trigger controller owns subsequent digest updates. GitLab webhook authentication uses a Secret reference and Project RBAC controls sourceSecret access. The documentation supplies prerequisites, values, registration, verification and rollback without claiming live evidence.
