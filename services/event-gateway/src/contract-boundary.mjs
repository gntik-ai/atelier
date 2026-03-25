import { getContract, getService } from '../../internal-contracts/src/index.mjs';

export const eventGatewayBoundary = getService('event_gateway');
export const iamLifecycleEventContract = getContract('iam_lifecycle_event');
export const mongoAdminEventContract = getContract('mongo_admin_event');
export const kafkaAdminEventContract = getContract('kafka_admin_event');
export const postgresDataChangeEventContract = getContract('postgres_data_change_event');
export const storageObjectEventContract = getContract('storage_object_event');
export const openwhiskActivationEventContract = getContract('openwhisk_activation_event');
export const eventBridgeRequestContract = getContract('event_bridge_request');
export const eventBridgeStatusContract = getContract('event_bridge_status');
export const kafkaFunctionTriggerRequestContract = getContract('kafka_function_trigger_request');
export const kafkaFunctionTriggerResultContract = getContract('kafka_function_trigger_result');
export const eventGatewayPublishRequestContract = getContract('event_gateway_publish_request');
export const eventGatewaySubscriptionRequestContract = getContract('event_gateway_subscription_request');
export const eventGatewayPublishResultContract = getContract('event_gateway_publish_result');
export const eventGatewaySubscriptionStatusContract = getContract('event_gateway_subscription_status');
