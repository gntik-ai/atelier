/**
 * bbx-933-console-06 | fn-function-action-mutation
 * OpenSpec: #### Scenario: Version and rollback preserve Function semantics
 */
import { deployFunction, type GatewayMutationAccepted } from '../../../apps/web-console/src/services/functionsApi'

type PublishedGatewayMutationAccepted = {
  requestId: string
  status: string
  family: string
  resourceType: string
  resourceId: string
  correlationId: string
  acceptedAt: string
}

declare const accepted: GatewayMutationAccepted
declare const deployed: Awaited<ReturnType<typeof deployFunction>>
const acceptedEnvelope: PublishedGatewayMutationAccepted = accepted
const deployedEnvelope: PublishedGatewayMutationAccepted = deployed
void acceptedEnvelope
void deployedEnvelope
