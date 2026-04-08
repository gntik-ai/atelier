# Helm Configuration

Complete reference for configuring In Falcone's Helm umbrella chart.

## Global Settings

```yaml
global:
  namespace: in-falcone-dev        # Target namespace
  domain: in-falcone.example.com   # Base domain
  environment: dev                 # Environment name
  imageRegistry: ""                # Override all image registries (airgap)
  imagePullSecrets: []             # Image pull secrets
  podSecurityStandard: restricted  # Pod security level
  tlsMode: clusterManaged          # TLS mode (clusterManaged | external)
```

## Component Configuration

Each component follows a common structure via the `component-wrapper` subchart:

```yaml
<component>:
  enabled: true                    # Enable/disable the component
  wrapper:
    componentId: <name>            # Logical component name
  image:
    repository: <registry/image>   # Container image
    tag: <version>                 # Image tag
    pullPolicy: IfNotPresent       # Pull policy
  replicas: 1                      # Replica count
  service:
    port: 8080                     # Service port
    type: ClusterIP                # Service type
  resources:
    requests:
      cpu: 200m
      memory: 256Mi
    limits:
      cpu: "1"
      memory: 1Gi
  env: []                          # Extra environment variables
  envFromSecrets: []               # Environment from Secrets
  envFromConfigMaps: []            # Environment from ConfigMaps
  persistence:
    enabled: false                 # Enable PVC
    size: 10Gi                     # Volume size
    storageClass: ""               # Storage class
    mountPath: /data               # Mount path
  podSecurityContext:
    runAsNonRoot: true
    fsGroup: 1001
    seccompProfile:
      type: RuntimeDefault
  securityContext:
    allowPrivilegeEscalation: false
    capabilities:
      drop: [ALL]
  nodeSelector: {}
  tolerations: []
  affinity: {}
  podAnnotations: {}
  podLabels: {}
```

## Component-Specific Settings

### APISIX

```yaml
apisix:
  image:
    repository: docker.io/apache/apisix
    tag: "3.10.0"
  replicas: 2
  ports:
    - name: http
      containerPort: 9080
    - name: admin
      containerPort: 9180
  env:
    - name: APISIX_STAND_ALONE
      value: "true"
```

### Keycloak

```yaml
keycloak:
  image:
    repository: quay.io/keycloak/keycloak
    tag: "26.1.0"
  replicas: 1
  ports:
    - name: http
      containerPort: 8080
  env:
    - name: KC_HOSTNAME_STRICT
      value: "false"
    - name: KC_HTTP_ENABLED
      value: "true"
```

### PostgreSQL

```yaml
postgresql:
  image:
    repository: docker.io/bitnami/postgresql
    tag: "17.2.0"
  workload:
    kind: StatefulSet
  persistence:
    enabled: true
    size: 20Gi
    mountPath: /bitnami/postgresql
  env:
    - name: POSTGRESQL_DATABASE
      value: falcone
```

### MongoDB

```yaml
mongodb:
  image:
    repository: docker.io/bitnami/mongodb
    tag: "8.0.0"
  workload:
    kind: StatefulSet
  persistence:
    enabled: true
    size: 20Gi
    mountPath: /bitnami/mongodb
```

### Kafka

```yaml
kafka:
  image:
    repository: docker.io/bitnami/kafka
    tag: "3.9.0"
  workload:
    kind: StatefulSet
  replicas: 3
  persistence:
    enabled: true
    size: 50Gi
    mountPath: /bitnami/kafka
  env:
    - name: KAFKA_CFG_AUTO_CREATE_TOPICS_ENABLE
      value: "false"
```

## Public Surface

Configure how the platform is exposed externally:

### Ingress Mode

```yaml
publicSurface:
  mode: ingress
  ingress:
    className: nginx
    annotations: {}
    tls:
      mode: clusterManaged
    surfaces:
      api:
        host: api.dev.in-falcone.example.com
        targetService: in-falcone-apisix
        targetPort: 9080
      console:
        host: console.dev.in-falcone.example.com
        targetService: in-falcone-web-console
        targetPort: 3000
      identity:
        host: identity.dev.in-falcone.example.com
        targetService: in-falcone-keycloak
        targetPort: 8080
      realtime:
        host: realtime.dev.in-falcone.example.com
        targetService: in-falcone-apisix
        targetPort: 9080
```

### OpenShift Route Mode

```yaml
publicSurface:
  mode: route
  route:
    tls:
      termination: edge
      insecureEdgeTerminationPolicy: Redirect
    annotations:
      haproxy.router.openshift.io/timeout: 30s
```

### LoadBalancer Mode

```yaml
publicSurface:
  mode: loadBalancer
  loadBalancer:
    tls:
      mode: external
    externalTrafficPolicy: Cluster
    sourceRanges: []
```

## Bootstrap Configuration

```yaml
bootstrap:
  enabled: true
  oneShot:
    keycloak:
      realm:
        id: in-falcone-platform
        displayName: "In Falcone Platform"
      roles:
        - superadmin
        - platform_admin
        - platform_operator
      clientScopes:
        - tenant-context
        - workspace-context
        - plan-context
        - workspace-roles
      clients:
        gateway:
          clientId: in-falcone-gateway
          clientType: bearer-only
        console:
          clientId: in-falcone-console
          clientType: public
    governance:
      plans:
        - { name: starter, ... }
        - { name: growth, ... }
        - { name: regulated, ... }
        - { name: enterprise, ... }
  reconcile:
    apisix:
      routes: [...]               # Declarative APISIX routes
```

## Gateway Policy

```yaml
gatewayPolicy:
  oidc:
    discoveryUrl: http://keycloak:8080/realms/in-falcone-platform/.well-known/openid-configuration
    clientId: in-falcone-gateway
  cors:
    allowOrigins: [...]
    allowMethods: [...]
    maxAge: 3600
  rateLimiting:
    profiles:
      platform_control:
        rate: 240
        burst: 60
        window: 60
      # ... more profiles
  requestValidation:
    requiredHeaders:
      - X-API-Version
      - X-Correlation-Id
    maxBodySize: 262144
  idempotency:
    keyHeader: Idempotency-Key
    ttl: 86400
```

## Vault & ESO

```yaml
vault:
  enabled: true
  image:
    repository: docker.io/hashicorp/vault
    tag: "1.15.0"
  persistence:
    enabled: true
    size: 5Gi

eso:
  enabled: true
  clusterSecretStore:
    vaultUrl: http://in-falcone-vault:8200
    vaultPath: secret
```

## Validation Scripts

Validate your configuration before deploying:

```bash
# Validate the entire chart
pnpm run validate:deployment-topology

# Validate specific aspects
pnpm run validate:structure           # Monorepo structure
pnpm run validate:image-policy        # Image tags and registries
pnpm run validate:gateway-policy      # APISIX route rules
pnpm run validate:authorization-model # Auth model correctness
pnpm run validate:domain-model        # Domain entity constraints
pnpm run validate:service-map         # Service dependency graph
```
