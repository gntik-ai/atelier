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
