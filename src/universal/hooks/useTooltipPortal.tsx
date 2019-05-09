import React, {ReactElement, ReactPortal, Suspense, useEffect} from 'react'
import styled from 'react-emotion'
import ErrorBoundary from 'universal/components/ErrorBoundary'
import LoadingComponent from 'universal/components/LoadingComponent/LoadingComponent'
import Menu from 'universal/components/Menu'
import TooltipContents from 'universal/components/TooltipContents'
import ModalError from 'universal/components/ModalError'
import TooltipBackground from 'universal/hooks/TooltipBackground'
import {MenuPosition, UseCoordsValue} from 'universal/hooks/useCoords'
import {LoadingDelayRef} from 'universal/hooks/useLoadingDelay'
import {PortalStatus} from 'universal/hooks/usePortal'
import {Duration, ZIndex} from 'universal/types/constEnums'

const TooltipBlock = styled('div')({
  // no margins or paddings since they could force it too low & cause a scrollbar to appear
  position: 'absolute',
  zIndex: ZIndex.MODAL
})

const useTooltipPortal = (
  portal: (el: ReactElement) => ReactPortal | null,
  targetRef: (el: HTMLElement) => void,
  minWidth: number,
  coords: UseCoordsValue,
  portalStatus: PortalStatus,
  setPortalStatus: any,
  isDropdown: boolean,
  menuPosition: MenuPosition,
  loadingDelayRef: LoadingDelayRef
) => {
  useEffect(() => {
    let isMounted = true
    if (portalStatus === PortalStatus.Entered) {
      setTimeout(() => {
        if (isMounted) {
          setPortalStatus(PortalStatus.AnimatedIn)
        }
      }, Duration.MENU_OPEN_MAX)
    }
    return () => {
      isMounted = false
    }
  }, [portalStatus])
  return (reactEl) => {
    return portal(
      <TooltipBlock innerRef={targetRef} style={{...coords}}>
        <TooltipBackground
          menuPosition={menuPosition}
          portalStatus={portalStatus}
          isDropdown={isDropdown}
        />
        <ErrorBoundary
          fallback={(error) => (
            <Menu ariaLabel='Error' closePortal={undefined as any} portalStatus={portalStatus}>
              <ModalError error={error} portalStatus={portalStatus} />
            </Menu>
          )}
        >
          <TooltipContents minWidth={minWidth} portalStatus={portalStatus}>
            <Suspense
              fallback={
                <LoadingComponent
                  loadingDelayRef={loadingDelayRef}
                  spinnerSize={24}
                  width={minWidth}
                  height={24}
                  showAfter={0}
                />
              }
            >
              {reactEl}
            </Suspense>
          </TooltipContents>
        </ErrorBoundary>
      </TooltipBlock>
    )
  }
}

export default useTooltipPortal
