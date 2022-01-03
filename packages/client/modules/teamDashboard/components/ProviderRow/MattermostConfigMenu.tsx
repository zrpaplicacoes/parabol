import React from 'react'
import useAtmosphere from '../../../../hooks/useAtmosphere'
import {MenuProps} from '../../../../hooks/useMenu'
import {MenuMutationProps} from '../../../../hooks/useMutationProps'
import RemoveIntegrationProviderMutation from '../../../../mutations/RemoveIntegrationProviderMutation'
import Menu from '../../../../components/Menu'
import MenuItem from '../../../../components/MenuItem'
import {Duration} from '../../../../types/constEnums'

interface Props {
  menuProps: MenuProps
  mutationProps: MenuMutationProps
  teamId: string
  providerId: string
}

const MattermostConfigMenu = (props: Props) => {
  const {menuProps, mutationProps, providerId, teamId} = props
  const {onError, onCompleted, submitMutation, submitting} = mutationProps
  const atmosphere = useAtmosphere()

  const removeMattermostAuth = () => {
    if (submitting) return
    submitMutation()
    // wait for the portal to animate closed before removing, otherwise it'll stick around forever
    setTimeout(() => {
      RemoveIntegrationProviderMutation(atmosphere, {providerId, teamId}, {onCompleted, onError})
    }, Duration.PORTAL_CLOSE)
  }
  return (
    <Menu ariaLabel={'Configure your Mattermost integration'} {...menuProps}>
      <MenuItem label='Remove Mattermost' onClick={removeMattermostAuth} />
    </Menu>
  )
}

export default MattermostConfigMenu
