import { useI18n } from '@/lang'
import { useTheme } from '@/store/theme/hook'
import { createStyle, getRowInfo } from '@/utils/tools'
import { useEffect, useMemo, useRef } from 'react'
import { View, FlatList } from 'react-native'

import ListItem, { type PathItem } from './ListItem'
import LoadingMask, { type LoadingMaskType } from '@/components/common/LoadingMask'
import { useWindowSize } from '@/utils/hooks'


export default ({ list, loading, onSetPath, toParentDir }: {
  list: PathItem[]
  loading: boolean
  onSetPath: (item: PathItem) => void
  toParentDir: () => void
}) => {
  const t = useI18n()
  const theme = useTheme()
  const loadingMaskRef = useRef<LoadingMaskType>(null)
  // 排数跟随旋转：同歌单列表修法（useWindowSize 订阅尺寸事件）
  const windowSize = useWindowSize()
  const rowInfo = useMemo(() => getRowInfo('full', windowSize), [windowSize])
  const fullRow = useRef({ rowNum: undefined, rowWidth: '100%' } as const)

  const ParentItemComponent = useMemo(() => (
    <View style={{ backgroundColor: theme['c-primary-light-700-alpha-900'] }}>
      <ListItem item={{
        name: '..',
        desc: t('parent_dir_name'),
        isDir: true,
        path: '',
      }} rowInfo={fullRow.current} onPress={toParentDir} />
    </View>
  ), [t, theme, toParentDir])

  useEffect(() => {
    loadingMaskRef.current?.setVisible(loading)
  }, [loading])

  const ListComponent = useMemo(() => (
    <FlatList
      key={String(rowInfo.rowNum ?? 1)}
      keyboardShouldPersistTaps={'always'}
      style={styles.list}
      data={list}
      numColumns={rowInfo.rowNum}
      renderItem={({ item }) => <ListItem item={item} rowInfo={rowInfo} onPress={onSetPath} />}
      keyExtractor={item => item.path + '/' + item.name}
      removeClippedSubviews={true}
    />
  ), [list, onSetPath, rowInfo])

  // const dirList = useMemo(() => [parentDir, ...list], [list, parentDir])

  return (
    <View style={styles.main}>
      {ParentItemComponent}
      {ListComponent}
      <LoadingMask ref={loadingMaskRef} />
    </View>
  )
}


const styles = createStyle({
  main: {
    flexGrow: 1,
    flexShrink: 1,
    overflow: 'hidden',
  },
  list: {
    flexGrow: 1,
    flexShrink: 1,
  },
})
