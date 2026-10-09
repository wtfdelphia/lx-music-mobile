import { useMemo, useImperativeHandle, forwardRef, useState, useRef } from 'react'
import { useI18n } from '@/lang'

import Menu, { type MenuType, type Position } from '@/components/common/Menu'
import { confirmDialog } from '@/utils/tools'
import { pauseTasks, removeTasks, startTasks } from '@/core/download'
import { playListById } from '@/core/player/player'
import { LIST_IDS } from '@/config/constant'

export interface SelectInfo {
  downloadInfo: LX.Download.ListItem
  selectedList: LX.Download.ListItem[]
}

const initSelectInfo: SelectInfo = {
  downloadInfo: undefined as unknown as LX.Download.ListItem,
  selectedList: [],
}

export interface ListMenuProps {
  onHideMenu: () => void
}
export interface ListMenuType {
  show: (downloadInfo: SelectInfo['downloadInfo'], selectedList: SelectInfo['selectedList'], position: Position) => void
}

export default forwardRef<ListMenuType, ListMenuProps>(({ onHideMenu }, ref) => {
  const t = useI18n()
  const menuRef = useRef<MenuType>(null)
  const selectInfoRef = useRef<SelectInfo>(initSelectInfo)
  const [visible, setVisible] = useState(false)
  // 菜单项的禁用状态跟随当前选中任务，用 state 触发重算
  const [menuStatus, setMenuStatus] = useState<LX.Download.DownloadTaskStatus | undefined>()

  useImperativeHandle(ref, () => ({
    show(downloadInfo, selectedList, position) {
      selectInfoRef.current = { downloadInfo, selectedList }
      setMenuStatus(downloadInfo.status)
      if (visible) menuRef.current?.show(position)
      else {
        setVisible(true)
        requestAnimationFrame(() => {
          menuRef.current?.show(position)
        })
      }
    },
  }))

  const menus = useMemo(() => {
    const isRun = menuStatus === 'run' || menuStatus === 'waiting'
    const canStart = menuStatus === 'pause' || menuStatus === 'error' || menuStatus === 'completed'
    return [
      { action: 'play', label: t('play') },
      { action: 'start', label: t('download__menu_start'), disabled: !canStart },
      { action: 'pause', label: t('download__menu_pause'), disabled: !isRun },
      { action: 'remove', label: t('delete') },
      { action: 'removeFile', label: t('download__menu_remove_file') },
    ] as const
  }, [t, menuStatus])

  const handleMenuPress = ({ action }: typeof menus[number]) => {
    const { downloadInfo, selectedList } = selectInfoRef.current
    const targets = selectedList.length ? selectedList : [downloadInfo]
    switch (action) {
      case 'play':
        void playListById(LIST_IDS.DOWNLOAD, downloadInfo.id)
        break
      case 'start':
        startTasks(targets)
        break
      case 'pause':
        void pauseTasks(targets)
        break
      case 'remove':
        void confirmDialog({
          message: t('download__remove_tip'),
          confirmButtonText: t('delete'),
        }).then(async(isRemove) => {
          if (isRemove) await removeTasks(targets, false)
        })
        break
      case 'removeFile':
        void confirmDialog({
          message: t('download__remove_file_tip'),
          confirmButtonText: t('delete'),
        }).then(async(isRemove) => {
          if (isRemove) await removeTasks(targets, true)
        })
        break
      default:
        break
    }
  }

  return (
    visible
      ? <Menu ref={menuRef} menus={menus} onPress={handleMenuPress} onHide={onHideMenu} />
      : null
  )
})
