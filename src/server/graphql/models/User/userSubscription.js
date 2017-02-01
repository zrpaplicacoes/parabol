import getRethink from 'server/database/rethinkDriver';
import getRequestedFields from 'server/graphql/getRequestedFields'
import {GraphQLNonNull, GraphQLID, GraphQLList} from 'graphql';
import {User} from './userSchema';
import makeChangefeedHandler from 'server/utils/makeChangefeedHandler';
import {requireOrgLeader} from 'server/utils/authorization';

export default {
  // billingLeaders: {
  //   args: {
  //     orgId: {
  //       type: new GraphQLNonNull(GraphQLID),
  //       description: 'the org the billing leaders are in charge of'
  //     }
  //   },
  //   type: new GraphQLList(User),
  //   async resolve(source, {orgId}, {authToken, socket, subbedChannelName}, refs) {
  //     const r = getRethink();
  //     const requestedFields = getRequestedFields(refs);
  //     const changefeedHandler = makeChangefeedHandler(socket, subbedChannelName);
  //     await requireOrgLeader(authToken, orgId);
  //     r.table('User')
  //       .getAll(orgId, {index: 'billingLeaderOrgs'})
  //       .pluck(requestedFields)
  //       .changes({includeInitial: true})
  //       .run({cursor: true}, changefeedHandler);
  //   }
  // },
  usersByOrg: {
    args: {
      orgId: {
        type: new GraphQLNonNull(GraphQLID),
        description: 'the org for which you want the users'
      }
    },
    type: new GraphQLList(User),
    async resolve(source, {orgId}, {authToken, socket, subbedChannelName}, refs) {
      const r = getRethink();
      const requestedFields = getRequestedFields(refs);
      const changefeedHandler = makeChangefeedHandler(socket, subbedChannelName);
      await requireOrgLeader(authToken, orgId);
      r.table('User')
        .getAll(orgId, {index: 'userOrgs'})
        .merge((user) => ({
          isBillingLeader: user('userOrgs').default([]).contains((org) => org('id').eq(orgId))
        }))
        .pluck(requestedFields)
        .changes({includeInitial: true})
        .run({cursor: true}, changefeedHandler);
    }
  },
  user: {
    type: User,
    async resolve(source, args, {authToken, socket, subbedChannelName}, refs) {
      const r = getRethink();
      const requestedFields = getRequestedFields(refs);
      const changefeedHandler = makeChangefeedHandler(socket, subbedChannelName);
      const userId = authToken.sub;
      r.table('User')
        .get(userId)
        .changes({includeInitial: true})
        .map((row) => {
          return {
            new_val: row('new_val').pluck(requestedFields).default(null),
            old_val: row('old_val').pluck(requestedFields).default(null)
          };
        })
        .run({cursor: true}, changefeedHandler);
    }
  }
};
