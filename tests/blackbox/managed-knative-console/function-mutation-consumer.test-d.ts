/**
 * bbx-933-console-06 | fn-function-action-mutation
 * OpenSpec: #### Scenario: Version and rollback preserve Function semantics
 * bbx-933-console-delete-type-07 | fn-function-runtime-availability-gate
 * OpenSpec: #### Scenario: Delete during an outage is accepted as pending cleanup
 */
import {
  deleteFunction,
  deployFunction,
  type FunctionDeletionAccepted,
  type GatewayMutationAccepted
} from '../../../apps/web-console/src/services/functionsApi'

type PublishedGatewayMutationAccepted = {
  requestId: string
  status: string
  family: string
  resourceType: string
  resourceId: string
  correlationId: string
  acceptedAt: string
}

type PublishedFunctionDeletionAccepted = {
  requestId: string
  correlationId: string
  resourceId: string
  status: 'accepted' | 'deletion_pending'
  acceptedAt: string
}

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2) ? true : false
type Expect<Condition extends true> = Condition

declare const accepted: GatewayMutationAccepted
declare const deployed: Awaited<ReturnType<typeof deployFunction>>
declare const deleted: Awaited<ReturnType<typeof deleteFunction>>
const acceptedEnvelope: PublishedGatewayMutationAccepted = accepted
const deployedEnvelope: PublishedGatewayMutationAccepted = deployed
const deletedEnvelope: PublishedFunctionDeletionAccepted = deleted
type DeleteFunctionReturnsPublishedDeletionContract = Expect<Equal<
  Awaited<ReturnType<typeof deleteFunction>>,
  FunctionDeletionAccepted
>>
void acceptedEnvelope
void deployedEnvelope
void deletedEnvelope
void (null as unknown as DeleteFunctionReturnsPublishedDeletionContract)
