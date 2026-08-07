import { publicKnativeStatus } from './knative-runtime.mjs';

async function getKnativeRuntimeStatus(ctx) {
  return { statusCode: 200, body: publicKnativeStatus(ctx.knativeRuntime.status()) };
}

export const KNATIVE_RUNTIME_HANDLERS = { getKnativeRuntimeStatus };
