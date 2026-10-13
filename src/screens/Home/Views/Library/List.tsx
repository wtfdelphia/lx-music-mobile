import { useRef, useEffect, forwardRef, useImperativeHandle, useState, useCallback } from 'react'
import { FlatList, type FlatListProps } from 'react-native'

import ListItem, { ITEM_HEIGHT, type LibraryRowItem } from './ListItem'
import { createStyle } from '@/utils/tools'
import { formatPlayTime2 } from '@/utils/common'
import { useLibraryRows } from '@/store/library/hook'
import { usePlayMusicInfo } from '@/store/player/hook'
import type { Position } from '@/components/common/Menu'
import type { NativeTrackRow } from '@/core/library/types'

type FlatListType = FlatListProps<NativeTrackRow>

export interface ListProps {
  onPlay: (locator: string) => void
  onShowMenu: (locator: string, position: Position) => void
  /** 多选模式进入 / 退出回调，外层控制批量操作栏 */
  onMultiSelectModeChange: (active: boolean, selectedLocators: string[]) => void
  /** 行是否为曲目（专辑 / 艺人聚合行不显示序号 / 时长 / 菜单） */
  isTrackView: boolean
  /** 喜欢集合（红心显示） */
  loveSet: Set<string>
}
export interface ListType {
  getRows: () => NativeTrackRow[]
  /** 多选外部控制：全选 / 退出 */
  selectAll: () => void
  exitMultiSelect: () => void
  /** 通知选中集合变化（外层菜单操作后清空） */
  clearSelection: () => void
}

/** 曲库行转列表展示项 */
const toRowItem = (row: NativeTrackRow, loveSet: Set<string>): LibraryRowItem => ({
  locator: row.locator,
  title: row.title,
  artist: row.artist,
  album: row.album,
  ext: row.ext,
  offline: false,
  interval: row.durationMs > 0 ? formatPlayTime2(Math.round(row.durationMs / 1000)) : null,
  loved: loveSet.has(row.locator),
})

export default forwardRef<ListType, ListProps>(({ onPlay, onShowMenu, onMultiSelectModeChange, isTrackView, loveSet }, ref) => {
  const { rows } = useLibraryRows()
  // 点击语义：只回传定位符，播放目标由外层按最新列表（state.rows）
  // 现查。ListItem 的 memo 比较函数不含回调引用，靠闭包传 index 会
  // 播错条目或点不动
  const listRef = useRef<FlatList>(null)
  const [activeIndex, setActiveIndex] = useState(-1)
  const playMusicInfo = usePlayMusicInfo()

  // 多选状态（对齐 Mylist：长按进入，点击切换选中）
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false)
  const isMultiSelectModeRef = useRef(false)
  // 选中集合每次变化都换引用，让 ListItem 的 memo 比较能感知
  const [selectedLocators, setSelectedLocators] = useState<Set<string>>(new Set())

  const updateSelected = useCallback((next: Set<string>) => {
    setSelectedLocators(next)
  }, [])

  const notifyModeChange = useCallback((active: boolean, locators: Set<string>) => {
    onMultiSelectModeChange(active, Array.from(locators))
  }, [onMultiSelectModeChange])

  useImperativeHandle(ref, () => ({
    getRows: () => rows,
    selectAll: () => {
      const all = new Set(rows.map(r => r.locator))
      updateSelected(all)
      notifyModeChange(true, all)
    },
    exitMultiSelect: () => {
      isMultiSelectModeRef.current = false
      setIsMultiSelectMode(false)
      updateSelected(new Set())
      notifyModeChange(false, new Set())
    },
    clearSelection: () => {
      updateSelected(new Set())
    },
  }))

  const handleLongPress = useCallback((item: LibraryRowItem) => {
    if (isMultiSelectModeRef.current) return
    isMultiSelectModeRef.current = true
    setIsMultiSelectMode(true)
    const next = new Set([item.locator])
    updateSelected(next)
    notifyModeChange(true, next)
  }, [notifyModeChange, updateSelected])

  const handlePress = useCallback((item: LibraryRowItem) => {
    if (isMultiSelectModeRef.current) {
      const next = new Set(selectedLocators)
      if (next.has(item.locator)) next.delete(item.locator)
      else next.add(item.locator)
      updateSelected(next)
      if (next.size === 0) {
        isMultiSelectModeRef.current = false
        setIsMultiSelectMode(false)
        notifyModeChange(false, next)
      } else {
        notifyModeChange(true, next)
      }
      return
    }
    onPlay(item.locator)
  }, [selectedLocators, notifyModeChange, onPlay, updateSelected])

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

  // 列表数据变化时，清掉已不存在的选中项
  useEffect(() => {
    if (!selectedLocators.size) return
    const valid = new Set(rows.map(r => r.locator))
    const next = new Set(Array.from(selectedLocators).filter(l => valid.has(l)))
    if (next.size !== selectedLocators.size) updateSelected(next)
  }, [rows, selectedLocators, updateSelected])

  const renderItem: FlatListType['renderItem'] = ({ item, index }) => (
    <ListItem
      item={toRowItem(item, loveSet)}
      index={index}
      activeIndex={activeIndex}
      isMultiSelectMode={isMultiSelectMode}
      selectedLocators={selectedLocators}
      showMoreButton={isTrackView}
      onPress={() => { handlePress(toRowItem(item, loveSet)) }}
      onLongPress={() => { handleLongPress(toRowItem(item, loveSet)) }}
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
