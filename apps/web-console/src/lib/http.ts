export const API_VERSION = '2026-03-26'

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export interface ApiError {
  status: number
  code: string
  gatewayCode?: string
  message: string
  retryable?: boolean
  correlationId?: string
  requestId?: string
  detail?: JsonValue
  resource?: JsonValue
  // Node-scoped validation errors surfaced on 4xx envelopes (e.g. flows 422
  // FLOW_VALIDATION_FAILED carries `errors: [{ code, nodeId, message }]`). Preserved
  // verbatim so callers can map them back onto UI elements (e.g. canvas nodes).
  errors?: JsonValue
}

export interface JsonRequestOptions {
  method?: HttpMethod
  body?: JsonValue
  headers?: HeadersInit
  idempotent?: boolean
  signal?: AbortSignal
}

export function createRequestId(prefix = 'req'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`
  }

  return `${prefix}_${Math.random().toString(36).slice(2, 14)}`
}

export async function requestJson<T>(url: string, options: JsonRequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET'
  const headers = new Headers({
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-API-Version': API_VERSION,
    'X-Correlation-Id': createRequestId('corr')
  })

  if (method !== 'GET' || options.idempotent) {
    headers.set('Idempotency-Key', createRequestId('idem'))
  }

  const extraHeaders = new Headers(options.headers ?? {})
  extraHeaders.forEach((value, key) => {
    headers.set(key, value)
  })

  const response = await fetch(url, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal
  })

  const contentType = response.headers.get('content-type') ?? ''
  const hasJsonBody = contentType.includes('application/json')
  const payload = hasJsonBody ? await readJsonPayload<T | ApiError>(response) : null

  if (!response.ok) {
    const fallbackError: ApiError = {
      status: response.status,
      code: `HTTP_${response.status}`,
      message: response.statusText || 'Request failed'
    }

    throw normalizeApiError(payload, fallbackError)
  }

  return payload as T
}

async function readJsonPayload<T>(response: Response): Promise<T | null> {
  if (response.status === 204 || response.status === 205) {
    return null
  }

  if (typeof response.text === 'function') {
    const text = await response.text()
    if (text.trim().length === 0) {
      return null
    }

    return JSON.parse(text) as T
  }

  return (await response.json()) as T
}

function normalizeApiError(payload: unknown, fallbackError: ApiError): ApiError {
  if (!payload || typeof payload !== 'object') {
    return fallbackError
  }

  const maybeError = payload as Partial<ApiError>
  const wireCode = typeof maybeError.code === 'string' ? maybeError.code : fallbackError.code
  const gatewayCode = wireCode.startsWith('GW_') ? wireCode : undefined
  const detail = maybeError.detail
  const detailErrors =
    detail && typeof detail === 'object' && !Array.isArray(detail)
      ? (detail as { errors?: unknown }).errors
      : undefined

  return {
    status: typeof maybeError.status === 'number' ? maybeError.status : fallbackError.status,
    // Keep existing console/domain comparisons stable while retaining the canonical wire code.
    code: gatewayCode ? gatewayCode.slice(3) : wireCode,
    gatewayCode,
    message: typeof maybeError.message === 'string' ? maybeError.message : fallbackError.message,
    retryable: typeof maybeError.retryable === 'boolean' ? maybeError.retryable : undefined,
    correlationId: typeof maybeError.correlationId === 'string' ? maybeError.correlationId : undefined,
    requestId: typeof maybeError.requestId === 'string' ? maybeError.requestId : undefined,
    detail,
    resource: maybeError.resource,
    errors: Array.isArray((maybeError as { errors?: unknown }).errors)
      ? ((maybeError as { errors?: JsonValue }).errors)
      : Array.isArray(detailErrors)
        ? (detailErrors as JsonValue)
        : undefined
  }
}
