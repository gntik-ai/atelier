/**
 * Small injectable startup coordinator. Keeping listen behind these awaited
 * gates makes the no-listener-on-key-failure invariant directly testable.
 */
export async function listenAfterRequiredGates({ applySchema, resolveWebhookKey, configureWebhookKey, listen }) {
  await applySchema();
  const keyContext = await resolveWebhookKey();
  configureWebhookKey(keyContext);
  await listen();
  return keyContext;
}
