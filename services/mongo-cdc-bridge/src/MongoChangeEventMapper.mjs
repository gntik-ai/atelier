import { buildMongoChangeEvent } from '../../provisioning-orchestrator/src/models/realtime/MongoChangeEvent.mjs';
export const map = (rawChangeDoc, captureConfig) => buildMongoChangeEvent({ captureConfig, rawChangeDoc });
export default { map };
