{{- define "component-wrapper.name" -}}
{{- default .Chart.Name .Values.wrapper.componentId | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "component-wrapper.fullname" -}}
{{- printf "%s-%s" .Release.Name (include "component-wrapper.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "component-wrapper.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | quote }}
app.kubernetes.io/name: {{ include "component-wrapper.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: in-atelier
{{- end -}}

{{- define "component-wrapper.selectorLabels" -}}
app.kubernetes.io/name: {{ include "component-wrapper.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "component-wrapper.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "component-wrapper.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{- define "component-wrapper.image" -}}
{{- $repository := required (printf "%s image.repository is required" (include "component-wrapper.name" .)) .Values.image.repository -}}
{{- if .Values.image.digest -}}
{{ printf "%s@%s" $repository .Values.image.digest }}
{{- else -}}
{{ printf "%s:%s" $repository .Values.image.tag }}
{{- end -}}
{{- end -}}

{{- define "component-wrapper.persistenceClaimName" -}}
{{- if .Values.persistence.existingClaim -}}
{{- .Values.persistence.existingClaim -}}
{{- else -}}
{{- printf "%s-data" (include "component-wrapper.fullname" .) -}}
{{- end -}}
{{- end -}}

{{- define "component-wrapper.generatedConfigMapName" -}}
{{- printf "%s-config" (include "component-wrapper.fullname" .) -}}
{{- end -}}
