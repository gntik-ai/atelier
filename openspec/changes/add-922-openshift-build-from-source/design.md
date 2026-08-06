# Design

The chart renders six ImageStreams and Docker BuildConfigs when `global.openshiftBuild.enabled` is true. Deployment images and runtime image references use internal ImageStreamTags; default registry behavior is unchanged.
