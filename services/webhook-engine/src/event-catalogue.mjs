export const EVENT_CATALOGUE = [
  { id: 'document.created', description: 'A new document was created in the workspace.' },
  { id: 'document.updated', description: 'An existing document was updated.' },
  { id: 'document.deleted', description: 'A document was soft-deleted.' },
  { id: 'user.signed_up', description: 'A new user registered in the workspace.' },
  { id: 'function.completed', description: 'A serverless function invocation completed.' },
  { id: 'storage.object.created', description: 'An object was uploaded to workspace storage.' }
];

const EVENT_IDS = new Set(EVENT_CATALOGUE.map((entry) => entry.id));

export function isValidEventType(id) {
  return EVENT_IDS.has(id);
}
