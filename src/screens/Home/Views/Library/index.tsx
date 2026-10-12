import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View } from 'react-native'

import List, { type ListType } from './List'
import ListMenu, { type ListMenuType } from './ListMenu'
import { handlePlay } from './listAction'
import { queryTracks } from '@/core/library/query'
import { setRows, setTabId } from '@/store/library/action'
import { useLibrarySources, useLibraryRows } from '@/store/library/hook'
import state from '@/store/library/state'
import { pickLocalFolder } from '@/core/library/sources/local'
import { startSourceScan, refreshSources } from '@/core/library/sync'
import { useI18n } from '@/lang'
import { createStyle } from '@/utils/tools'
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
  const sources = useLibrarySources()
  const { rows } = useLibraryRows()
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadRows = useCallback(async(kw: string) => {
    const result = await queryTracks({
      sourceIds: state.filterSourceId ? [state.filterSourceId] : undefined,
      keyword: kw || undefined,
      offset: 0,
      limit: 200,
    })
    setRows(result.rows, result.total)
  }, [])

  // Tab / 来源变化时重新加载
  useEffect(() => {
    void loadRows(keyword)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, sources])

  // 首次进入拉取来源与曲目
  useEffect(() => {
    void refreshSources().then(() => { void loadRows('') })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleTabChange = useCallback((id: LibraryTabId) => {
    setTabId(id)
    setTabIdState(id)
  }, [])

  const handleKeywordChange = useCallback((text: string) => {
    setKeyword(text)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => { void loadRows(text) }, 250)
  }, [loadRows])

  const handlePlayRow = useCallback((row: NativeTrackRow, index: number) => {
    void handlePlay(rows, index)
  }, [rows])

  const handleShowMenu = useCallback((row: NativeTrackRow, index: number, position: { x: number, y: number, w: number, h: number }) => {
    listMenuRef.current?.show(row, rows, index, position)
  }, [rows])

  const handleAddFolder = useCallback(() => {
    void pickLocalFolder().then(result => {
      if (!result) return
      void refreshSources()
      void startSourceScan(result.source.id)
    })
  }, [])

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
        <View style={styles.searchBar}>
          <Input
            onChangeText={handleKeywordChange}
            placeholder={t('library_search_placeholder')}
            value={keyword}
            clearBtn={!!keyword}
            onClearText={() => { handleKeywordChange('') }}
            style={styles.input}
          />
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
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 10,
    paddingRight: 10,
    paddingBottom: 6,
    gap: 8,
  },
  input: {
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
