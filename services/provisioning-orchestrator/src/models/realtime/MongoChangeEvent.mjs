import crypto from 'node:crypto';

const toISOString = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  return new Date(value).toISOString();
};

const normalizeDocumentKey = (documentKey = {}) => {
  const key = documentKey._id;
  if (key == null) return documentKey;
  if (typeof key?.toHexString === 'function') return { _id: key.toHexString() };
  if (typeof key === 'object' && !(key instanceof Date)) return { _id: JSON.parse(JSON.stringify(key)) };
  return { _id: key };
};

export function buildMongoChangeEvent({ captureConfig, rawChangeDoc, eventId = crypto.randomUUID() }) {
  const eventType = rawChangeDoc.operationType;
  const updateMode = captureConfig.capture_mode ?? 'delta';
  const fullDocument = eventType === 'delete' ? null : (updateMode === 'delta' && eventType === 'update' ? null : (rawChangeDoc.fullDocument ?? null));
  const updateDescription = eventType === 'update' && updateMode === 'delta' ? (rawChangeDoc.updateDescription ?? null) : null;
  return {
    specversion: '1.0',
    type: 'console.mongo-capture.change',
    source: `/data-sources/${captureConfig.data_source_ref}/collections/${captureConfig.database_name}.${captureConfig.collection_name}`,
    id: eventId,
    time: toISOString(rawChangeDoc.wallTime ?? rawChangeDoc.clusterTime ?? Date.now()),
    tenantid: captureConfig.tenant_id,
    workspaceid: captureConfig.workspace_id,
    data: {
      event_type: eventType,
      database_name: captureConfig.database_name,
      collection_name: captureConfig.collection_name,
      document_key: normalizeDocumentKey(rawChangeDoc.documentKey),
      capture_mode: updateMode,
      full_document: fullDocument,
      update_description: updateDescription,
      cluster_time: toISOString(rawChangeDoc.clusterTime),
      wall_time: toISOString(rawChangeDoc.wallTime),
      capture_config_id: captureConfig.id
    }
  };
}
