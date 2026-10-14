import { memo, useEffect, useRef, useState } from 'react'
import { FlatList, View, TouchableOpacity, type FlatListProps } from 'react-native'

import Text from '@/components/common/Text'
import Image from '@/components/common/Image'
import { createStyle, isHorizontalMode } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { scaleSizeW } from '@/utils/pixelRatio'
import { useWindowSize } from '@/utils/hooks'
import { NAV_WIDTH } from '@/screens/Home/Horizontal/Aside'
import * as native from '@/core/library/native'
import type { NativeTrackRow } from '@/core/library/types'

type FlatListType = FlatListProps<NativeTrackRow>

const GAP = scaleSizeW(20)

export interface AlbumGridProps {
  rows: NativeTrackRow[]
  onOpenAlbum: (row: NativeTrackRow) => void
}

/** 专辑 / 艺人聚合行 → 封面 file:// URL（artwork 字段存的是缓存文件名） */
const useArtworkUrl = (artwork: string | null): string | null => {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let mounted = true
    if (!artwork) {
      setUrl(null)
      return
    }
    void native.artworkUrlForName(artwork).then(u => {
      if (mounted) setUrl(u || null)
    })
    return () => { mounted = false }
  }, [artwork])
  return url
}

const Card = memo(({ item, width, onPress, unknownLabel }: {
  item: NativeTrackRow
  width: number
  onPress: (row: NativeTrackRow) => void
  unknownLabel: string
}) => {
  const theme = useTheme()
  const artworkUrl = useArtworkUrl(item.artwork)
  const title = item.title || unknownLabel
  const itemWidth = width - GAP
  return (
    <View style={{ ...styles.card, width: itemWidth }}>
      <TouchableOpacity activeOpacity={0.5} onPress={() => { onPress(item) }}>
        <View style={{ ...styles.cardImg, width: itemWidth, height: itemWidth, backgroundColor: theme['c-content-background'] }}>
          {artworkUrl
            ? <Image url={artworkUrl} style={{ width: itemWidth, height: itemWidth, borderRadius: 4 }} />
            : (
                <View style={styles.cardImgPlaceholder}>
                  <Text size={12} color={theme['c-font-label']}>{title.slice(0, 1)}</Text>
                </View>
              )}
        </View>
        <Text style={styles.cardTitle} numberOfLines={2} size={12}>{title}</Text>
        <Text style={styles.cardSub} numberOfLines={1} size={11} color={theme['c-font-label']}>{item.artist ?? ''}</Text>
      </TouchableOpacity>
    </View>
  )
}, (prevProps, nextProps) => {
  return prevProps.item.locator === nextProps.item.locator && prevProps.width === nextProps.width
})

export default ({ rows, onOpenAlbum }: AlbumGridProps) => {
  const t = useI18n()
  // 列数跟随窗口宽度（对齐歌单广场网格的排数逻辑）
  const windowSize = useWindowSize()
  const width = isHorizontalMode(windowSize.width, windowSize.height)
    ? windowSize.width - NAV_WIDTH
    : windowSize.width
  const listRef = useRef<FlatList>(null)

  const renderItem: FlatListType['renderItem'] = ({ item }) => (
    <Card item={item} width={width / 3} onPress={onOpenAlbum} unknownLabel={t('library_unknown_album')} />
  )

  return (
    <FlatList
      ref={listRef}
      style={styles.container}
      data={rows}
      numColumns={3}
      keyExtractor={item => item.locator}
      renderItem={renderItem}
      initialNumToRender={12}
    />
  )
}

const styles = createStyle({
  container: {
    flex: 1,
  },
  card: {
    margin: GAP / 2,
  },
  cardImg: {
    borderRadius: 4,
    marginBottom: 5,
    overflow: 'hidden',
  },
  cardImgPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    marginTop: 2,
  },
  cardSub: {
    marginTop: 1,
  },
})
