import { useRef, useState, useMemo, forwardRef, useImperativeHandle } from 'react'
import { FlatList, View, RefreshControl, type FlatListProps } from 'react-native'

import ListItem from './ListItem'
// import { navigations } from '@/navigation'
import { type ListInfoItem } from '@/store/songlist/state'
import { useLayout, useWindowSize } from '@/utils/hooks'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { scaleSizeW } from '@/utils/pixelRatio'
import { createStyle } from '@/utils/tools'
import Text from '@/components/common/Text'

type FlatListType = FlatListProps<ListInfoItem>

// const MAX_WIDTH = scaleSizeW(110)
const MIN_WIDTH = scaleSizeW(110)
const GAP = scaleSizeW(20)

export interface ListProps {
  onRefresh: () => void
  onLoadMore: () => void
  onOpenDetail: (item: ListInfoItem, index: number) => void
}
export type Status = 'loading' | 'refreshing' | 'end' | 'error' | 'idle'

export interface ListType {
  setList: (list: ListInfoItem[], showSource?: boolean) => void
  setStatus: (val: Status) => void
}

export default forwardRef<ListType, ListProps>(({ onRefresh, onLoadMore, onOpenDetail }, ref) => {
  const flatListRef = useRef<FlatList>(null)
  const [currentList, setList] = useState<ListInfoItem[]>([])
  const [showSource, setShowSource] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  const { onLayout, width } = useLayout()
  // 排数跟随旋转（同 fcc7a95 修法）：useWindowSize 订阅 windowSizeTools
  // 尺寸事件，用窗口尺寸做容器 View 的 key，旋转时强制重挂载、
  // 重触发 onLayout 拿到新宽度。保留容器实测宽度：横屏下内容区仅 ~78%
  // 窗宽，不能用整窗宽算列数。useLayout 单测宽度在旋转时不保证触发。
  const windowSize = useWindowSize()
  const theme = useTheme()
  // console.log('render songlist')

  useImperativeHandle(ref, () => ({
    setList(list, showSource = false) {
      // rawListRef.current = list
      setList(list)
      setShowSource(showSource)
    },
    setStatus(val) {
      setStatus(val)
    },
  }))

  const handleLoadMore = () => {
    if (status != 'idle') return
    onLoadMore()
  }

  const renderItem: FlatListType['renderItem'] = ({ item, index }) => (
    <ListItem
      item={item}
      index={index}
      width={rowInfo.width}
      showSource={showSource}
      onPress={onOpenDetail}
    />
  )
  const getkey: FlatListType['keyExtractor'] = item => item.id
  // const getItemLayout: FlatListType['getItemLayout'] = (data, index) => {
  //   return { length: ITEM_HEIGHT, offset: ITEM_HEIGHT * index, index }
  // }
  const refreshControl = useMemo(() => (
    <RefreshControl
      colors={[theme['c-primary']]}
      // progressBackgroundColor={theme.primary}
      refreshing={status == 'refreshing'}
      onRefresh={onRefresh} />
  ), [status, onRefresh, theme])
  const footerComponent = useMemo(() => {
    let label: FooterLabel
    switch (status) {
      case 'refreshing': return null
      case 'loading':
        label = 'list_loading'
        break
      case 'end':
        label = 'list_end'
        break
      case 'error':
        label = 'list_error'
        break
      case 'idle':
        label = null
        break
    }
    return (
      <View style={{ width: '100%' }}>
        <Footer label={label} onLoadMore={onLoadMore} />
      </View>
    )
  }, [onLoadMore, status])


  // const itemWidth = useMemo(() => {
  //   let itemWidth = Math.max(Math.trunc(width * 0.125), MAX_WIDTH)
  //   // if (itemWidth < )
  // }, [width])
  // const computedItemWidth = useMemo(() => {
  //   let w = width - GAP
  //   let n = width / (MIN_WIDTH + GAP)
  //   if (n > 10) n = 10
  //   return Math.floor(w / n)
  // }, [width])
  // console.log(Math.trunc(width * 0.125), itemWidth)
  // console.log(itemWidth, MIN_WIDTH, GAP, width)
  const rowInfo = useMemo(() => {
    let w = width - GAP
    let n = width / (MIN_WIDTH + GAP)
    if (n > 10) n = 10
    let computedItemWidth = Math.floor(w / n)
    const num = Math.max(Math.floor(width / computedItemWidth), 2)
    return {
      num,
      width: (width - GAP) / num,
    }
  }, [width])
  // console.log(rowNum)
  const list = useMemo(() => {
    const list = [...currentList]
    let whiteItemNum = (list.length % rowInfo.num)
    if (whiteItemNum > 0) whiteItemNum = rowInfo.num - whiteItemNum
    for (let i = 0; i < whiteItemNum; i++) {
      list.push({
        id: `white__${i}`,
        play_count: '',
        author: '',
        name: '',
        img: '',
        desc: '',
        // @ts-expect-error
        source: '',
      })
    }
    return list
  }, [currentList, rowInfo])
  // console.log(listInfo.list.map((item) => item.id))

  return (
    <View key={`${windowSize.width}x${windowSize.height}`} style={styles.container} onLayout={onLayout}>
      {
        width == 0
          ? null
          : (
              <FlatList
                key={String(rowInfo.num)}
                ref={flatListRef}
                style={styles.list}
                columnWrapperStyle={{ justifyContent: 'space-evenly' }}
                numColumns={rowInfo.num}
                data={list}
                maxToRenderPerBatch={4}
                // updateCellsBatchingPeriod={80}
                windowSize={8}
                removeClippedSubviews={true}
                // initialNumToRender={12}
                renderItem={renderItem}
                keyExtractor={getkey}
                // getItemLayout={getItemLayout}
                // onRefresh={onRefresh}
                // refreshing={refreshing}
                onEndReachedThreshold={0.6}
                onEndReached={handleLoadMore}
                refreshControl={refreshControl}
                ListFooterComponent={footerComponent}
              />
            )
      }
    </View>
  )
})

type FooterLabel = 'list_loading' | 'list_end' | 'list_error' | null
const Footer = ({ label, onLoadMore }: {
  label: FooterLabel
  onLoadMore: () => void
}) => {
  const theme = useTheme()
  const t = useI18n()
  const handlePress = () => {
    if (label != 'list_error') return
    onLoadMore()
  }
  return (
    label
      ? (
          <View>
            <Text onPress={handlePress} style={styles.footer} color={theme['c-font-label']}>{t(label)}</Text>
          </View>
        )
      : null
  )
}


const styles = createStyle({
  container: {
    flex: 1,
    overflow: 'hidden',
  },
  list: {
    flex: 1,
    paddingLeft: 10,
    paddingRight: 10,
  },
  footer: {
    textAlign: 'center',
    padding: 10,
  },
})
