import {useMemo} from 'react'
import getBBox, {RectElement} from 'universal/components/RetroReflectPhase/getBBox'
import useCoords, {MenuPosition, UseCoordsOptions} from 'universal/hooks/useCoords'
import useLoadingDelay from 'universal/hooks/useLoadingDelay'
import useTooltipPortal from 'universal/hooks/useTooltipPortal'
import usePortal, {PortalStatus, UsePortalOptions} from 'universal/hooks/usePortal'

interface Options extends UsePortalOptions, UseCoordsOptions {
  loadingWidth?: number
  isDropdown?: boolean
}

export interface TooltipProps {
  openPortal: () => void
  closePortal: () => void
  portalStatus: PortalStatus
  isDropdown: boolean
}

const useTooltip = (preferredMenuPosition: MenuPosition, options: Options = {}) => {
  const {onOpen, onClose, originCoords} = options
  const isDropdown = !!options.isDropdown
  const {targetRef, originRef, coords, menuPosition} = useCoords(preferredMenuPosition, {
    originCoords
  })
  if (originCoords) {
    (originRef as any).current = {getBoundingClientRect: () => originCoords} as RectElement
  }
  const {portal, openPortal, closePortal, togglePortal, portalStatus, setPortalStatus} = usePortal({
    onOpen,
    onClose
  })
  const loadingWidth = useMemo(() => {
    if (options.loadingWidth) return options.loadingWidth
    const bbox = getBBox(originRef.current)
    return Math.max(40, bbox ? bbox.width : 40)
  }, [originRef.current])
  const {loadingDelay, loadingDelayRef} = useLoadingDelay()
  const tooltipPortal = useTooltipPortal(
    portal,
    targetRef,
    loadingWidth,
    coords,
    portalStatus,
    setPortalStatus,
    isDropdown,
    menuPosition,
    loadingDelayRef
  )
  const tooltipProps = {portalStatus, openPortal, closePortal, isDropdown}
  return {
    openPortal,
    closePortal,
    togglePortal,
    originRef,
    tooltipPortal,
    tooltipProps,
    loadingDelay,
    loadingWidth
  }
}

export default useTooltip
