import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View } from 'react-native'

import List, { type ListType } from './List'
import ListMenu, { type ListMenuType } from './ListMenu'
import { handlePlay } from './listAction'
import { queryTracks, queryAlbums, queryArtists, queryAlbumTracks, queryArtistTracks } from '@/core/library/query'
import { setRows, setTabId } from '@/store/library/action'
import { useLibrarySources } from '@/store/library/hook'
import state from '@/store/library/state'
import { pickLocalFolder } from '@/core/library/sources/local'
import { startSourceScan, refreshSources } from '@/core/library/sync'
import { toast, createStyle } from '@/utils/tools'
import { useI18n } from '@/lang'
import { useTheme } from '@/store/theme/hook'
import Text from '@/components/common/Text'
import Button from '@/components/common/Button'
import Input from '@/components/common/Input'
import { useSettingValue } from '@/store/setting/hook'
import MetadataEditModal, { type MetadataEditType } from '@/components/MetadataEditModal'
import type { NativeTrackRow } from '@/core/library/types'
import type { LibraryTabId } from '@/store/library/state'

const TABS: Array<{ id: LibraryTabId, key: 'library_tab_tracks' | 'library_tab_albums' | 'library_tab_artists' }> = [
  { id: 'tracks', key: 'library_tab_tracks' },
  { id: 'albums', key: 'library_tab_albums' },
  { id: 'artists', key: 'library_tab_artists' },
]

export default () => {
  const t = useI18n()
  const theme = useTheme()
  // 入口门控（§14.1）：关闭时本视图不渲染内容（导航项已被隐藏，
  // 此处兜底横滑到该页的情况）
  const libraryEnable = useSettingValue('library.enable')
  const listRef = useRef<ListType>(null)
  const listMenuRef = useRef<ListMenuType>(null)
  const metadataEditRef = useRef<MetadataEditType>(null)
  const [tabId, setTabIdState] = useState<LibraryTabId>(state.tabId)
  const [keyword, setKeyword] = useState('')
  // 专辑 / 艺人下钻状态：P1 先在列内下钻，详情屏（3.3）接入后迁移
  const [drill, setDrill] = useState<{ type: 'album' | 'artist', sourceId: string, key: string, title: string } | null>(null)
  const sources = useLibrarySources()
  // 行数据不在本组件消费（List 自行订阅），播放 / 菜单一律按定位符
  // 从 state.rows 现查，绕开 memo 闭包过期问题
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 请求序号守卫：慢的旧请求不得覆盖新结果
  const loadSeq = useRef(0)

  const loadRows = useCallback(async(kw: string) => {
    const seq = ++loadSeq.current
    let next: { rows: NativeTrackRow[], total: number }
    if (drill) {
      const trackRows = drill.type === 'album'
        ? await queryAlbumTracks(drill.sourceId, drill.key, 0, 200)
        : await queryArtistTracks(drill.sourceId, drill.key, 0, 200)
      next = { rows: trackRows, total: trackRows.length }
    } else {
      const spec = {
        sourceIds: state.filterSourceId ? [state.filterSourceId] : undefined,
        keyword: kw || undefined,
        offset: 0,
        limit: 200,
      }
      // Tab 分流：三个 Tab 各查各的视图（此前都查 tracks，切 Tab 无效果）
      const result = tabId === 'albums'
        ? await queryAlbums(spec)
        : tabId === 'artists'
          ? await queryArtists(spec)
          : await queryTracks(spec)
      next = result
    }
    if (seq !== loadSeq.current) return // 过期结果丢弃
    setRows(next.rows, next.total)
  }, [tabId, drill])

  // Tab / 下钻 / 来源变化时重新加载
  useEffect(() => {
    void loadRows(keyword)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, drill, sources])

  // 首次进入拉取来源与曲目
  useEffect(() => {
    void refreshSources().then(() => { void loadRows('') })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleTabChange = useCallback((id: LibraryTabId) => {
    setTabId(id)
    setTabIdState(id)
    setDrill(null)
  }, [])

  const handleKeywordChange = useCallback((text: string) => {
    setKeyword(text)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => { void loadRows(text) }, 250)
  }, [loadRows])

  const handlePlayRow = useCallback((locator: string) => {
    // 专辑 / 艺人视图：点击是下钻而非播放。合成行的 locator 是
    // album_key / artist_key，sourceId 为聚合结果的 MIN(source_id)。
    // 一律从 state.rows 现查，避免 memo 挡住闭包更新
    if (tabId === 'albums') {
      const row = state.rows.find(r => r.locator === locator)
      if (row) setDrill({ type: 'album', sourceId: row.sourceId, key: row.itemKey, title: row.title })
      return
    }
    if (tabId === 'artists') {
      const row = state.rows.find(r => r.locator === locator)
      if (row) setDrill({ type: 'artist', sourceId: row.sourceId, key: row.itemKey, title: row.title })
      return
    }
    // 曲目视图：按定位符在最新列表现查，避开 memo 闭包过期问题
    const currentRows = state.rows
    const index = currentRows.findIndex(r => r.locator === locator)
    if (index < 0) {
      toast(t('library_play_failed'), 'short')
      return
    }
    void handlePlay(currentRows, index)
  }, [tabId, t])

  const handleShowMenu = useCallback((locator: string, position: { x: number, y: number, w: number, h: number }) => {
    // 同播放路径：按定位符在最新列表现查，避免 memo 闭包过期
    const currentRows = state.rows
    const index = currentRows.findIndex(r => r.locator === locator)
    if (index < 0) return
    listMenuRef.current?.show(currentRows[index], currentRows, index, position)
  }, [])

  const handleAddFolder = useCallback(() => {
    // 顺序关键：必须等来源列表刷新进 store 后才能发起扫描，
    // `startSourceScan` 从 store 查来源，并发执行时新来源还不在，
    // 会直接 return false 导致「来源落库但永不扫描」
    void (async() => {
      let result
      try {
        result = await pickLocalFolder()
      } catch {
        toast(t('library_add_folder_failed'), 'long')
        return
      }
      if (!result) return
      try {
        await refreshSources()
        const started = await startSourceScan(result.source.id)
        if (!started) toast(t('library_scan_busy'), 'short')
      } catch {
        toast(t('library_add_folder_failed'), 'long')
      }
    })()
  }, [t])

  const hasSource = useMemo(() => sources.length > 0, [sources])

  if (!libraryEnable) return null

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.tabs}>
          {TABS.map(({ id, key }) => (
            <Button key={id} style={{ ...styles.tab, borderBottomColor: tabId === id ? theme['c-primary-font'] : 'transparent' }} onPress={() => { handleTabChange(id) }}>
              <Text style={styles.tabText} color={tabId === id ? theme['c-primary-font'] : theme['c-font']} size={14} numberOfLines={1}>{t(key)}</Text>
            </Button>
          ))}
        </View>
        {/* 固定高度：Input 外层 content 带 flexGrow，不设高会被撑开占满
            中段区域（对齐全局搜索页 HeaderBar 的 height: 38） */}
        <View style={styles.searchBar}>
          {drill
            ? (
                <View style={styles.drillBar}>
                  <Button style={styles.backBtn} onPress={() => { setDrill(null) }}>
                    <Text size={13} color={theme['c-primary-font']}>{t('back')}</Text>
                  </Button>
                  <Text style={styles.drillTitle} numberOfLines={1}>{drill.title}</Text>
                </View>
              )
            : (
                <View style={styles.searchInputWrap}>
                  <Input
                    onChangeText={handleKeywordChange}
                    placeholder={t('library_search_placeholder')}
                    value={keyword}
                    clearBtn={!!keyword}
                    onClearText={() => { handleKeywordChange('') }}
                    style={styles.input}
                  />
                </View>
              )}
          <Button style={styles.addBtn} onPress={handleAddFolder}>
            <Text size={13} color={theme['c-primary-font']}>{t('library_add_folder')}</Text>
          </Button>
        </View>
      </View>
      {hasSource
        ? (
            <List ref={listRef} onPlay={handlePlayRow} onShowMenu={handleShowMenu} />
          )
        : (
            <View style={styles.empty}>
              <Text color={theme['c-font-label']}>{t('library_empty')}</Text>
            </View>
          )}
      <ListMenu
        ref={listMenuRef}
        onHideMenu={() => {}}
        onTagInfo={(row) => { metadataEditRef.current?.show(row.locator) }}
      />
      <MetadataEditModal ref={metadataEditRef} onUpdate={() => {}} />
    </View>
  )
}

const styles = createStyle({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'column',
  },
  tabs: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tab: {
    flex: 1,
    borderBottomWidth: 2,
    paddingTop: 10,
    paddingBottom: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabText: {
    textAlign: 'center',
  },
  searchBar: {
    height: 38,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 10,
    paddingRight: 10,
    paddingBottom: 6,
  },
  searchInputWrap: {
    flex: 1,
    marginRight: 8,
  },
  input: {
    width: '100%',
  },
  drillBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 8,
  },
  backBtn: {
    paddingLeft: 8,
    paddingRight: 8,
    paddingTop: 4,
    paddingBottom: 4,
    marginRight: 6,
  },
  drillTitle: {
    flex: 1,
  },
  addBtn: {
    paddingLeft: 8,
    paddingRight: 8,
    paddingTop: 8,
    paddingBottom: 8,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
