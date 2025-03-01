import {GraphQLInt, GraphQLNonNull} from 'graphql'
import {DataLoaderWorker} from '../../graphql'
import {SubscriptionChannel} from 'parabol-client/types/constEnums'
import getRethink from '../../../database/rethinkDriver'
import NotificationMeetingStageTimeLimitEnd from '../../../database/types/NotificationMeetingStageTimeLimitEnd'
import ScheduledJobMeetingStageTimeLimit from '../../../database/types/ScheduledJobMetingStageTimeLimit'
import SlackAuth from '../../../database/types/SlackAuth'
import SlackNotification from '../../../database/types/SlackNotification'
import {requireSU} from '../../../utils/authorization'
import makeAppURL from 'parabol-client/utils/makeAppURL'
import publish from '../../../utils/publish'
import SlackServerManager from '../../../utils/SlackServerManager'
import appOrigin from '../../../appOrigin'
import {notifyMattermostTimeLimitEnd} from '../../mutations/helpers/notifications/notifyMattermost'
import {ValueOf} from '../../../../client/types/generics'

const getSlackNotificationAndAuth = async (teamId, facilitatorUserId) => {
  const r = await getRethink()
  const {slackNotification, slackAuth} = await r({
    slackNotification: r
      .table('SlackNotification')
      .getAll(facilitatorUserId, {index: 'userId'})
      .filter({teamId, event: 'MEETING_STAGE_TIME_LIMIT_END'})
      .nth(0)
      .default(null) as unknown as SlackNotification,
    slackAuth: r
      .table('SlackAuth')
      .getAll(facilitatorUserId, {index: 'userId'})
      .filter({teamId})
      .nth(0)
      .default(null) as unknown as SlackAuth
  }).run()
  return {slackNotification, slackAuth}
}

const processMeetingStageTimeLimits = async (
  job: ScheduledJobMeetingStageTimeLimit,
  {dataLoader}: {dataLoader: DataLoaderWorker}
) => {
  // get the meeting
  // get the facilitator
  // see if the facilitator has turned on slack notifications for the meeting
  // detect integrated services
  // if slack, send slack
  // if mattermost, send mattermost
  // if no integrated notification services, send an in-app notification
  const {meetingId} = job
  const meeting = await dataLoader.get('newMeetings').load(meetingId)
  const {teamId, facilitatorUserId} = meeting
  const [{slackNotification, slackAuth}, mattermostAuth] = await Promise.all([
    getSlackNotificationAndAuth(teamId, facilitatorUserId),
    dataLoader.get('mattermostBestAuthByUserIdTeamId').load({userId: facilitatorUserId, teamId})
  ])
  const meetingUrl = makeAppURL(appOrigin, `meet/${meetingId}`)

  const sendViaMattermost = !!mattermostAuth

  if (slackAuth?.botAccessToken && slackNotification?.channelId) {
    const manager = new SlackServerManager(slackAuth.botAccessToken)
    const slackText = `Time’s up! Advance your meeting to the next phase: ${meetingUrl}`
    const res = await manager.postMessage(slackNotification.channelId, slackText)
    if (res.ok && !sendViaMattermost) return
  }

  if (sendViaMattermost) {
    const res = await notifyMattermostTimeLimitEnd(meetingId, teamId, dataLoader)
    if (!(res instanceof Error)) return
  }

  const notification = new NotificationMeetingStageTimeLimitEnd({
    meetingId,
    userId: facilitatorUserId
  })
  const r = await getRethink()
  await r.table('Notification').insert(notification).run()
  publish(SubscriptionChannel.NOTIFICATION, facilitatorUserId, 'MeetingStageTimeLimitPayload', {
    notification
  })
}

const jobProcessors = {
  MEETING_STAGE_TIME_LIMIT_END: processMeetingStageTimeLimits
}

export type ScheduledJobUnion = Parameters<ValueOf<typeof jobProcessors>>[0]

const processJob = async (job: ScheduledJobUnion, {dataLoader}) => {
  const r = await getRethink()
  const res = await r.table('ScheduledJob').get(job.id).delete().run()
  // prevent duplicates. after this point, we assume the job finishes to completion (ignores server crashes, etc.)
  if (res.deleted !== 1) return
  const processor = jobProcessors[job.type]
  processor(job, {dataLoader}).catch(console.log)
}

const runScheduledJobs = {
  type: GraphQLInt,
  description: 'schedule upcoming jobs to be run',
  args: {
    seconds: {
      type: new GraphQLNonNull(GraphQLInt),
      description: 'Queue up all jobs that are scheduled to run within this many seconds'
    }
    // type: {
    //   type: GraphQLString,
    //   description: 'filter jobs by their type'
    // }
  },
  resolve: async (_source: unknown, {seconds}, {authToken, dataLoader}) => {
    const r = await getRethink()
    const now = new Date()
    // AUTH
    requireSU(authToken)

    // RESOLUTION
    const before = new Date(now.getTime() + seconds * 1000)
    const upcomingJobs = await r
      .table('ScheduledJob')
      .between(r.minval, before, {index: 'runAt'})
      .run()

    upcomingJobs.forEach((job) => {
      const {runAt} = job
      const timeout = Math.max(0, runAt.getTime() - now.getTime())
      setTimeout(() => {
        processJob(job, {dataLoader}).catch(console.log)
      }, timeout)
    })

    return upcomingJobs.length
  }
}

export default runScheduledJobs
