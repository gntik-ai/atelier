{{- define "in-atelier.name" -}}
{{- default .Chart.Name .Values.global.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "in-atelier.fullname" -}}
{{- printf "%s-%s" .Release.Name (include "in-atelier.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "in-atelier.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | quote }}
app.kubernetes.io/name: {{ include "in-atelier.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: in-atelier
{{- end -}}

{{- define "in-atelier.componentServiceName" -}}
{{- $binding := .binding -}}
{{- $root := .root -}}
{{- if $binding.serviceName -}}
{{- $binding.serviceName -}}
{{- else -}}
{{- printf "%s-%s" $root.Release.Name ((index $root.Values $binding.component).wrapper.componentId | default $binding.component) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "in-atelier.componentSelectorLabels" -}}
{{- $component := index .root.Values .component -}}
app.kubernetes.io/name: {{ $component.wrapper.componentId | default .component }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
{{- end -}}

{{- define "in-atelier.componentServiceNameByAlias" -}}
{{- $root := .root -}}
{{- $component := .component -}}
{{- $serviceName := .serviceName | default "" -}}
{{- if $serviceName -}}
{{- $serviceName -}}
{{- else -}}
{{- printf "%s-%s" $root.Release.Name ((index $root.Values $component).wrapper.componentId | default $component) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "in-atelier.bootstrapServiceAccountName" -}}
{{- if .Values.bootstrap.serviceAccount.create -}}
{{- default (printf "%s-bootstrap" (include "in-atelier.fullname" .)) .Values.bootstrap.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.bootstrap.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{- define "in-atelier.bootstrapPayloadConfigMapName" -}}
{{- printf "%s-bootstrap-payload" (include "in-atelier.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "in-atelier.bootstrapScriptConfigMapName" -}}
{{- printf "%s-bootstrap-script" (include "in-atelier.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "in-atelier.bootstrapGovernanceCatalogName" -}}
{{- printf "%s-bootstrap-governance" (include "in-atelier.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "in-atelier.bootstrapInternalNamespacesName" -}}
{{- printf "%s-bootstrap-namespaces" (include "in-atelier.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "in-atelier.apisixAdminServiceName" -}}
{{- printf "%s-apisix-admin" (include "in-atelier.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "in-atelier.bootstrapOneShotHash" -}}
{{- toJson (dict "keycloak" .Values.bootstrap.oneShot.keycloak "governanceCatalog" .Values.bootstrap.oneShot.governanceCatalog "internalNamespaces" .Values.bootstrap.oneShot.internalNamespaces) | sha256sum -}}
{{- end -}}
