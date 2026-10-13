import { useMemo, useImperativeHandle, forwardRef, useState, useRef } from 'react'
import { useI18n } from '@/lang'

import Menu, { type MenuType, type Position } from '@/components/common/Menu'
import { handlePlay, handlePlayLater } from './listAction'
import type { NativeTrackRow } from '@/core/library/types'

export interface SelectInfo {
  row: NativeTrackRow
  rows: NativeTrackRow[]
  index: number
}

const initSelectInfo: SelectInfo = {
  row: undefined as unknown as NativeTrackRow,
  rows: [],
  index: 0,
}

export interface ListMenuProps {
  onHideMenu: () => void
  onTagInfo: (row: NativeTrackRow) => void
  onAddToList: (row: NativeTrackRow) => void
  onToggleLove: (row: NativeTrackRow) => void
  onSearchLyric: (row: NativeTrackRow) => void
  onViewAlbum: (row: NativeTrackRow) => void
  onViewArtist: (row: NativeTrackRow) => void
  onRemove: (row: NativeTrackRow) => void
  onDeleteFile: (row: NativeTrackRow) => void
  /** 当前曲目是否在「我的收藏」中，决定喜欢项文案 */
  isLoved: (locator: string) => boolean
}
export interface ListMenuType {
  show: (row: NativeTrackRow, rows: NativeTrackRow[], index: number, position: Position) => void
}

export default forwardRef<ListMenuType, ListMenuProps>(({
  onHideMenu,
  onTagInfo,
  onAddToList,
  onToggleLove,
  onSearchLyric,
  onViewAlbum,
  onViewArtist,
  onRemove,
  onDeleteFile,
  isLoved,
}, ref) => {
  const t = useI18n()
  const menuRef = useRef<MenuType>(null)
  const selectInfoRef = useRef<SelectInfo>(initSelectInfo)
  const [visible, setVisible] = useState(false)
  const [loved, setLoved] = useState(false)

  useImperativeHandle(ref, () => ({
    show(row, rows, index, position) {
      selectInfoRef.current = { row, rows, index }
      setLoved(isLoved(row.locator))
      if (visible) menuRef.current?.show(position)
      else {
        setVisible(true)
        requestAnimationFrame(() => {
          menuRef.current?.show(position)
        })
      }
    },
  }))

  const menus = useMemo(() => ([
    { action: 'play', label: t('play') },
    { action: 'playLater', label: t('play_later') },
    { action: 'addToList', label: t('library_add_to_list') },
    { action: 'toggleLove', label: loved ? t('library_unlove') : t('library_love') },
    { action: 'searchLyric', label: t('library_search_lyric') },
    { action: 'viewAlbum', label: t('library_view_album') },
    { action: 'viewArtist', label: t('library_view_artist') },
    { action: 'tagInfo', label: t('library_tag_info') },
    { action: 'remove', label: t('library_remove') },
    { action: 'deleteFile', label: t('library_delete_file') },
  ]), [t, loved])

  const handleMenuPress = ({ action }: typeof menus[number]) => {
    const { row, rows, index } = selectInfoRef.current
    switch (action) {
      case 'play':
        void handlePlay(rows, index)
        break
      case 'playLater':
        void handlePlayLater(row)
        break
      case 'addToList':
        onAddToList(row)
        break
      case 'toggleLove':
        onToggleLove(row)
        break
      case 'searchLyric':
        onSearchLyric(row)
        break
      case 'viewAlbum':
        onViewAlbum(row)
        break
      case 'viewArtist':
        onViewArtist(row)
        break
      case 'tagInfo':
        // §8.7：定位符即 filePath，弹窗自动进只读模式
        onTagInfo(row)
        break
      case 'remove':
        onRemove(row)
        break
      case 'deleteFile':
        onDeleteFile(row)
        break
    }
    onHideMenu()
  }

  return (
    visible
      ? <Menu ref={menuRef} menus={menus} onPress={handleMenuPress} onHide={onHideMenu} />
      : null
  )
})
