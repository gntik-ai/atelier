import { map as mapEvent } from './MongoChangeEventMapper.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class ChangeStreamWatcher {
  constructor({ captureConfig, mongoClient, kafkaPublisher, resumeTokenStore, auditCallback = async () => {}, statusUpdateCallback = async () => {} }) {
    this.captureConfig = captureConfig;
    this.mongoClient = mongoClient;
    this.kafkaPublisher = kafkaPublisher;
    this.resumeTokenStore = resumeTokenStore;
    this.auditCallback = auditCallback;
    this.statusUpdateCallback = statusUpdateCallback;
    this.running = false;
    this.healthy = true;
    this.stream = null;
    this.loopPromise = null;
  }

  _topic() { return this.kafkaPublisher.resolveTopic(this.captureConfig); }
  _partitionKey() { return `${this.captureConfig.workspace_id}:${this.captureConfig.database_name}.${this.captureConfig.collection_name}`; }
  isHealthy() { return this.healthy; }

  async start() {
    this.running = true;
    this.loopPromise = this._run();
    return this.loopPromise;
  }

  async _run() {
    const maxReconnects = Number(process.env.MONGO_CDC_MAX_RECONNECT_ATTEMPTS ?? 10);
    let attempt = 0;
    while (this.running) {
      try {
        const storedResumeToken = await this.resumeTokenStore.get(this.captureConfig.id);
        const collection = this.mongoClient.db(this.captureConfig.database_name).collection(this.captureConfig.collection_name);
        const pipeline = [{ $match: { operationType: { $in: ['insert', 'update', 'replace', 'delete'] } } }];
        const options = {
          fullDocument: this.captureConfig.capture_mode === 'full-document' ? 'updateLookup' : 'whenAvailable',
          resumeAfter: storedResumeToken ?? undefined,
          startAtOperationTime: storedResumeToken ? undefined : new Date()
        };
        this.stream = collection.watch(pipeline, options);
        this.healthy = true;
        for await (const rawDoc of this.stream) {
          if (!this.running) break;
          const envelope = mapEvent(rawDoc, this.captureConfig);
          const serialized = JSON.stringify(envelope);
          const maxBytes = Number(process.env.MONGO_CDC_MAX_MESSAGE_BYTES ?? 900000);
          let publishEnvelope = envelope;
          if (Buffer.byteLength(serialized) > maxBytes) {
            publishEnvelope = { ...envelope, data: { event_type: envelope.data.event_type, collection_name: envelope.data.collection_name, document_key: envelope.data.document_key, capture_config_id: envelope.data.capture_config_id, reason: 'oversized' } };
            await this.auditCallback('capture-oversized-event', this.captureConfig, rawDoc, publishEnvelope);
          }
          await this.kafkaPublisher.publish(this._topic(), this._partitionKey(), publishEnvelope, { 'ce-type': publishEnvelope.type, 'ce-source': publishEnvelope.source, 'ce-tenantid': publishEnvelope.tenantid, 'ce-workspaceid': publishEnvelope.workspaceid });
          await this.resumeTokenStore.upsert(this.captureConfig.id, rawDoc._id);
        }
        return;
      } catch (error) {
        this.healthy = false;
        if (/invalidate/i.test(error?.name ?? '') || /invalidate/i.test(error?.message ?? '')) {
          await this.statusUpdateCallback('errored', error.message || 'stream-invalidated');
          await this.auditCallback('capture-stream-invalidated', this.captureConfig, null, { error: error.message });
          return;
        }
        attempt += 1;
        if (attempt > maxReconnects) {
          await this.statusUpdateCallback('errored', 'max-reconnect-exceeded');
          return;
        }
        await sleep(Math.min(60000, 1000 * (2 ** (attempt - 1))));
      }
    }
  }

  async stop() {
    this.running = false;
    await this.stream?.close?.();
    await this.loopPromise?.catch?.(() => {});
  }
}
