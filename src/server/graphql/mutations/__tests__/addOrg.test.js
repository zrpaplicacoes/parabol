import DynamicSerializer from 'dynamic-serializer';
import MockDate from 'mockdate';
import socket from 'server/__mocks__/socket';
import makeDataLoader from 'server/__tests__/setup/makeDataLoader';
import mockAuthToken from 'server/__tests__/setup/mockAuthToken';
import MockDB from 'server/__tests__/setup/MockDB';
import {__now} from 'server/__tests__/setup/mockTimes';
import fetchAndSerialize from 'server/__tests__/utils/fetchAndSerialize';
import getRethink from 'server/database/rethinkDriver';
import addOrg from 'server/graphql/mutations/addOrg';
import {auth0MgmtClientBuilder} from 'server/utils/auth0Helpers';

MockDate.set(__now);
console.error = jest.fn();

let auth0ManagementClient = null;

describe('addOrg', () => {
  beforeAll(async (done) => {
    auth0ManagementClient = await auth0MgmtClientBuilder();
    done();
  });

  test('adds a new org with no invitees', async () => {
    // SETUP
    const r = getRethink();
    const dynamicSerializer = new DynamicSerializer();
    const mockDB = new MockDB();
    const {organization, user} = await mockDB.init()
      .organization(0);
    const org = organization[0];
    auth0ManagementClient.__initMock(mockDB.db);
    const authToken = mockAuthToken(user[0]);
    const dataLoader = makeDataLoader(authToken);

    // TEST
    const newTeam = {
      name: 'addOrg|1|NewTeamName'
    };
    const orgName = 'addOrg|1|NewOrgName';
    const res = await addOrg.resolve(undefined, {newTeam, orgName}, {authToken, dataLoader, socket});

    const {orgId, teamId} = res;
    // VERIFY
    const db = await fetchAndSerialize({
      organization: r.table('Organization').getAll(orgId, {index: 'id'}).orderBy('name'),
      team: r.table('Team').getAll(orgId, {index: 'orgId'}).orderBy('name'),
      teamMember: r.table('TeamMember').getAll(teamId, {index: 'teamId'}).orderBy('preferredName'),
      user: r.table('User').getAll(org.id, orgId, {index: 'userOrgs'}).orderBy('preferredName')
    }, dynamicSerializer);
    expect(db).toMatchSnapshot();
  });
});
