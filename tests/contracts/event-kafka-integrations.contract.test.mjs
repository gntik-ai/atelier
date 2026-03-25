import test from 'node:test';
import assert from 'node:assert/strict';

import { OPENAPI_PATH, readJson, resolveParameters } from '../../scripts/lib/quality-gates.mjs';
import {
  getContract,
  getPublicRoute,
  getService,
  readPublicApiTaxonomy
} from '../../services/internal-contracts/src/index.mjs';

test('US-EVT-03 internal contracts publish bridge, trigger, and source-event envelopes', () => {
  const controlApi = getService('control_api');
  const eventGateway = getService('event_gateway');
  const provisioning = getService('provisioning_orchestrator');

  const eventBridgeRequest = getContract('event_bridge_request');
  const eventBridgeStatus = getContract('event_bridge_status');
  const kafkaFunctionTriggerRequest = getContract('kafka_function_trigger_request');
  const kafkaFunctionTriggerResult = getContract('kafka_function_trigger_result');
  const postgresDataChangeEvent = getContract('postgres_data_change_event');
  const storageObjectEvent = getContract('storage_object_event');
  const openwhiskActivationEvent = getContract('openwhisk_activation_event');

  assert.ok(controlApi.outbound_contracts.includes('event_bridge_request'));
  assert.ok(controlApi.outbound_contracts.includes('kafka_function_trigger_request'));
  assert.ok(eventGateway.inbound_contracts.includes('event_bridge_request'));
  assert.ok(eventGateway.inbound_contracts.includes('kafka_function_trigger_request'));
  assert.ok(eventGateway.inbound_contracts.includes('postgres_data_change_event'));
  assert.ok(eventGateway.inbound_contracts.includes('storage_object_event'));
  assert.ok(eventGateway.inbound_contracts.includes('openwhisk_activation_event'));
  assert.ok(eventGateway.outbound_contracts.includes('event_bridge_status'));
  assert.ok(eventGateway.outbound_contracts.includes('kafka_function_trigger_result'));
  assert.ok(eventGateway.adapter_dependencies.includes('openwhisk'));
  assert.ok(provisioning.outbound_contracts.includes('postgres_data_change_event'));
  assert.ok(provisioning.outbound_contracts.includes('storage_object_event'));
  assert.ok(provisioning.outbound_contracts.includes('openwhisk_activation_event'));

  assert.equal(eventBridgeRequest.version, '2026-03-26');
  assert.equal(eventBridgeStatus.version, '2026-03-26');
  assert.equal(kafkaFunctionTriggerRequest.version, '2026-03-26');
  assert.equal(kafkaFunctionTriggerResult.version, '2026-03-26');
  assert.equal(postgresDataChangeEvent.version, '2026-03-26');
  assert.equal(storageObjectEvent.version, '2026-03-26');
  assert.equal(openwhiskActivationEvent.version, '2026-03-26');
  assert.ok(eventBridgeRequest.required_fields.includes('source_type'));
  assert.ok(eventBridgeStatus.required_fields.includes('delivery_mode'));
  assert.ok(kafkaFunctionTriggerRequest.required_fields.includes('failure_policy'));
  assert.ok(kafkaFunctionTriggerResult.required_fields.includes('status'));
  assert.ok(postgresDataChangeEvent.required_fields.includes('table_name'));
  assert.ok(storageObjectEvent.required_fields.includes('bucket_ref'));
  assert.ok(openwhiskActivationEvent.required_fields.includes('activation_id'));
});

test('US-EVT-03 public API publishes bridge, trigger, metadata, and observability routes', () => {
  const document = readJson(OPENAPI_PATH);
  const taxonomy = readPublicApiTaxonomy();
  const createBridgeRoute = getPublicRoute('createEventBridge');
  const getBridgeRoute = getPublicRoute('getEventBridge');
  const topicMetadataRoute = getPublicRoute('getEventTopicMetadata');
  const createTriggerRoute = getPublicRoute('createFunctionKafkaTrigger');
  const getTriggerRoute = getPublicRoute('getFunctionKafkaTrigger');
  const kafkaTopicMetricsRoute = getPublicRoute('getWorkspaceKafkaTopicMetrics');
  const eventDashboardRoute = getPublicRoute('getWorkspaceEventDashboards');

  const createBridgeOperation = document.paths['/v1/events/workspaces/{workspaceId}/bridges'].post;
  const getBridgeOperation = document.paths['/v1/events/workspaces/{workspaceId}/bridges/{bridgeId}'].get;
  const topicMetadataOperation = document.paths['/v1/events/topics/{resourceId}/metadata'].get;
  const createTriggerOperation = document.paths['/v1/functions/actions/{resourceId}/kafka-triggers'].post;
  const getTriggerOperation = document.paths['/v1/functions/actions/{resourceId}/kafka-triggers/{triggerId}'].get;
  const kafkaTopicMetricsOperation = document.paths['/v1/metrics/workspaces/{workspaceId}/kafka-topics'].get;
  const eventDashboardOperation = document.paths['/v1/metrics/workspaces/{workspaceId}/event-dashboards'].get;

  assert.equal(document.info.version, '1.21.0');
  assert.equal(document.components.parameters.XApiVersion.schema.const, '2026-03-26');
  assert.equal(taxonomy.release.header_version, '2026-03-26');
  assert.equal(taxonomy.release.openapi_semver, '1.21.0');

  assert.equal(createBridgeRoute.resourceType, 'event_bridge');
  assert.equal(getBridgeRoute.resourceType, 'event_bridge');
  assert.equal(topicMetadataRoute.resourceType, 'topic_metadata');
  assert.equal(createTriggerRoute.resourceType, 'function_kafka_trigger');
  assert.equal(getTriggerRoute.resourceType, 'function_kafka_trigger');
  assert.equal(kafkaTopicMetricsRoute.resourceType, 'kafka_topic_metrics');
  assert.equal(eventDashboardRoute.resourceType, 'event_dashboard');

  assert.equal(createBridgeOperation['x-owning-service'], 'control_api');
  assert.equal(getBridgeOperation['x-owning-service'], 'event_gateway');
  assert.equal(topicMetadataOperation['x-rate-limit-class'], 'observability');
  assert.equal(createTriggerOperation['x-downstream-adapters'].includes('openwhisk'), true);
  assert.equal(getTriggerOperation['x-owning-service'], 'event_gateway');
  assert.equal(kafkaTopicMetricsOperation['x-downstream-adapters'][0], 'kafka');
  assert.equal(eventDashboardOperation['x-downstream-adapters'].includes('openwhisk'), true);

  const createBridgeParameters = resolveParameters(document, createBridgeOperation);
  const getBridgeParameters = resolveParameters(document, getBridgeOperation);
  const getTriggerParameters = resolveParameters(document, getTriggerOperation);

  assert.equal(createBridgeParameters.some((parameter) => parameter.name === 'Idempotency-Key'), true);
  assert.equal(getBridgeParameters.some((parameter) => parameter.name === 'bridgeId'), true);
  assert.equal(getTriggerParameters.some((parameter) => parameter.name === 'triggerId'), true);

  assert.ok(document.components.schemas.EventBridge);
  assert.ok(document.components.schemas.EventBridgeWriteRequest);
  assert.ok(document.components.schemas.EventTopicMetadataResponse);
  assert.ok(document.components.schemas.FunctionKafkaTrigger);
  assert.ok(document.components.schemas.FunctionKafkaTriggerWriteRequest);
  assert.ok(document.components.schemas.KafkaTopicMetricsResponse);
  assert.ok(document.components.schemas.WorkspaceEventDashboardResponse);
  assert.ok(document.components.schemas.FunctionAction.properties.kafkaTriggers);
  assert.ok(document.components.schemas.StorageBucket.properties.eventBridgeSummary);
  assert.ok(document.components.schemas.EventTopic.properties.operationalMetadata);
});
