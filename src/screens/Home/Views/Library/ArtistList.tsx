import { useMemo, useRef } from 'react'
import { FlatList, View, TouchableOpacity, type ListRenderItem } from 'react-native'

import Text from '@/components/common/Text'
import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import type { NativeTrackRow } from '@/core/library/types'

export interface ArtistListProps {
  rows: NativeTrackRow[]
  onOpenArtist: (row: NativeTrackRow) => void
}

interface ArtistSection {
  letter: string
  data: NativeTrackRow[]
}

/**
 * 首字母分组（§14.2）：取不到首字母时归入「#」。
 * 中文按字符本身分组（无拼音依赖，保持零新增依赖），
 * 英文 / 数字按首字符大写归组
 */
const groupByLetter = (rows: NativeTrackRow[]): ArtistSection[] => {
  const map = new Map<string, NativeTrackRow[]>()
  for (const row of rows) {
    const name = row.title ?? row.artist ?? ''
    const first = name.slice(0, 1).toUpperCase()
    const letter = /[A-Z0-9]/.test(first) ? first : '#'
    const bucket = map.get(letter)
    if (bucket) bucket.push(row)
    else map.set(letter, [row])
  }
  const letters = Array.from(map.keys()).sort((a, b) => {
    if (a === '#') return 1
    if (b === '#') return -1
    return a.localeCompare(b)
  })
  return letters.map(letter => ({ letter, data: map.get(letter)! }))
}

export default ({ rows, onOpenArtist }: ArtistListProps) => {
  const theme = useTheme()
  const t = useI18n()
  const listRef = useRef<FlatList>(null)

  const sections = useMemo(() => groupByLetter(rows), [rows])
  // 展平成带分组头的扁平行
  const flatRows = useMemo(() => {
    const out: Array<NativeTrackRow | { letter: string }> = []
    for (const section of sections) {
      out.push({ letter: section.letter })
      for (const row of section.data) out.push(row)
    }
    return out
  }, [sections])

  type FlatRow = NativeTrackRow | { letter: string }
  const renderItem: ListRenderItem<FlatRow> = ({ item }) => {
    if ('letter' in item) {
      return (
        <View style={styles.letterHeader}>
          <Text size={13} color={theme['c-font-label']}>{item.letter}</Text>
        </View>
      )
    }
    return (
      <TouchableOpacity style={styles.artistRow} onPress={() => { onOpenArtist(item) }}>
        <Text size={14} numberOfLines={1}>{item.title || t('library_unknown_artist')}</Text>
      </TouchableOpacity>
    )
  }

  return (
    <FlatList
      ref={listRef}
      style={styles.container}
      data={flatRows}
      keyExtractor={(item) => ('letter' in item ? `letter-${String(item.letter)}` : item.locator)}
      renderItem={renderItem}
      initialNumToRender={30}
    />
  )
}

const styles = createStyle({
  container: {
    flex: 1,
  },
  letterHeader: {
    paddingLeft: 14,
    paddingTop: 8,
    paddingBottom: 4,
  },
  artistRow: {
    paddingLeft: 14,
    paddingRight: 14,
    paddingTop: 9,
    paddingBottom: 9,
  },
})
