import { memo, useRef } from 'react'
import { View, TouchableOpacity } from 'react-native'
import { LIST_ITEM_HEIGHT } from '@/config/constant'
import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { scaleSizeH } from '@/utils/pixelRatio'
import { Icon } from '@/components/common/Icon'
import Text from '@/components/common/Text'

export const ITEM_HEIGHT = scaleSizeH(LIST_ITEM_HEIGHT)

export interface LibraryRowItem {
  locator: string
  title: string
  artist: string | null
  album: string | null
  ext: string | null
  offline: boolean
  interval: string | null
  loved: boolean
}

export default memo(({ item, index, activeIndex, onPress, onLongPress, onShowMenu, selectedLocators, isMultiSelectMode, showMoreButton }: {
  item: LibraryRowItem
  index: number
  activeIndex: number
  onPress: (item: LibraryRowItem, index: number) => void
  onLongPress: (item: LibraryRowItem, index: number) => void
  onShowMenu: (item: LibraryRowItem, index: number, position: { x: number, y: number, w: number, h: number }) => void
  selectedLocators: Set<string>
  isMultiSelectMode: boolean
  /** 聚合视图（专辑 / 艺人）的行不是曲目，不弹歌曲菜单（N2） */
  showMoreButton: boolean
}) => {
  const theme = useTheme()
  const isActive = activeIndex === index
  const isSelected = selectedLocators.has(item.locator)
  const moreButtonRef = useRef<TouchableOpacity>(null)
  const handleShowMenu = () => {
    if (moreButtonRef.current?.measure) {
      moreButtonRef.current.measure((fx, fy, width, height, px, py) => {
        onShowMenu(item, index, { x: Math.ceil(px), y: Math.ceil(py), w: Math.ceil(width), h: Math.ceil(height) })
      })
    }
  }

  return (
    <TouchableOpacity
      style={{ ...styles.listItem, height: ITEM_HEIGHT, backgroundColor: isSelected ? theme['c-primary-background-active'] : isActive ? theme['c-primary-background-active'] : undefined }}
      onPress={() => { onPress(item, index) }}
      onLongPress={() => { onLongPress(item, index) }}
    >
      {/* 多选模式下左侧显示选中圆点 */}
      {isMultiSelectMode
        ? (
            <Icon
              name={isSelected ? 'checkbox-marked' : 'checkbox-blank-outline'}
              size={16}
              color={isSelected ? theme['c-primary-font'] : theme['c-font-label']}
              style={styles.checkbox}
            />
          )
        : null}
      {/* 曲目行：序号 + 标题 / 歌手·专辑 + 时长（§14.2）；
          聚合行（专辑 / 艺人）不显示序号与时长 */}
      {showMoreButton ? <Text style={styles.sn} size={12} color={theme['c-font-label']}>{index + 1}</Text> : null}
      <View style={styles.listItemSingle}>
        <Text numberOfLines={1}>{item.title}</Text>
        <Text numberOfLines={1} size={12} color={theme['c-font-label']}>
          {item.artist ?? ''}{item.album ? ` · ${item.album}` : ''}
        </Text>
      </View>
      <View style={styles.listItemRight}>
        {item.loved ? <Icon name="love" size={12} color={theme['c-primary-font']} /> : null}
        {item.offline ? <Icon name="download-2" size={12} color={theme['c-primary-font']} /> : null}
        {showMoreButton && item.interval ? <Text size={12} color={theme['c-font-label']}>{item.interval}</Text> : null}
      </View>
      {/* 多选模式下隐藏更多按钮；聚合行不弹歌曲菜单（N2） */}
      {isMultiSelectMode || !showMoreButton
        ? null
        : (
            <TouchableOpacity onPress={handleShowMenu} ref={moreButtonRef} style={styles.moreButton}>
              <Icon name="dots-vertical" style={{ color: theme['c-350'] }} size={12} />
            </TouchableOpacity>
          )}
    </TouchableOpacity>
  )
}, (prevProps, nextProps) => {
  return prevProps.item.locator === nextProps.item.locator &&
    prevProps.index === nextProps.index &&
    prevProps.activeIndex === nextProps.activeIndex &&
    prevProps.isMultiSelectMode === nextProps.isMultiSelectMode &&
    prevProps.showMoreButton === nextProps.showMoreButton &&
    prevProps.item.loved === nextProps.item.loved &&
    prevProps.selectedLocators === nextProps.selectedLocators
})

const styles = createStyle({
  listItem: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'center',
    paddingLeft: 10,
    paddingRight: 10,
  },
  checkbox: {
    marginRight: 8,
  },
  sn: {
    width: 30,
    textAlign: 'center',
  },
  listItemSingle: {
    flexGrow: 1,
    flexShrink: 1,
    paddingTop: 5,
    paddingBottom: 5,
  },
  listItemRight: {
    flexGrow: 0,
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 8,
  },
  moreButton: {
    height: '80%',
    paddingLeft: 12,
    paddingRight: 2,
    justifyContent: 'center',
  },
})
