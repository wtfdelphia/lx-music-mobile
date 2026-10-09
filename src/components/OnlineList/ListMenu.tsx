import { useMemo, useRef, useImperativeHandle, forwardRef, useState } from 'react'
import { useI18n } from '@/lang'
import Menu, { type MenuType, type Position } from '@/components/common/Menu'
import { hasDislike } from '@/core/dislikeList'
import { isDownloadSupported } from '@/core/download'
import { useSettingValue } from '@/store/setting/hook'

export interface SelectInfo {
  musicInfo: LX.Music.MusicInfoOnline
  selectedList: LX.Music.MusicInfoOnline[]
  index: number
  single: boolean
}
const initSelectInfo = {}

export interface ListMenuProps {
  onPlay: (selectInfo: SelectInfo) => void
  onPlayLater: (selectInfo: SelectInfo) => void
  onDownload: (selectInfo: SelectInfo) => void
  onAdd: (selectInfo: SelectInfo) => void
  onCopyName: (selectInfo: SelectInfo) => void
  onMusicSourceDetail: (selectInfo: SelectInfo) => void
  onDislikeMusic: (selectInfo: SelectInfo) => void
}
export interface ListMenuType {
  show: (selectInfo: SelectInfo, position: Position) => void
}

export type {
  Position,
}

export default forwardRef<ListMenuType, ListMenuProps>((props: ListMenuProps, ref) => {
  const t = useI18n()
  const [visible, setVisible] = useState(false)
  const menuRef = useRef<MenuType>(null)
  const selectInfoRef = useRef<SelectInfo>(initSelectInfo as SelectInfo)
  const [isDislikeMusic, setDislikeMusic] = useState(false)
  // §10.2：下载项显示条件 = 平台支持 ∧ 功能开启 ∧ 非本地歌曲（本地歌曲在在线列表不出现，此处恒成立）
  const downloadEnable = useSettingValue('download.enable')
  const showDownload = isDownloadSupported() && downloadEnable

  useImperativeHandle(ref, () => ({
    show(selectInfo, position) {
      selectInfoRef.current = selectInfo
      setDislikeMusic(hasDislike(selectInfo.musicInfo))
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
    const menu = [
      { action: 'play', label: t('play') },
      { action: 'playLater', label: t('play_later') },
      { action: 'add', label: t('add_to') },
      { action: 'copyName', label: t('copy_name') },
      { action: 'musicSourceDetail', label: t('music_source_detail') },
      { action: 'dislike', label: t('dislike'), disabled: isDislikeMusic },
    ]
    // 下载项插在 playLater 之后，仅在支持且开启时出现
    if (showDownload) menu.splice(2, 0, { action: 'download', label: t('download') })
    return menu
  }, [t, isDislikeMusic, showDownload])

  const handleMenuPress = ({ action }: typeof menus[number]) => {
    const selectInfo = selectInfoRef.current
    switch (action) {
      case 'play':
        props.onPlay(selectInfo)
        break
      case 'playLater':
        props.onPlayLater(selectInfo)
        break
      case 'download':
        props.onDownload(selectInfo)
        break
      case 'add':
        props.onAdd(selectInfo)
        break
      case 'copyName':
        props.onCopyName(selectInfo)
        break
      case 'musicSourceDetail':
        props.onMusicSourceDetail(selectInfo)
        // setVIsibleMusicPosition(true)
        break
      case 'dislike':
        props.onDislikeMusic(selectInfo)
        break
      default:
        break
    }
  }

  return (
    visible
      ? <Menu ref={menuRef} menus={menus} onPress={handleMenuPress} />
      : null
  )
})
