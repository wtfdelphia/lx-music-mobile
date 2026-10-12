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
}

export default memo(({ item, index, activeIndex, onPress, onShowMenu }: {
  item: LibraryRowItem
  index: number
  activeIndex: number
  onPress: (item: LibraryRowItem, index: number) => void
  onShowMenu: (item: LibraryRowItem, index: number, position: { x: number, y: number, w: number, h: number }) => void
}) => {
  const theme = useTheme()
  const isActive = activeIndex === index
  const moreButtonRef = useRef<TouchableOpacity>(null)
  const handleShowMenu = () => {
    if (moreButtonRef.current?.measure) {
      moreButtonRef.current.measure((fx, fy, width, height, px, py) => {
        onShowMenu(item, index, { x: Math.ceil(px), y: Math.ceil(py), w: Math.ceil(width), h: Math.ceil(height) })
      })
    }
  }

  return (
    <TouchableOpacity style={{ ...styles.listItem, height: ITEM_HEIGHT, backgroundColor: isActive ? theme['c-primary-background-active'] : undefined }}
      onPress={() => { onPress(item, index) }}
    >
      <View style={styles.listItemSingle}>
        <Text numberOfLines={1}>{item.title}</Text>
        <Text numberOfLines={1} size={12} color={theme['c-font-label']}>
          {item.artist ?? ''}{item.album ? ` · ${item.album}` : ''}
        </Text>
      </View>
      <View style={styles.listItemRight}>
        {item.offline ? <Icon name="download-2" size={12} color={theme['c-primary-font']} /> : null}
        {item.ext ? <Text size={12} color={theme['c-font-label']} numberOfLines={1}>{item.ext}</Text> : null}
      </View>
      <TouchableOpacity onPress={handleShowMenu} ref={moreButtonRef} style={styles.moreButton}>
        <Icon name="dots-vertical" style={{ color: theme['c-350'] }} size={12} />
      </TouchableOpacity>
    </TouchableOpacity>
  )
}, (prevProps, nextProps) => {
  return prevProps.item.locator === nextProps.item.locator &&
    prevProps.index === nextProps.index &&
    prevProps.activeIndex === nextProps.activeIndex
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
