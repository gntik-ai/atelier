function getBaseUrl() {
  const baseUrl = process.env.APISIX_BASE_URL;
  if (!baseUrl) {
    throw new Error('APISIX_BASE_URL is required for hardening HTTP requests');
  }
  return baseUrl.replace(/\/$/, '');
}

export async function request(method, path, { headers = {}, body = null } = {}) {
  const startedAt = Date.now();
  const url = `${getBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
  const timeoutMs = Number(process.env.HARDENING_HTTP_TIMEOUT_MS ?? 10000);
  const finalHeaders = { ...headers };
  let requestBody = body;

  if (body && typeof body === 'object' && !(body instanceof Uint8Array) && typeof body.pipe !== 'function') {
    requestBody = JSON.stringify(body);
    if (!finalHeaders['Content-Type'] && !finalHeaders['content-type']) {
      finalHeaders['Content-Type'] = 'application/json';
    }
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, {
      method,
      headers: finalHeaders,
      body: requestBody,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const responseText = await response.text();
    const durationMs = Date.now() - startedAt;
    if (process.env.HARDENING_DEBUG === 'true') {
      console.log(`[HTTP] ${method} ${path} → ${response.status} (${durationMs}ms)`);
    }

    let parsedBody = responseText;
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json') && responseText) {
      try {
        parsedBody = JSON.parse(responseText);
      } catch {
        parsedBody = responseText;
      }
    }

    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: parsedBody,
      durationMs,
    };
  } catch (error) {
    throw new Error(`HTTP request failed for ${method} ${path}: ${error.message}`);
  }
}

export const get = (path, opts) => request('GET', path, opts);
export const post = (path, opts) => request('POST', path, opts);
export const put = (path, opts) => request('PUT', path, opts);
export const del = (path, opts) => request('DELETE', path, opts);
