import {GraphQLID, GraphQLObjectType} from 'graphql'
import StandardMutationError from './StandardMutationError'
import User from './User'
import {GQLContext} from '../graphql'

const SignUpWithPasswordPayload = new GraphQLObjectType<any, GQLContext>({
  name: 'SignUpWithPasswordPayload',
  fields: () => ({
    error: {
      type: StandardMutationError
    },
    authToken: {
      type: GraphQLID,
      description: 'The new auth token'
    },
    userId: {
      type: GraphQLID
    },
    user: {
      type: User,
      description: 'the newly created user',
      resolve: ({userId}, _args: unknown, {dataLoader}) => {
        return userId ? dataLoader.get('users').load(userId) : null
      }
    }
  })
})

export default SignUpWithPasswordPayload
