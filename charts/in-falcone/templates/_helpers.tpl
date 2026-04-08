{{- define "in-falcone.name" -}}
{{- default .Chart.Name .Values.global.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "in-falcone.fullname" -}}
{{- printf "%s-%s" .Release.Name (include "in-falcone.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "in-falcone.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | quote }}
app.kubernetes.io/name: {{ include "in-falcone.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: in-falcone
{{- end -}}

{{- define "in-falcone.componentServiceName" -}}
{{- $binding := .binding -}}
{{- $root := .root -}}
{{- if $binding.serviceName -}}
{{- $binding.serviceName -}}
{{- else -}}
{{- printf "%s-%s" $root.Release.Name ((index $root.Values $binding.component).wrapper.componentId | default $binding.component) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "in-falcone.componentSelectorLabels" -}}
{{- $component := index .root.Values .component -}}
app.kubernetes.io/name: {{ $component.wrapper.componentId | default .component }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
{{- end -}}

{{- define "in-falcone.componentServiceNameByAlias" -}}
{{- $root := .root -}}
{{- $component := .component -}}
{{- $serviceName := .serviceName | default "" -}}
{{- if $serviceName -}}
{{- $serviceName -}}
{{- else -}}
{{- printf "%s-%s" $root.Release.Name ((index $root.Values $component).wrapper.componentId | default $component) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "in-falcone.bootstrapServiceAccountName" -}}
{{- if .Values.bootstrap.serviceAccount.create -}}
{{- default (printf "%s-bootstrap" (include "in-falcone.fullname" .)) .Values.bootstrap.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.bootstrap.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{- define "in-falcone.bootstrapPayloadConfigMapName" -}}
{{- printf "%s-bootstrap-payload" (include "in-falcone.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "in-falcone.bootstrapScriptConfigMapName" -}}
{{- printf "%s-bootstrap-script" (include "in-falcone.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "in-falcone.bootstrapGovernanceCatalogName" -}}
{{- printf "%s-bootstrap-governance" (include "in-falcone.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "in-falcone.bootstrapInternalNamespacesName" -}}
{{- printf "%s-bootstrap-namespaces" (include "in-falcone.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "in-falcone.apisixAdminServiceName" -}}
{{- printf "%s-apisix-admin" (include "in-falcone.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "in-falcone.bootstrapOneShotHash" -}}
{{- toJson (dict "keycloak" .Values.bootstrap.oneShot.keycloak "governanceCatalog" .Values.bootstrap.oneShot.governanceCatalog "internalNamespaces" .Values.bootstrap.oneShot.internalNamespaces) | sha256sum -}}
{{- end -}}
