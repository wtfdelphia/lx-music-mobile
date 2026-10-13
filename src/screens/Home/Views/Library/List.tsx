import { useRef, useEffect, forwardRef, useImperativeHandle, useState } from 'react'
import { FlatList, type FlatListProps } from 'react-native'

import ListItem, { ITEM_HEIGHT, type LibraryRowItem } from './ListItem'
import { createStyle } from '@/utils/tools'
import { useLibraryRows } from '@/store/library/hook'
import { usePlayMusicInfo } from '@/store/player/hook'
import type { Position } from '@/components/common/Menu'
import type { NativeTrackRow } from '@/core/library/types'

type FlatListType = FlatListProps<NativeTrackRow>

export interface ListProps {
  onPlay: (locator: string) => void
  onShowMenu: (locator: string, position: Position) => void
}
export interface ListType {
  getRows: () => NativeTrackRow[]
}

/** 曲库行转列表展示项 */
const toRowItem = (row: NativeTrackRow): LibraryRowItem => ({
  locator: row.locator,
  title: row.title,
  artist: row.artist,
  album: row.album,
  ext: row.ext,
  offline: false,
})

export default forwardRef<ListType, ListProps>(({ onPlay, onShowMenu }, ref) => {
  const { rows } = useLibraryRows()
  // 点击语义：只回传定位符，播放目标由外层按最新列表（state.rows）
  // 现查。ListItem 的 memo 比较函数不含回调引用，靠闭包传 index 会
  // 播错条目或点不动
  const listRef = useRef<FlatList>(null)
  const [activeIndex, setActiveIndex] = useState(-1)
  const playMusicInfo = usePlayMusicInfo()

  useImperativeHandle(ref, () => ({
    getRows: () => rows,
  }))

  // 正在播放的曲库曲目高亮：按定位符匹配
  useEffect(() => {
    const mi = playMusicInfo.musicInfo
    // PlayMusic 可能是下载任务项（无 `source` 字段），先收窄
    if (!mi || !('source' in mi) || mi.source !== 'local') {
      setActiveIndex(-1)
      return
    }
    const locator = mi.id
    const index = rows.findIndex(r => r.locator === locator)
    setActiveIndex(index)
  }, [playMusicInfo, rows])

  const renderItem: FlatListType['renderItem'] = ({ item, index }) => (
    <ListItem
      item={toRowItem(item)}
      index={index}
      activeIndex={activeIndex}
      onPress={() => { onPlay(item.locator) }}
      onShowMenu={(_i, _idx, position) => { onShowMenu(item.locator, position) }}
    />
  )

  return (
    <FlatList
      ref={listRef}
      style={styles.container}
      data={rows}
      initialNumToRender={20}
      renderItem={renderItem}
      keyExtractor={item => item.locator}
      getItemLayout={(_data, index) => ({ length: ITEM_HEIGHT, offset: ITEM_HEIGHT * index, index })}
    />
  )
})

const styles = createStyle({
  container: {
    flex: 1,
  },
})

