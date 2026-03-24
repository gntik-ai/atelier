import { getContract, getService } from '../../internal-contracts/src/index.mjs';

export const eventGatewayBoundary = getService('event_gateway');
export const iamLifecycleEventContract = getContract('iam_lifecycle_event');
export const eventGatewayPublishRequestContract = getContract('event_gateway_publish_request');
export const eventGatewaySubscriptionRequestContract = getContract('event_gateway_subscription_request');
export const eventGatewayPublishResultContract = getContract('event_gateway_publish_result');
export const eventGatewaySubscriptionStatusContract = getContract('event_gateway_subscription_status');
