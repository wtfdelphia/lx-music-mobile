import { useMemo, useRef, useEffect, forwardRef, useImperativeHandle, useState } from 'react'
import { FlatList, type FlatListProps } from 'react-native'

import { LIST_IDS } from '@/config/constant'
import ListItem, { ITEM_HEIGHT } from './ListItem'
import { createStyle } from '@/utils/tools'
import { useDownloadList } from '@/store/download/hook'
import { usePlayInfo, usePlayMusicInfo } from '@/store/player/hook'
import type { Position } from '@/components/common/Menu'

type FlatListType = FlatListProps<LX.Download.ListItem>

export type TabId = 'all' | 'running' | 'paused' | 'error' | 'completed'

export interface ListProps {
  tab: TabId
  onPlay: (downloadInfo: LX.Download.ListItem) => void
  onShowMenu: (downloadInfo: LX.Download.ListItem, index: number, position: Position) => void
}
export interface ListType {
  getList: () => LX.Download.ListItem[]
}

export default forwardRef<ListType, ListProps>(({ tab, onPlay, onShowMenu }, ref) => {
  const downloadList = useDownloadList()
  const listRef = useRef<FlatList>(null)
  const [activeIndex, setActiveIndex] = useState(-1)
  const playInfo = usePlayInfo()
  const playMusicInfo = usePlayMusicInfo()

  const list = useMemo(() => {
    switch (tab) {
      case 'running':
        return downloadList.filter(item => item.status === 'run' || item.status === 'waiting')
      case 'paused':
        return downloadList.filter(item => item.status === 'pause')
      case 'error':
        return downloadList.filter(item => item.status === 'error')
      case 'completed':
        return downloadList.filter(item => item.status === 'completed')
      default:
        return downloadList
    }
  }, [downloadList, tab])

  useImperativeHandle(ref, () => ({
    getList: () => list,
  }))

  // 正在播放的下载任务高亮
  useEffect(() => {
    if (playMusicInfo.listId !== LIST_IDS.DOWNLOAD || !playMusicInfo.musicInfo) {
      setActiveIndex(-1)
      return
    }
    const index = list.findIndex(item => item.id === (playMusicInfo.musicInfo as LX.Download.ListItem).id)
    setActiveIndex(index)
  }, [playInfo, playMusicInfo, list])

  const renderItem: FlatListType['renderItem'] = ({ item, index }) => (
    <ListItem
      item={item}
      index={index}
      activeIndex={activeIndex}
      onPress={onPlay}
      onShowMenu={onShowMenu}
    />
  )

  return (
    <FlatList
      ref={listRef}
      style={styles.container}
      data={list}
      initialNumToRender={12}
      renderItem={renderItem}
      keyExtractor={item => item.id}
      getItemLayout={(data, index) => ({ length: ITEM_HEIGHT, offset: ITEM_HEIGHT * index, index })}
    />
  )
})

const styles = createStyle({
  container: {
    flex: 1,
  },
})
