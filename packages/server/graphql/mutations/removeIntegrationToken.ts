import {GraphQLID, GraphQLNonNull} from 'graphql'
import {SubscriptionChannel} from 'parabol-client/types/constEnums'
import {IntegrationProviderServiceEnum as TIntegrationProviderServiceEnum} from '../../postgres/queries/generated/getIntegrationProvidersByIdsQuery'
import removeIntegrationTokenQuery from '../../postgres/queries/removeIntegrationToken'
import {getUserId, isTeamMember} from '../../utils/authorization'
import publish from '../../utils/publish'
import standardError from '../../utils/standardError'
import {GQLContext} from '../graphql'
import IntegrationProviderServiceEnum from '../types/IntegrationProviderServiceEnum'
import RemoveIntegrationTokenPayload from '../types/RemoveIntegrationTokenPayload'

const removeIntegrationToken = {
  type: GraphQLNonNull(RemoveIntegrationTokenPayload),
  description: 'Remove the integrated auth for a given team member',
  args: {
    service: {
      type: GraphQLNonNull(IntegrationProviderServiceEnum),
      description: 'The Integration Provider service name related to the token'
    },
    teamId: {
      type: GraphQLNonNull(GraphQLID),
      description: 'The team id related to the token'
    }
  },
  resolve: async (
    _source,
    {service, teamId}: {service: TIntegrationProviderServiceEnum; teamId: string},
    context: GQLContext
  ) => {
    const {authToken, dataLoader, socketId: mutatorId} = context
    const viewerId = getUserId(authToken)
    const operationId = dataLoader.share()
    const subOptions = {mutatorId, operationId}

    // AUTH
    if (!isTeamMember(authToken, teamId))
      return standardError(new Error('permission denied; must be team member'))

    // RESOLUTION
    await removeIntegrationTokenQuery(service, teamId, viewerId)

    const data = {userId: viewerId, teamId}
    publish(SubscriptionChannel.TEAM, teamId, 'RemoveIntegrationToken', data, subOptions)
    return data
  }
}

export default removeIntegrationToken
