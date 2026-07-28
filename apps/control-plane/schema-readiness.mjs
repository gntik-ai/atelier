const READY_RESPONSE = Object.freeze({
  statusCode: 503,
  body: Object.freeze({ status: 'schema_not_ready' })
});

const ROUTE_RESPONSE = Object.freeze({
  statusCode: 503,
  body: Object.freeze({
    code: 'SCHEMA_NOT_READY',
    message: 'Control-plane schema is not ready'
  })
});

export function createSchemaReadiness() {
  let ready = false;

  return Object.freeze({
    isReady() {
      return ready;
    },
    markReady() {
      ready = true;
    },
    responseForReadyProbe() {
      return ready ? null : READY_RESPONSE;
    },
    responseForMappedRoute() {
      return ready ? null : ROUTE_RESPONSE;
    }
  });
}
