# Instalación en OpenShift

Esta guía describe una instalación operativa del paraguas Helm `charts/in-falcone` centrada en OpenShift, con la paridad equivalente para Kubernetes cuando el despliegue no usa `Route`.

Si buscas una versión más corta para salir del paso rápidamente, consulta primero [Inicio rápido](./quickstart.md).

## Qué vas a desplegar

El repositorio organiza el despliegue por capas:

1. `charts/in-falcone/values.yaml` — valores comunes
2. `charts/in-falcone/values/profiles/<profile>.yaml` — perfil (`all-in-one`, `standard`, `ha`)
3. `charts/in-falcone/values/<environment>.yaml` — entorno (`dev`, `staging`, `prod`, etc.)
4. `charts/in-falcone/values/customer-reference.yaml` — sobreescrituras de cliente/tenant
5. `charts/in-falcone/values/platform-openshift.yaml` o `platform-kubernetes.yaml`
6. `charts/in-falcone/values/airgap.yaml` cuando haya registro privado / entorno aislado
7. `values/local.yaml` solo para pruebas locales no versionadas

OpenShift usa `Route` y `securityProfile: restricted-v2`; Kubernetes usa `Ingress` y `securityProfile: restricted`.

## Requisitos previos

- Cluster OpenShift 4.x con permisos para crear namespace, `ConfigMap`, `Secret`, `Job`, `Route` y recursos del chart.
- `helm` 3.x.
- `oc` instalado para validación y troubleshooting; `kubectl` sirve como equivalente en Kubernetes.
- Acceso a los secretos de arranque de Keycloak y APISIX que consume el bootstrap one-shot.
- DNS o dominio interno preparado para las rutas públicas del paraguas.

## 1. Preparar el namespace

```bash
oc new-project in-falcone-staging
```

Si el namespace ya existe, basta con seleccionarlo:

```bash
oc project in-falcone-staging
```

En Kubernetes, el equivalente es:

```bash
kubectl create namespace in-falcone-staging
kubectl config set-context --current --namespace=in-falcone-staging
```

## 2. Construir dependencias del chart

Desde la raíz del repositorio:

```bash
helm dependency build charts/in-falcone
```

Si cambiaste dependencias o wrappers, vuelve a ejecutar este paso antes de instalar.

## 3. Elegir el stack de valores

Para OpenShift, el stack mínimo recomendado para un despliegue estándar es:

```text
charts/in-falcone/values.yaml
charts/in-falcone/values/profiles/standard.yaml
charts/in-falcone/values/staging.yaml
charts/in-falcone/values/platform-openshift.yaml
```

Para Kubernetes, sustituye el overlay de plataforma por `platform-kubernetes.yaml`.

## 4. Instalar en OpenShift

Ejemplo de instalación estándar:

```bash
helm upgrade --install in-falcone charts/in-falcone \
  --namespace in-falcone-staging \
  --create-namespace \
  -f charts/in-falcone/values.yaml \
  -f charts/in-falcone/values/profiles/standard.yaml \
  -f charts/in-falcone/values/staging.yaml \
  -f charts/in-falcone/values/platform-openshift.yaml
```

### Variantes útiles

- **Compacto / all-in-one**: cambia el perfil por `values/profiles/all-in-one.yaml`.
- **Alta disponibilidad**: cambia el perfil por `values/profiles/ha.yaml` y usa un entorno de producción.
- **Entorno air-gapped**: añade `values/airgap.yaml` y define el espejo de imágenes.

## 5. Inyectar secretos sin guardarlos en Git

El chart separa valores públicos de material sensible. Los secretos de arranque y de runtime deben entrar por `Secret`, `SecretRefs` o mecanismos equivalentes del chart, nunca en texto plano.

A nivel de bootstrap, revisa que existan estos valores sensibles:

- `BOOTSTRAP_KEYCLOAK_ADMIN_USERNAME`
- `BOOTSTRAP_KEYCLOAK_ADMIN_PASSWORD`
- `BOOTSTRAP_SUPERADMIN_PASSWORD`
- `BOOTSTRAP_APISIX_ADMIN_KEY`

## 6. Verificar el bootstrap inicial

El bootstrap se ejecuta como job post-install / post-upgrade y realiza dos fases:

- **create-only**: crea los recursos one-shot que aún faltan
- **reconcile**: alinea rutas APISIX y deja un marcador de hash

Comprueba el estado con:

```bash
oc get jobs,pods,configmap -n in-falcone-staging | grep bootstrap
oc get route -n in-falcone-staging
oc get configmap in-falcone-bootstrap-state -n in-falcone-staging
```

Si necesitas ver el log del job, usa el nombre real del job de bootstrap del release:

```bash
oc logs job/<nombre-del-job-bootstrap> -n in-falcone-staging
```

### Qué debes confirmar

- El job terminó en `Completed`.
- La `Route` pública existe y apunta al servicio esperado.
- El `ConfigMap` marcador `in-falcone-bootstrap-state` se actualizó con el hash de la fase one-shot.
- No hay recreaciones en bucle del job de bootstrap.

## 7. Verificación funcional mínima

1. Abre la consola web y valida que carga sin errores 5xx.
2. Comprueba que el gateway público responde.
3. Confirma que Keycloak emite tokens válidos para el realm bootstrapado.
4. Valida que el contexto de `Route` o `Ingress` coincide con el overlay de plataforma elegido.

## Paridad Kubernetes

La instalación en Kubernetes usa el mismo chart y la misma secuencia, con dos diferencias principales:

- `charts/in-falcone/values/platform-kubernetes.yaml` sustituye el overlay OpenShift.
- La exposición pública se hace con `Ingress` en lugar de `Route`.

Ejemplo equivalente:

```bash
helm upgrade --install in-falcone charts/in-falcone \
  --namespace in-falcone-staging \
  --create-namespace \
  -f charts/in-falcone/values.yaml \
  -f charts/in-falcone/values/profiles/standard.yaml \
  -f charts/in-falcone/values/staging.yaml \
  -f charts/in-falcone/values/platform-kubernetes.yaml
```

Verificación equivalente:

```bash
kubectl get ingress -n in-falcone-staging
kubectl get jobs,pods,configmap -n in-falcone-staging | grep bootstrap
kubectl get configmap in-falcone-bootstrap-state -n in-falcone-staging
```

## Buenas prácticas operativas

- No borres el `ConfigMap` marcador salvo que estés haciendo recuperación supervisada.
- Mantén el orden de overlays; no mezcles overrides ad hoc fuera del stack de valores.
- Si usas proxy corporativo, inyecta `NO_PROXY` y certificados internos por overlay, no dentro de la imagen.
- Para entornos aislados, valida primero la resolución de registros privados y pull secrets.
- Si el bootstrap falla, revisa primero secretos, permisos del namespace y disponibilidad de APISIX / Keycloak.

## Referencias relacionadas

- `charts/in-falcone/README.md` — ejemplos oficiales de instalación y actualización.
- `docs/reference/environment-variables.md` — variables de entorno operativas.
- `docs/guides/platform-usage.md` — flujos de uso de la plataforma.
