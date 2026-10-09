import { memo, useRef } from 'react'
import { View, TouchableOpacity } from 'react-native'
import { LIST_ITEM_HEIGHT } from '@/config/constant'
import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { scaleSizeH } from '@/utils/pixelRatio'
import { Icon } from '@/components/common/Icon'
import Text from '@/components/common/Text'
import Badge from '@/components/common/Badge'

export const ITEM_HEIGHT = scaleSizeH(LIST_ITEM_HEIGHT)

const STATUS_TEXT_KEYS: Record<LX.Download.DownloadTaskStatus, 'download___status_running' | 'download___status_waiting' | 'download___status_paused' | 'download___status_error' | 'download___status_completed'> = {
  run: 'download___status_running',
  waiting: 'download___status_waiting',
  pause: 'download___status_paused',
  error: 'download___status_error',
  completed: 'download___status_completed',
}
const statusText = (status: LX.Download.DownloadTaskStatus) => global.i18n.t(STATUS_TEXT_KEYS[status])

const statusColor = (status: LX.Download.DownloadTaskStatus, theme: LX.ActiveTheme): string => {
  switch (status) {
    case 'run': return theme['c-primary-font']
    case 'error': return '#f24a4a'
    case 'completed': return theme['c-primary-font']
    default: return theme['c-font-label']
  }
}

export default memo(({ item, index, activeIndex, onPress, onShowMenu }: {
  item: LX.Download.ListItem
  index: number
  activeIndex: number
  onPress: (item: LX.Download.ListItem, index: number) => void
  onShowMenu: (item: LX.Download.ListItem, index: number, position: { x: number, y: number, w: number, h: number }) => void
}) => {
  const theme = useTheme()
  const isActive = activeIndex === index
  const isDownloading = item.status === 'run' || item.status === 'waiting'
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
        <Text numberOfLines={1}>{item.metadata.musicInfo.name}</Text>
        <Text numberOfLines={1} size={12} color={theme['c-font-label']}>
          {item.metadata.musicInfo.singer}
          {item.speed && isDownloading ? ` · ${item.speed}` : ''}
        </Text>
      </View>
      <View style={styles.listItemRight}>
        <View style={styles.badge}>
          <Badge type="tertiary">{item.metadata.quality}</Badge>
        </View>
        <Text size={12} color={statusColor(item.status, theme)} numberOfLines={1}>
          {item.statusText || statusText(item.status)}
        </Text>
      </View>
      <TouchableOpacity onPress={handleShowMenu} ref={moreButtonRef} style={styles.moreButton}>
        <Icon name="dots-vertical" style={{ color: theme['c-350'] }} size={12} />
      </TouchableOpacity>
      {isDownloading
        ? <View style={{ ...styles.progress, backgroundColor: theme['c-primary-light-300-alpha-300'] }}>
          <View style={{ ...styles.progressBar, width: `${Math.max(1, item.progress)}%`, backgroundColor: theme['c-primary-font'] }} />
        </View>
        : null}
    </TouchableOpacity>
  )
}, (prevProps, nextProps) => {
  return !!(prevProps.item === nextProps.item &&
    prevProps.index === nextProps.index &&
    prevProps.activeIndex != nextProps.index &&
    nextProps.activeIndex != nextProps.index)
})

const styles = createStyle({
  listItem: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'center',
    paddingLeft: 10,
    paddingRight: 10,
    position: 'relative',
  },
  listItemSingle: {
    flexGrow: 1,
    flexShrink: 1,
    paddingRight: 6,
  },
  listItemRight: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: '45%',
  },
  badge: {
    marginRight: 5,
  },
  progress: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    width: '100%',
    height: 2,
  },
  progressBar: {
    height: '100%',
  },
  moreButton: {
    padding: 8,
  },
})
