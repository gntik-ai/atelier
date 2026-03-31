import { createPlan, getFixturePlanPayloads, getPlan } from '../helpers/plan-api-client.mjs';

export function getFixturePlanSlugs() {
  return { starter: 'test-starter', professional: 'test-professional' };
}

export async function seedFixturePlans(token) {
  const payloads = getFixturePlanPayloads();
  const seeded = {};
  for (const [key, payload] of Object.entries(payloads)) {
    const existing = await getPlan(payload.slug, token);
    if (existing.status === 200 && existing.body) {
      const existingName = existing.body.name ?? existing.body.plan?.name ?? '';
      if (!String(existingName).includes('E2E fixture')) {
        throw new Error(`Fixture slug collision detected for ${payload.slug}`);
      }
      seeded[key] = existing.body;
      continue;
    }
    const created = await createPlan(payload, token);
    if (created.status >= 400 && created.status !== 409) {
      throw new Error(`Unable to create plan ${payload.slug}: ${JSON.stringify(created.body)}`);
    }
    seeded[key] = created.body ?? payload;
  }
  return seeded;
}
