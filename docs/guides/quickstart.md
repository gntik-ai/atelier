# Inicio rápido

Esta guía resume el camino más corto para poner la plataforma en marcha en **OpenShift** y validar que todo responde. Si quieres más detalle, consulta después:

- [Instalación en OpenShift](./installation-openshift.md)
- [Uso práctico de la plataforma](./platform-usage.md)
- [Variables de entorno operativas](../reference/environment-variables.md)

## 1. Requisitos mínimos

Antes de instalar, comprueba que dispones de:

- un cluster OpenShift 4.x o un cluster Kubernetes compatible;
- `helm` 3.x;
- `oc` para OpenShift o `kubectl` para Kubernetes;
- acceso a los secretos de bootstrap de Keycloak y APISIX;
- DNS o dominio interno para las rutas públicas;
- permisos para crear `Namespace`, `Secret`, `ConfigMap`, `Job` y `Route`/`Ingress`.

## 2. Preparar el entorno

### OpenShift: preparar namespace

```bash
oc new-project in-falcone-dev
```

### Kubernetes: preparar namespace

```bash
kubectl create namespace in-falcone-dev
kubectl config set-context --current --namespace=in-falcone-dev
```

## 3. Construir dependencias del chart

```bash
helm dependency build charts/in-falcone
```

## 4. Elegir el overlay correcto

Para OpenShift usa el overlay de plataforma:

```text
charts/in-falcone/values.yaml
charts/in-falcone/values/profiles/standard.yaml
charts/in-falcone/values/dev.yaml
charts/in-falcone/values/platform-openshift.yaml
```

Para Kubernetes sustituye el último fichero por:

```text
charts/in-falcone/values/platform-kubernetes.yaml
```

## 5. Instalar

### OpenShift: instalar

```bash
helm upgrade --install in-falcone charts/in-falcone \
  --namespace in-falcone-dev \
  --create-namespace \
  -f charts/in-falcone/values.yaml \
  -f charts/in-falcone/values/profiles/standard.yaml \
  -f charts/in-falcone/values/dev.yaml \
  -f charts/in-falcone/values/platform-openshift.yaml
```

### Kubernetes: instalar

```bash
helm upgrade --install in-falcone charts/in-falcone \
  --namespace in-falcone-dev \
  --create-namespace \
  -f charts/in-falcone/values.yaml \
  -f charts/in-falcone/values/profiles/standard.yaml \
  -f charts/in-falcone/values/dev.yaml \
  -f charts/in-falcone/values/platform-kubernetes.yaml
```

## 6. Verificar que el despliegue levantó

Comprueba que el bootstrap terminó y que la superficie pública está creada:

### OpenShift: verificación

```bash
oc get jobs,pods,route,configmap -n in-falcone-dev | grep bootstrap
```

### Kubernetes: verificación

```bash
kubectl get jobs,pods,ingress,configmap -n in-falcone-dev | grep bootstrap
```

Si el job de bootstrap está en `Completed`, la ruta o ingreso público existe y el `ConfigMap` de estado fue creado, el despliegue base ya quedó listo.

## 7. Primer uso recomendado

1. Abre la consola web y confirma que carga sin errores.
2. Revisa los valores del perfil y las cuotas activas.
3. Ejecuta una exportación de configuración de un tenant de prueba.
4. Revisa la guía de uso para probar el flujo de validación, preflight y reprovisionado.

## 8. Dónde seguir

- Si necesitas el procedimiento completo de instalación, ve a [Instalación en OpenShift](./installation-openshift.md).
- Si quieres aprender los flujos operativos, ve a [Uso práctico de la plataforma](./platform-usage.md).
- Si operas la plataforma o configuras despliegues, consulta [Variables de entorno operativas](../reference/environment-variables.md).
