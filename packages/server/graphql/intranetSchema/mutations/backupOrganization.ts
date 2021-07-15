import {GraphQLID, GraphQLList, GraphQLNonNull, GraphQLString} from 'graphql'
import getRethink from '../../../database/rethinkDriver'
import {requireSU} from '../../../utils/authorization'
import {GQLContext} from '../../graphql'
import getPg from '../../../postgres/getPg'
import path from 'path'
import childProcess from 'child_process'
import util from 'util'
import getPgConfig from '../../../postgres/getPgConfig'
import {Client} from 'pg'
import {getPgMigrationsQuery} from '../../../postgres/queries/generated/getPgMigrationsQuery'
import {insertPgMigrationsQuery} from '../../../postgres/queries/generated/insertPgMigrationsQuery'
import {getPgPostDeployMigrationsQuery} from '../../../postgres/queries/generated/getPgPostDeployMigrationsQuery'
import {insertPgPostDeployMigrationsQuery} from '../../../postgres/queries/generated/insertPgPostDeployMigrationsQuery'
import {getOrgUserAuditByOrgIdQuery} from '../../../postgres/queries/generated/getOrgUserAuditByOrgIdQuery'
import {insertOrgUserAuditQuery} from '../../../postgres/queries/generated/insertOrgUserAuditQuery'
import {getTeamsByOrgIdQuery} from '../../../postgres/queries/generated/getTeamsByOrgIdQuery'
import {insertTeamsQuery} from '../../../postgres/queries/generated/insertTeamsQuery'
import {getGitHubAuthByTeamIdQuery} from '../../../postgres/queries/generated/getGitHubAuthByTeamIdQuery'
import {insertGitHubAuthWithAllColumnsQuery} from '../../../postgres/queries/generated/insertGitHubAuthWithAllColumnsQuery'
import {getDiscussionByTeamIdQuery} from '../../../postgres/queries/generated/getDiscussionByTeamIdQuery'
import {insertDiscussionWithAllColumnsQuery} from '../../../postgres/queries/generated/insertDiscussionWithAllColumnsQuery'
import {getUsersByIdQuery} from '../../../postgres/queries/generated/getUsersByIdQuery'
import {insertUserWithAllColumnsQuery} from '../../../postgres/queries/generated/insertUserWithAllColumnsQuery'
import {getTemplateRefByIdsQuery} from '../../../postgres/queries/generated/getTemplateRefByIdsQuery'
import {insertTemplateRefWithAllColumnsQuery} from '../../../postgres/queries/generated/insertTemplateRefWithAllColumnsQuery'
import {getTemplateScaleRefByIdsQuery} from '../../../postgres/queries/generated/getTemplateScaleRefByIdsQuery'
import {insertTemplateScaleRefWithAllColumnsQuery} from '../../../postgres/queries/generated/insertTemplateScaleRefWithAllColumnsQuery'

const execFilePromise = util.promisify(childProcess.execFile)

const PG_SCRIPTS_DIR = 'packages/server/postgres/scripts'

const runExecFilePromise = async (pathToScript: string, scriptArgs: string[]) => {
  const {stdout, stderr} = await execFilePromise(pathToScript, scriptArgs)
  console.log(stdout)
  console.log(stderr)
}

const backupPgOrganization = async (orgIds: string[]) => {
  const orgBackupDbName = 'orgBackup'
  const schemaDumpFileName = 'schemaDump.tar.gz'

  const dumpScriptPath = path.resolve(process.cwd(), PG_SCRIPTS_DIR, 'dump.sh')
  const createScriptPath = path.resolve(process.cwd(), PG_SCRIPTS_DIR, 'createDB.sh')
  const restoreScriptPath = path.resolve(process.cwd(), PG_SCRIPTS_DIR, 'restoreDB.sh')

  await runExecFilePromise(dumpScriptPath, [`-Fc --schema-only -f ${schemaDumpFileName}`])
  await runExecFilePromise(createScriptPath, [orgBackupDbName])
  await runExecFilePromise(restoreScriptPath, [`-d ${orgBackupDbName} ${schemaDumpFileName}`])

  const mainPg = getPg()
  const mainClient = await mainPg.connect()

  // TODO: limit the number of max connections
  const defaultConfig = getPgConfig()
  const orgBackupConfig = Object.assign(defaultConfig, {database: orgBackupDbName})
  const orgBackupClient = new Client(orgBackupConfig)
  await orgBackupClient.connect()

  // make postgres use seq generator so orgBackup will has correct seq values
  const removeId = (row) => Object.assign(row, {id: undefined})

  try {
    const pgMigrations = (await getPgMigrationsQuery.run(undefined, mainClient)).map(removeId)
    !!pgMigrations.length &&
      (await insertPgMigrationsQuery.run({migrationRows: pgMigrations}, orgBackupClient))

    const pgPostDeployMigrations = (
      await getPgPostDeployMigrationsQuery.run(undefined, mainClient)
    ).map(removeId)
    !!pgPostDeployMigrations.length &&
      (await insertPgPostDeployMigrationsQuery.run(
        {migrationRows: pgPostDeployMigrations},
        orgBackupClient
      ))

    const teams = await getTeamsByOrgIdQuery.run({orgIds}, mainClient)
    !!teams.length && (await insertTeamsQuery.run({teams}, orgBackupClient))
    const teamIds = teams.map(({id}) => id)

    // by organizations
    const auditRows = (await getOrgUserAuditByOrgIdQuery.run({orgIds}, mainClient)).map(removeId)
    !!auditRows.length && (await insertOrgUserAuditQuery.run({auditRows}, orgBackupClient))

    // by teams
    const githubAuths = await getGitHubAuthByTeamIdQuery.run({teamIds}, mainClient)
    !!githubAuths.length &&
      (await insertGitHubAuthWithAllColumnsQuery.run({auths: githubAuths}, orgBackupClient))

    const discussions = await getDiscussionByTeamIdQuery.run({teamIds}, mainClient)
    !!discussions.length &&
      (await insertDiscussionWithAllColumnsQuery.run({discussions}, orgBackupClient))

    const r = await getRethink()
    const userIds = await r
      .table('TeamMember')
      .getAll(r.args(teamIds), {index: 'teamId'})('userId')
      .coerceTo('array')
      .distinct()
      .run()

    const users = await getUsersByIdQuery.run({ids: userIds}, mainClient)
    !!users.length && (await insertUserWithAllColumnsQuery.run({users}, orgBackupClient))

    const templateRefIds = await (r
      .table('NewMeeting')
      .getAll(r.args(teamIds), {index: 'teamId'})
      .filter((row) => row.hasFields('templateRefId')) as any)('templateRefId')
      .coerceTo('array')
      .run()

    const templateRefs = await getTemplateRefByIdsQuery.run({ids: templateRefIds}, mainClient)
    !!templateRefs.length &&
      (await insertTemplateRefWithAllColumnsQuery.run({refs: templateRefs}, orgBackupClient))

    const scaleRefIds = Array.from(
      new Set(
        templateRefs.reduce(
          (acc, curr) =>
            acc.concat((curr as any).template.dimensions.map(({scaleRefId}) => scaleRefId)),
          []
        )
      )
    )

    const scaleRefs = await getTemplateScaleRefByIdsQuery.run({ids: scaleRefIds}, mainClient)
    !!scaleRefs.length &&
      (await insertTemplateScaleRefWithAllColumnsQuery.run({refs: scaleRefs}, orgBackupClient))
  } catch (e) {
    console.log(e)
  } finally {
    mainClient.release()
    orgBackupClient.end()
  }
}

const backupOrganization = {
  type: GraphQLNonNull(GraphQLString),
  description: 'copies all the records from RethinkDB for a list of organizations',
  args: {
    orgIds: {
      type: GraphQLNonNull(GraphQLList(GraphQLNonNull(GraphQLID)))
    }
  },
  resolve: async (_source, {orgIds}, {authToken}: GQLContext) => {
    // AUTH
    requireSU(authToken)

    // RESOLUTION
    const r = await getRethink()
    r
    await backupPgOrganization(orgIds)

    // create the DB
    // try {
    //   await r.dbDrop(DESTINATION).run()
    // } catch (e) {
    //   // db never existed. all good
    // }
    // await r.dbCreate(DESTINATION).run()
    // // create all the tables
    // await (r.tableList() as any)
    //   .forEach((table) => {
    //     return r.db(DESTINATION).tableCreate(table)
    //   })
    //   .run()

    // now create all the indexes
    // await (r.tableList() as any)
    //   .forEach((table) => {
    //     return r
    //       .table(table)
    //       .indexStatus()
    //       .forEach((idx) => {
    //         return r
    //           .db(DESTINATION)
    //           .table(table)
    //           .indexCreate(idx('index'), idx('function'), {
    //             geo: (idx('geo') as any) as boolean,
    //             multi: (idx('multi') as any) as boolean
    //           })
    //       })
    //   })
    //   .run()

    // get all the teams for the orgIds
    // const team = await r
    //   .table('Team')
    //   .getAll(r.args(orgIds), {index: 'orgId'})
    //   .run()
    // const teamIds = team.map((team) => team.id)
    // await r({
    //   // easy things to clone
    //   migrations: r
    //     .table('_migrations' as any)
    //     .coerceTo('array')
    //     .do((items) =>
    //       r
    //         .db(DESTINATION)
    //         .table('_migrations' as any)
    //         .insert(items)
    //     ),
    //   agendaItem: (r.table('AgendaItem').getAll(r.args(teamIds), {index: 'teamId'}) as any)
    //     .coerceTo('array')
    //     .do((items) =>
    //       r
    //         .db(DESTINATION)
    //         .table('AgendaItem')
    //         .insert(items)
    //     ),
    //   atlassianAuth: (r.table('AtlassianAuth').getAll(r.args(teamIds), {index: 'teamId'}) as any)
    //     .coerceTo('array')
    //     .do((items) =>
    //       r
    //         .db(DESTINATION)
    //         .table('AtlassianAuth')
    //         .insert(items)
    //     ),
    //   invoice: (r.table('Invoice').filter((row) => r(orgIds).contains(row('orgId'))) as any)
    //     .coerceTo('array')
    //     .do((items) =>
    //       r
    //         .db(DESTINATION)
    //         .table('Invoice')
    //         .insert(items)
    //     ),
    //   invoiceItemHook: (r
    //     .table('InvoiceItemHook')
    //     .filter((row) => r(orgIds).contains(row('orgId'))) as any)
    //     .coerceTo('array')
    //     .do((items) =>
    //       r
    //         .db(DESTINATION)
    //         .table('InvoiceItemHook')
    //         .insert(items)
    //     ),
    //   meetingMember: (r.table('MeetingMember').getAll(r.args(teamIds), {index: 'teamId'}) as any)
    //     .coerceTo('array')
    //     .do((items) =>
    //       r
    //         .db(DESTINATION)
    //         .table('MeetingMember')
    //         .insert(items)
    //     ),
    //   meetingSettings: (r
    //     .table('MeetingSettings')
    //     .getAll(r.args(teamIds), {index: 'teamId'}) as any)
    //     .coerceTo('array')
    //     .do((items) =>
    //       r
    //         .db(DESTINATION)
    //         .table('MeetingSettings')
    //         .insert(items)
    //     ),
    //   newMeeting: (r.table('NewMeeting').getAll(r.args(teamIds), {index: 'teamId'}) as any)
    //     .coerceTo('array')
    //     .do((items) =>
    //       r
    //         .db(DESTINATION)
    //         .table('NewMeeting')
    //         .insert(items)
    //     ),
    //   organization: (r.table('Organization').getAll(r.args(orgIds)) as any)
    //     .coerceTo('array')
    //     .do((items) =>
    //       r
    //         .db(DESTINATION)
    //         .table('Organization')
    //         .insert(items)
    //     ),
    //   organizationUser: (r
    //     .table('OrganizationUser')
    //     .getAll(r.args(orgIds), {index: 'orgId'}) as any)
    //     .coerceTo('array')
    //     .do((items) =>
    //       r
    //         .db(DESTINATION)
    //         .table('OrganizationUser')
    //         .insert(items)
    //     ),
    //   reflectPrompt: (r.table('ReflectPrompt').getAll(r.args(teamIds), {index: 'teamId'}) as any)
    //     .coerceTo('array')
    //     .do((items) =>
    //       r
    //         .db(DESTINATION)
    //         .table('ReflectPrompt')
    //         .insert(items)
    //     ),
    //   meetingTemplate: (r
    //     .table('MeetingTemplate')
    //     .getAll(r.args(teamIds), {index: 'teamId'}) as any)
    //     .coerceTo('array')
    //     .do((items) =>
    //       r
    //         .db(DESTINATION)
    //         .table('MeetingTemplate')
    //         .insert(items)
    //     ),
    //   templateDimension: (r
    //     .table('TemplateDimension')
    //     .filter((row) => r(teamIds).contains(row('teamId'))) as any)
    //     .coerceTo('array')
    //     .do((items) =>
    //       r
    //         .db(DESTINATION)
    //         .table('TemplateDimension')
    //         .insert(items)
    //     ),
    //   templateScale: (r
    //     .table('TemplateScale')
    //     .filter((row) => r(teamIds).contains(row('teamId'))) as any)
    //     .coerceTo('array')
    //     .do((items) =>
    //       r
    //         .db(DESTINATION)
    //         .table('TemplateScale')
    //         .insert(items)
    //     ),
    //   slackAuth: (r.table('SlackAuth').getAll(r.args(teamIds), {index: 'teamId'}) as any)
    //     .coerceTo('array')
    //     .do((items) =>
    //       r
    //         .db(DESTINATION)
    //         .table('SlackAuth')
    //         .insert(items)
    //     ),
    //   slackNotification: (r
    //     .table('SlackNotification')
    //     .getAll(r.args(teamIds), {index: 'teamId'}) as any)
    //     .coerceTo('array')
    //     .do((items) =>
    //       r
    //         .db(DESTINATION)
    //         .table('SlackNotification')
    //         .insert(items)
    //     ),
    //   task: (r.table('Task').getAll(r.args(teamIds), {index: 'teamId'}) as any)
    //     .coerceTo('array')
    //     .do((items) =>
    //       r
    //         .db(DESTINATION)
    //         .table('Task')
    //         .insert(items)
    //     ),
    //   team: r
    //     .db(DESTINATION)
    //     .table('Team')
    //     .insert(team),
    //   teamInvitation: (r.table('TeamInvitation').getAll(r.args(teamIds), {index: 'teamId'}) as any)
    //     .coerceTo('array')
    //     .do((items) =>
    //       r
    //         .db(DESTINATION)
    //         .table('TeamInvitation')
    //         .insert(items)
    //     ),
    //   teamMember: (r.table('TeamMember').getAll(r.args(teamIds), {index: 'teamId'}) as any)
    //     .coerceTo('array')
    //     .do((items) =>
    //       r
    //         .db(DESTINATION)
    //         .table('TeamMember')
    //         .insert(items)
    //     ),
    //   // hard things to clone
    //   userIds: r
    //     .table('TeamMember')
    //     .getAll(r.args(teamIds), {index: 'teamId'})('userId')
    //     .coerceTo('array')
    //     .distinct()
    //     .do((userIds) => {
    //       return r({
    //         notification: (r
    //           .table('Notification')
    //           .getAll(r.args(userIds), {index: 'userId'}) as any)
    //           .filter((notification) =>
    //             r.branch(
    //               notification('teamId')
    //                 .default(null)
    //                 .ne(null),
    //               r(teamIds).contains(notification('teamId')),
    //               notification('orgId')
    //                 .default(null)
    //                 .ne(null),
    //               r(orgIds).contains(notification('orgId')),
    //               true
    //             )
    //           )
    //           .coerceTo('array')
    //           .do((items) =>
    //             r
    //               .db(DESTINATION)
    //               .table('Notification')
    //               .insert(items)
    //           ),
    //         suggestedAction: (r
    //           .table('SuggestedAction')
    //           .getAll(r.args(userIds), {index: 'userId'}) as any)
    //           .filter((row) =>
    //             r.or(
    //               row('teamId')
    //                 .default(null)
    //                 .eq(null),
    //               r(teamIds).contains(row('teamId'))
    //             )
    //           )
    //           .coerceTo('array')
    //           .do((items) =>
    //             r
    //               .db(DESTINATION)
    //               .table('SuggestedAction')
    //               .insert(items)
    //           ),
    //         timelineEvent: (r
    //           .table('TimelineEvent')
    //           .filter((row) => r(userIds).contains(row('userId'))) as any)
    //           .filter((row) => r.branch(row('teamId'), r(teamIds).contains(row('teamId')), true))
    //           .coerceTo('array')
    //           .do((items) =>
    //             r
    //               .db(DESTINATION)
    //               .table('TimelineEvent')
    //               .insert(items)
    //           ),
    //         user: (r.table('User').getAll(r.args(userIds)) as any).coerceTo('array').do((items) =>
    //           r
    //             .db(DESTINATION)
    //             .table('User')
    //             .insert(items)
    //         )
    //       })
    //     }),
    //   activeDomains: r
    //     .table('Organization')
    //     .getAll(r.args(orgIds))('activeDomain')
    //     .coerceTo('array')
    //     .do((domains) => {
    //       return r({
    //         SAML: (r.table('SAML').getAll(r.args(domains), {index: 'domains'}) as any)
    //           .coerceTo('array')
    //           .do((items) =>
    //             r
    //               .db(DESTINATION)
    //               .table('SAML')
    //               .insert(items)
    //           ),
    //         secureDomain: (r
    //           .table('SecureDomain')
    //           .getAll(r.args(domains), {index: 'domain'}) as any)
    //           .coerceTo('array')
    //           .do((items) =>
    //             r
    //               .db(DESTINATION)
    //               .table('SecureDomain')
    //               .insert(items)
    //           )
    //       })
    //     }),
    //   meetingIds: r
    //     .table('NewMeeting')
    //     .getAll(r.args(teamIds), {index: 'teamId'})('id')
    //     .coerceTo('array')
    //     .do((meetingIds) => {
    //       return r({
    //         retroReflection: (r
    //           .table('RetroReflection')
    //           .getAll(r.args(meetingIds), {index: 'meetingId'}) as any)
    //           .coerceTo('array')
    //           .do((items) =>
    //             r
    //               .db(DESTINATION)
    //               .table('RetroReflection')
    //               .insert(items)
    //           ),
    //         retroReflectionGroup: (r
    //           .table('RetroReflectionGroup')
    //           .getAll(r.args(meetingIds), {index: 'meetingId'}) as any)
    //           .coerceTo('array')
    //           .do((items) =>
    //             r
    //               .db(DESTINATION)
    //               .table('RetroReflectionGroup')
    //               .insert(items)
    //           ),
    //         // really hard things to clone
    //         reflectionGroupComments: r
    //           .table('RetroReflectionGroup')
    //           .getAll(r.args(meetingIds), {index: 'meetingId'})('id')
    //           .coerceTo('array')
    //           .do((discussionIds) => {
    //             return (r
    //               .table('Comment')
    //               .getAll(r.args(discussionIds), {index: 'discussionId'}) as any)
    //               .coerceTo('array')
    //               .do((items) =>
    //                 r
    //                   .db(DESTINATION)
    //                   .table('Comment')
    //                   .insert(items)
    //               )
    //           }),
    //         agendaItemComments: r
    //           .table('AgendaItem')
    //           .getAll(r.args(meetingIds), {index: 'meetingId'})('id')
    //           .coerceTo('array')
    //           .do((discussionIds) => {
    //             return (r
    //               .table('Comment')
    //               .getAll(r.args(discussionIds), {index: 'discussionId'}) as any)
    //               .coerceTo('array')
    //               .do((items) =>
    //                 r
    //                   .db(DESTINATION)
    //                   .table('Comment')
    //                   .insert(items)
    //               )
    //           })
    //       })
    //     })
    // }).run()

    // remove teamIds that are not part of the desired orgIds
    // await r
    //   .db('orgBackup')
    //   .table('User')
    //   .update((row) => ({
    //     tms: row('tms')
    //       .innerJoin(r(teamIds), (a, b) => a.eq(b))
    //       .zip()
    //   }))
    //   .run()

    return `Success! 'orgBackup' contains all the records for ${orgIds.join(', ')}`
  }
}
export default backupOrganization
