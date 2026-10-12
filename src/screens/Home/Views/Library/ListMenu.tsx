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
}
export interface ListMenuType {
  show: (row: NativeTrackRow, rows: NativeTrackRow[], index: number, position: Position) => void
}

export default forwardRef<ListMenuType, ListMenuProps>(({ onHideMenu, onTagInfo }, ref) => {
  const t = useI18n()
  const menuRef = useRef<MenuType>(null)
  const selectInfoRef = useRef<SelectInfo>(initSelectInfo)
  const [visible, setVisible] = useState(false)

  useImperativeHandle(ref, () => ({
    show(row, rows, index, position) {
      selectInfoRef.current = { row, rows, index }
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
    { action: 'tagInfo', label: t('library_tag_info') },
  ]), [t])

  const handleMenuPress = ({ action }: typeof menus[number]) => {
    const { row, rows, index } = selectInfoRef.current
    switch (action) {
      case 'play':
        void handlePlay(rows, index)
        break
      case 'playLater':
        void handlePlayLater(row)
        break
      case 'tagInfo':
        // §8.7：定位符即 filePath，弹窗自动进只读模式
        onTagInfo(row)
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
