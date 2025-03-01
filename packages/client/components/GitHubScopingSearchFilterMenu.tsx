import styled from '@emotion/styled'
import graphql from 'babel-plugin-relay/macro'
import React, {useMemo} from 'react'
import {commitLocalUpdate, PreloadedQuery, usePreloadedQuery} from 'react-relay'
import useAtmosphere from '../hooks/useAtmosphere'
import useFilteredItems from '../hooks/useFilteredItems'
import useForm from '../hooks/useForm'
import {MenuProps} from '../hooks/useMenu'
import SearchQueryId from '../shared/gqlIds/SearchQueryId'
import {PALETTE} from '../styles/paletteV3'
import {ICON_SIZE} from '../styles/typographyV2'
import {IXGitHubCreatedCommitContribution} from '../types/graphql'
import getReposFromQueryStr from '../utils/getReposFromQueryStr'
import {
  GitHubScopingSearchFilterMenuQuery,
  GitHubScopingSearchFilterMenuQueryResponse
} from '../__generated__/GitHubScopingSearchFilterMenuQuery.graphql'
import Checkbox from './Checkbox'
import Icon from './Icon'
import Menu from './Menu'
import MenuItem from './MenuItem'
import MenuItemComponentAvatar from './MenuItemComponentAvatar'
import MenuItemLabel from './MenuItemLabel'
import MenuSearch from './MenuSearch'
import TypeAheadLabel from './TypeAheadLabel'

const SearchIcon = styled(Icon)({
  color: PALETTE.SLATE_600,
  fontSize: ICON_SIZE.MD18
})

const NoResults = styled(MenuItemLabel)({
  color: PALETTE.SLATE_600,
  justifyContent: 'center',
  paddingLeft: 8,
  paddingRight: 8,
  fontStyle: 'italic'
})

const SearchItem = styled(MenuItemLabel)({
  margin: '0 8px 8px',
  overflow: 'visible',
  padding: 0,
  position: 'relative'
})

const StyledMenuItemIcon = styled(MenuItemComponentAvatar)({
  position: 'absolute',
  left: 8,
  margin: 0,
  pointerEvents: 'none',
  top: 4
})

const StyledCheckBox = styled(Checkbox)({
  marginLeft: -8,
  marginRight: 8
})
const StyledMenuItemLabel = styled(MenuItemLabel)({})

interface Props {
  menuProps: MenuProps
  queryRef: PreloadedQuery<GitHubScopingSearchFilterMenuQuery>
}

type GitHubSearchQuery = NonNullable<
  NonNullable<GitHubScopingSearchFilterMenuQueryResponse['viewer']['meeting']>['githubSearchQuery']
>

type Contribution = Pick<IXGitHubCreatedCommitContribution, 'occurredAt' | 'repository'>

const MAX_REPOS = 10

const getValue = (item: {nameWithOwner?: string}) => {
  const repoName = item.nameWithOwner || 'Unknown Repo'
  return repoName.toLowerCase()
}

const GitHubScopingSearchFilterMenu = (props: Props) => {
  const {menuProps, queryRef} = props
  const query = usePreloadedQuery<GitHubScopingSearchFilterMenuQuery>(
    graphql`
      query GitHubScopingSearchFilterMenuQuery($teamId: ID!, $meetingId: ID!) {
        viewer {
          meeting(meetingId: $meetingId) {
            id
            ... on PokerMeeting {
              githubSearchQuery {
                queryString
              }
            }
          }
          teamMember(teamId: $teamId) {
            integrations {
              github {
                api {
                  query {
                    viewer {
                      contributionsCollection {
                        commitContributionsByRepository(maxRepositories: 100) {
                          contributions(orderBy: {field: OCCURRED_AT, direction: DESC}, first: 1) {
                            nodes {
                              occurredAt
                              repository {
                                id
                                nameWithOwner
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `,
    queryRef,
    {UNSTABLE_renderPolicy: 'full'}
  )

  const meeting = query?.viewer?.meeting
  const meetingId = meeting?.id ?? ''
  const githubSearchQuery = meeting?.githubSearchQuery
  const queryString = githubSearchQuery?.queryString ?? null
  const atmosphere = useAtmosphere()
  const contributionsByRepo =
    query?.viewer?.teamMember?.integrations.github?.api?.query?.viewer?.contributionsCollection
      ?.commitContributionsByRepository ?? []
  const repoContributions = useMemo(() => {
    const contributions = contributionsByRepo.map((contributionByRepo) =>
      contributionByRepo.contributions.nodes ? contributionByRepo.contributions.nodes[0] : null
    )
    return contributions
      .filter((contribution): contribution is Contribution => !!contribution)
      .sort(
        (a, b) =>
          new Date(b.occurredAt as string).getTime() - new Date(a.occurredAt as string).getTime()
      )
      .map((sortedContributions) => sortedContributions?.repository)
  }, [contributionsByRepo])
  const {fields, onChange} = useForm({
    search: {
      getDefault: () => ''
    }
  })
  const {search} = fields
  const {value} = search
  const searchQuery = value.toLowerCase()
  // TODO parse the query string & extract out the repositories
  const filteredRepoContributions = useFilteredItems(searchQuery, repoContributions, getValue)
  const selectedRepos = getReposFromQueryStr(queryString)
  const selectedAndFilteredRepos = useMemo(() => {
    const adjustedMax = selectedRepos.length >= MAX_REPOS ? selectedRepos.length + 1 : MAX_REPOS
    const repos = filteredRepoContributions.map(({nameWithOwner}) =>
      nameWithOwner.toLowerCase().trim()
    )
    return Array.from(new Set([...selectedRepos, ...repos])).slice(0, adjustedMax)
  }, [filteredRepoContributions])

  const {portalStatus, isDropdown} = menuProps
  return (
    <Menu
      keepParentFocus
      ariaLabel={'Define the GitHub search query'}
      portalStatus={portalStatus}
      isDropdown={isDropdown}
    >
      <SearchItem key='search'>
        <StyledMenuItemIcon>
          <SearchIcon>search</SearchIcon>
        </StyledMenuItemIcon>
        <MenuSearch placeholder={'Search your GitHub repos'} value={value} onChange={onChange} />
      </SearchItem>
      {repoContributions.length === 0 && <NoResults key='no-results'>No repos found!</NoResults>}
      {selectedAndFilteredRepos.map((repo) => {
        const isSelected = selectedRepos.includes(repo)
        const handleClick = () => {
          commitLocalUpdate(atmosphere, (store) => {
            const searchQueryId = SearchQueryId.join('github', meetingId)
            const githubSearchQuery = store.get<GitHubSearchQuery>(searchQueryId)!
            const newFilters = isSelected
              ? selectedRepos.filter((name) => name !== repo)
              : selectedRepos.concat(repo)
            const queryString = githubSearchQuery.getValue('queryString')
            const queryWithoutRepos = queryString
              .trim()
              .split(' ')
              .filter((str) => !str.includes('repo:'))
            const newRepos = newFilters.map((name) => `repo:${name}`)
            const newQueryStr = queryWithoutRepos.concat(newRepos).join(' ')
            githubSearchQuery.setValue(newQueryStr, 'queryString')
          })
        }
        return (
          <MenuItem
            key={repo}
            label={
              <StyledMenuItemLabel>
                <StyledCheckBox active={isSelected} />
                <TypeAheadLabel query={searchQuery} label={repo} />
              </StyledMenuItemLabel>
            }
            onClick={handleClick}
          />
        )
      })}
    </Menu>
  )
}

export default GitHubScopingSearchFilterMenu
