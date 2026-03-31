export function buildUnavailableDimensionResponse(dimensionKey) {
  return {
    quotaDimensions: [
      {
        dimensionKey,
        effectiveValueKind: 'bounded',
        effectiveValue: 3,
        observedUsage: null,
        usageStatus: 'usage_unavailable',
        usageUnknownReason: 'usage_source_unavailable'
      }
    ]
  };
}

export async function injectUnavailableDimension(tenantId, dimensionKey, token) {
  const overridePath = process.env.TEST_USAGE_UNAVAILABLE_PATH;
  if (!overridePath) {
    return {
      status: 501,
      simulated: true,
      tenantId,
      dimensionKey,
      body: {
        message: 'No API-level usage-unavailable injector configured; use crafted response assertions only.'
      }
    };
  }
  const response = await fetch(`${process.env.TEST_API_BASE_URL.replace(/\/$/, '')}${overridePath}`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ tenantId, dimensionKey })
  });
  const text = await response.text();
  return { status: response.status, simulated: false, body: text ? JSON.parse(text) : null };
}
