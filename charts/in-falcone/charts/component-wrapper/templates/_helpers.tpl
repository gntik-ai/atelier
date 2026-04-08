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
app.kubernetes.io/part-of: in-falcone
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

{{- define "component-wrapper.normalizeRepository" -}}
{{- $repository := .repository -}}
{{- $globalRegistry := trimSuffix "/" (default "" .Values.global.imageRegistry) -}}
{{- if or (eq $globalRegistry "") (eq $repository $globalRegistry) (hasPrefix (printf "%s/" $globalRegistry) $repository) -}}
{{- $repository -}}
{{- else -}}
{{- $segments := splitList "/" $repository -}}
{{- $first := first $segments -}}
{{- $hasRegistry := or (contains "." $first) (contains ":" $first) (eq $first "localhost") -}}
{{- if and $hasRegistry (gt (len $segments) 1) -}}
{{- printf "%s/%s" $globalRegistry (join "/" (rest $segments)) -}}
{{- else -}}
{{- printf "%s/%s" $globalRegistry $repository -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "component-wrapper.renderImage" -}}
{{- $name := .name | default "component" -}}
{{- $image := .image -}}
{{- $repository := required (printf "%s image.repository is required" $name) $image.repository -}}
{{- $normalizedRepository := include "component-wrapper.normalizeRepository" (dict "Values" .Values "repository" $repository) -}}
{{- if $image.digest -}}
{{ printf "%s@%s" $normalizedRepository $image.digest }}
{{- else -}}
{{ printf "%s:%s" $normalizedRepository $image.tag }}
{{- end -}}
{{- end -}}

{{- define "component-wrapper.image" -}}
{{- include "component-wrapper.renderImage" (dict "Values" .Values "image" .Values.image "name" (include "component-wrapper.name" .)) -}}
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
