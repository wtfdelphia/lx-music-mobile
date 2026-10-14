import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View, FlatList, TouchableOpacity, Image } from 'react-native'
import { Icon } from '@/components/common/Icon'

import List, { type ListType } from './List'
import ListMenu, { type ListMenuType } from './ListMenu'
import AlbumGrid from './AlbumGrid'
import ArtistList from './ArtistList'
import { handlePlay } from './listAction'
import { toMusicInfo } from '@/core/library/toMusicInfo'
import MusicAddModal, { type MusicAddModalType } from '@/components/MusicAddModal'
import Modal, { type ModalType } from '@/components/common/Modal'
import SourceManageModal, { type SourceManageModalType } from './SourceManageModal'
import { queryTracks, queryAlbums, queryArtists, queryAlbumTracks, queryArtistTracks } from '@/core/library/query'
import * as native from '@/core/library/native'
import { setRows, setTabId, setFilterSourceId } from '@/store/library/action'
import { useLibrarySources } from '@/store/library/hook'
import DorpDownMenu from '@/components/common/DorpDownMenu'
import state from '@/store/library/state'
import { pickLocalFolder } from '@/core/library/sources/local'
import { startSourceScan, refreshSources, scanAllSources } from '@/core/library/sync'
import { removeFromLibrary, deleteFiles, toggleLove, getLoveSet } from '@/core/library/actions'
import { searchLyricCandidates, applyLyricCandidate, type LyricCandidate } from '@/core/library/lyricSearch'
import { toast, createStyle, confirmDialog } from '@/utils/tools'
import { addListMusics } from '@/core/list'
import { LIST_IDS } from '@/config/constant'
import settingState from '@/store/setting/state'
import { useI18n } from '@/lang'
import { useTheme } from '@/store/theme/hook'
import Text from '@/components/common/Text'
import Button from '@/components/common/Button'
import Input from '@/components/common/Input'
import { useSettingValue } from '@/store/setting/hook'
import MetadataEditModal, { type MetadataEditType } from '@/components/MetadataEditModal'
import type { NativeTrackRow, LibrarySource } from '@/core/library/types'
import type { LibraryTabId } from '@/store/library/state'

const TABS: Array<{ id: LibraryTabId, key: 'library_tab_tracks' | 'library_tab_albums' | 'library_tab_artists' | 'library_tab_recent' }> = [
  { id: 'tracks', key: 'library_tab_tracks' },
  { id: 'albums', key: 'library_tab_albums' },
  { id: 'artists', key: 'library_tab_artists' },
  { id: 'recent', key: 'library_tab_recent' },
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
  const listAddModalRef = useRef<MusicAddModalType>(null)
  const sourceManageRef = useRef<SourceManageModalType>(null)
  const [tabId, setTabIdState] = useState<LibraryTabId>(state.tabId)
  const [keyword, setKeyword] = useState('')
  // 专辑 / 艺人下钻状态：P1 先在列内下钻，详情屏（3.3）接入后迁移
  const [drill, setDrill] = useState<{ type: 'album' | 'artist', key: string, title: string } | null>(null)
  const [filterSourceId, setFilterSourceIdState] = useState<string | null>(null)
  // 曲目排序（F5「支持排序」）：标题 / 艺人 / 专辑循环切换
  const [trackSort, setTrackSort] = useState<'title' | 'artist' | 'album'>('title')
  // 添加文件夹时是否包含子文件夹（§14.4，默认递归）
  const [addFolderRecursive, setAddFolderRecursive] = useState(true)
  // 下钻封面（§14.3 详情头）：下钻时记录聚合行的封面缓存名
  const [drillArtworkUrl, setDrillArtworkUrl] = useState<string | null>(null)
  // 「喜欢」集合：曲目行显示红心用
  const [loveSet, setLoveSet] = useState<Set<string>>(new Set())
  // 歌词搜索候选弹窗
  const [lyricCandidates, setLyricCandidates] = useState<LyricCandidate[] | null>(null)
  const lyricRowRef = useRef<NativeTrackRow | null>(null)
  const lyricModalRef = useRef<ModalType>(null)
  const sources = useLibrarySources()
  // 行数据不在本组件消费（List 自行订阅），播放 / 菜单一律按定位符
  // 从 state.rows 现查，绕开 memo 闭包过期问题
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 请求序号守卫：慢的旧请求不得覆盖新结果
  const loadSeq = useRef(0)

  const loadRows = useCallback(async(kw: string) => {
    const seq = ++loadSeq.current
    // 下钻沿用当前来源筛选，不取聚合行的 MIN(source_id)（N3 修复）
    const filterIds = filterSourceId ? [filterSourceId] : []
    let next: { rows: NativeTrackRow[], total: number }
    if (drill) {
      const trackRows = drill.type === 'album'
        ? await queryAlbumTracks(filterIds, drill.key, 0, 200)
        : await queryArtistTracks(filterIds, drill.key, 0, 200)
      next = { rows: trackRows, total: trackRows.length }
    } else {
      const spec = {
        sourceIds: filterSourceId ? [filterSourceId] : undefined,
        keyword: kw || undefined,
        offset: 0,
        limit: 200,
      }
      // Tab 分流：各 Tab 各查各的视图（此前都查 tracks，切 Tab 无效果）；
      // 最近播放按最后播放时间倒序
      const result = tabId === 'albums'
        ? await queryAlbums(spec)
        : tabId === 'artists'
          ? await queryArtists(spec)
          : tabId === 'recent'
            ? await queryTracks({ ...spec, sort: 'recent' })
            : await queryTracks({ ...spec, sort: trackSort })
      next = result
    }
    if (seq !== loadSeq.current) return // 过期结果丢弃
    setRows(next.rows, next.total)
  }, [tabId, drill, filterSourceId, trackSort])

  // Tab / 下钻 / 来源筛选 / 排序 / 来源列表变化时重新加载
  useEffect(() => {
    void loadRows(keyword)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, drill, filterSourceId, trackSort, sources])

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
    const currentRows = state.rows
    // 下钻视图：行已经是曲目，点击直接播放。此前漏判 drill 状态，
    // tabId 仍是 albums / artists，导致点曲目被当成再次下钻
    if (drill) {
      const index = currentRows.findIndex(r => r.locator === locator)
      if (index < 0) {
        toast(t('library_play_failed'), 'short')
        return
      }
      void handlePlay(currentRows, index)
      return
    }
    // 专辑 / 艺人视图：点击是下钻而非播放。合成行的 locator 是
    // album_key / artist_key，sourceId 为聚合结果的 MIN(source_id)。
    // 一律从 state.rows 现查，避免 memo 挡住闭包更新
    if (tabId === 'albums') {
      const row = currentRows.find(r => r.locator === locator)
      if (row) {
        setDrill({ type: 'album', key: row.itemKey, title: row.title })
        setDrillArtworkUrl(null)
        if (row.artwork) void native.artworkUrlForName(row.artwork).then(url => { setDrillArtworkUrl(url || null) })
      }
      return
    }
    if (tabId === 'artists') {
      const row = currentRows.find(r => r.locator === locator)
      if (row) {
        setDrill({ type: 'artist', key: row.itemKey, title: row.title })
        setDrillArtworkUrl(null)
        if (row.artwork) void native.artworkUrlForName(row.artwork).then(url => { setDrillArtworkUrl(url || null) })
      }
      return
    }
    // tracks / 最近播放：曲目视图，按定位符在最新列表现查，
    // 避开 memo 闭包过期问题
    const index = currentRows.findIndex(r => r.locator === locator)
    if (index < 0) {
      toast(t('library_play_failed'), 'short')
      return
    }
    void handlePlay(currentRows, index)
  }, [drill, tabId, t])

  const handleShowMenu = useCallback((locator: string, position: { x: number, y: number, w: number, h: number }) => {
    // 同播放路径：按定位符在最新列表现查，避免 memo 闭包过期
    const currentRows = state.rows
    const index = currentRows.findIndex(r => r.locator === locator)
    if (index < 0) return
    listMenuRef.current?.show(currentRows[index], currentRows, index, position)
  }, [])

  const sourceLabel = useCallback((source: LibrarySource): string => {
    // 下载虚拟来源的名字是字面量 'download'，走 i18n（复用导航键）
    return source.type === 'download' ? t('nav_download') : source.name
  }, [t])

  const handleSourceChange = useCallback(({ action }: { action: string }) => {
    if (action === 'all') {
      setFilterSourceIdState(null)
      setFilterSourceId(null)
      setDrill(null)
      return
    }
    if (action === 'rescan') {
      // 「重新扫描当前来源」入口：元数据修复后存量曲目需重扫刷新
      if (state.filterSourceId) {
        void startSourceScan(state.filterSourceId).then(started => {
          if (!started) toast(t('library_scan_busy'), 'short')
        })
      }
      return
    }
    if (action.startsWith('src:')) {
      const id = action.slice(4)
      setFilterSourceIdState(id)
      setFilterSourceId(id)
      setDrill(null)
    }
  }, [t])

  // 来源下拉菜单：全部 + 下载虚拟来源 + 各文件夹来源
  const sourceMenus = useMemo(() => {
    const items: Array<{ action: string, label: string, disabled?: boolean }> = [
      { action: 'all', label: t('library_all_sources') },
    ]
    for (const source of sources) {
      items.push({ action: `src:${source.id}`, label: sourceLabel(source) })
    }
    items.push({ action: 'rescan', label: t('library_rescan_source'), disabled: !filterSourceId })
    return items
  }, [sources, sourceLabel, t, filterSourceId])

  // 「喜欢」集合初始化：来源 / 行变化时刷新
  useEffect(() => {
    void getLoveSet().then(setLoveSet)
  }, [sources, tabId, drill, filterSourceId])

  const handleAddToList = useCallback((row: NativeTrackRow) => {
    const musicAddModalRef = listAddModalRef.current
    if (!musicAddModalRef) return
    musicAddModalRef.show({ musicInfo: toMusicInfo(row), listId: '', isMove: false })
  }, [])

  const handleToggleLove = useCallback(async(row: NativeTrackRow) => {
    const loved = loveSet.has(row.locator)
    await toggleLove(row, loved)
    setLoveSet(await getLoveSet())
  }, [loveSet])

  const handleSearchLyric = useCallback((row: NativeTrackRow) => {
    lyricRowRef.current = row
    toast(t('library_lyric_searching'), 'short')
    void searchLyricCandidates(row).then(candidates => {
      setLyricCandidates(candidates)
      lyricModalRef.current?.setVisible(true)
    }).catch(() => {
      toast(t('library_lyric_not_found'), 'short')
    })
  }, [t])

  const handleApplyLyric = useCallback(async(candidate: LyricCandidate) => {
    const row = lyricRowRef.current
    if (!row) return
    lyricModalRef.current?.setVisible(false)
    setLyricCandidates(null)
    try {
      await applyLyricCandidate(row, candidate)
      toast(t('library_lyric_found'), 'short')
    } catch {
      toast(t('library_lyric_not_found'), 'short')
    }
  }, [t])

  const handleViewAlbum = useCallback((row: NativeTrackRow) => {
    if (!row.album) return
    setTabId('albums')
    setTabIdState('albums')
    setFilterSourceIdState(row.sourceId)
    setFilterSourceId(row.sourceId)
    setDrill(null)
    void queryAlbums({ sourceIds: [row.sourceId], keyword: row.album, offset: 0, limit: 200 }).then(result => {
      const albumRow = result.rows.find(r => r.itemKey === row.album || r.title === row.album)
      if (albumRow) setDrill({ type: 'album', key: albumRow.itemKey, title: albumRow.title })
    })
  }, [])

  const handleViewArtist = useCallback((row: NativeTrackRow) => {
    if (!row.artist) return
    setTabId('artists')
    setTabIdState('artists')
    setFilterSourceIdState(row.sourceId)
    setFilterSourceId(row.sourceId)
    setDrill(null)
    void queryArtists({ sourceIds: [row.sourceId], keyword: row.artist, offset: 0, limit: 200 }).then(result => {
      const artistRow = result.rows.find(r => r.title === row.artist)
      if (artistRow) setDrill({ type: 'artist', key: artistRow.itemKey, title: artistRow.title })
    })
  }, [])

  const handleRemove = useCallback(async(row: NativeTrackRow) => {
    const confirmed = await confirmDialog({
      message: t('library_remove_confirm'),
      confirmButtonText: t('library_remove'),
    })
    if (!confirmed) return
    await removeFromLibrary([row])
    void refreshSources()
  }, [t])

  const handleDeleteFile = useCallback(async(row: NativeTrackRow) => {
    const confirmed = await confirmDialog({
      message: t('library_delete_file_confirm').replace('{num}', '1'),
      confirmButtonText: t('library_delete_file'),
    })
    if (!confirmed) return
    try {
      await deleteFiles([row])
    } catch {
      toast(t('library_delete_failed'), 'short')
      return
    }
    void refreshSources()
  }, [t])

  // ---- 多选（§14.2 复用现有多选语义）----
  const [multiSelect, setMultiSelect] = useState(false)
  const [selectedLocators, setSelectedLocators] = useState<string[]>([])

  const handleMultiSelectModeChange = useCallback((active: boolean, locators: string[]) => {
    setMultiSelect(active)
    setSelectedLocators(locators)
  }, [])

  const selectedRows = useMemo(
    () => state.rows.filter(r => selectedLocators.includes(r.locator)),
    // 选中集合变化即重算；state.rows 由订阅驱动，这里按内容比较足够
    [selectedLocators],
  )

  const handleBatchPlay = useCallback(() => {
    if (!selectedRows.length) return
    void handlePlay(selectedRows, 0)
    listRef.current?.exitMultiSelect()
  }, [selectedRows])

  const handleBatchAddToList = useCallback(() => {
    if (!selectedRows.length) return
    const musicInfos = selectedRows.map(r => toMusicInfo(r))
    void addListMusics(LIST_IDS.TEMP, musicInfos, settingState.setting['list.addMusicLocationType'])
    toast(t('list_add_tip_exists'), 'short')
    listRef.current?.clearSelection()
  }, [selectedRows, t])

  const handleBatchRemove = useCallback(async() => {
    if (!selectedRows.length) return
    const confirmed = await confirmDialog({
      message: t('library_remove_confirm'),
      confirmButtonText: t('library_remove'),
    })
    if (!confirmed) return
    await removeFromLibrary(selectedRows)
    listRef.current?.exitMultiSelect()
    void refreshSources()
  }, [selectedRows, t])

  const handleBatchDeleteFiles = useCallback(async() => {
    if (!selectedRows.length) return
    const confirmed = await confirmDialog({
      message: t('library_delete_file_confirm').replace('{num}', String(selectedRows.length)),
      confirmButtonText: t('library_delete_file'),
    })
    if (!confirmed) return
    try {
      await deleteFiles(selectedRows)
    } catch {
      toast(t('library_delete_failed'), 'short')
    }
    listRef.current?.exitMultiSelect()
    void refreshSources()
  }, [selectedRows, t])

  const handleOpenAlbum = useCallback((row: NativeTrackRow) => {
    setDrill({ type: 'album', key: row.itemKey, title: row.title })
    setDrillArtworkUrl(null)
    if (row.artwork) void native.artworkUrlForName(row.artwork).then(url => { setDrillArtworkUrl(url || null) })
  }, [])

  const handleOpenArtist = useCallback((row: NativeTrackRow) => {
    setDrill({ type: 'artist', key: row.itemKey, title: row.title })
    setDrillArtworkUrl(null)
    if (row.artwork) void native.artworkUrlForName(row.artwork).then(url => { setDrillArtworkUrl(url || null) })
  }, [])

  // 下钻视图的「播放全部 / 添加到列表」（§14.3）：
  // 按当前行的最新数据操作
  const handleDrillPlayAll = useCallback(() => {
    const currentRows = state.rows
    if (!currentRows.length) return
    void handlePlay(currentRows, 0)
  }, [])

  const handleDrillAddToList = useCallback(() => {
    const currentRows = state.rows
    if (!currentRows.length) return
    const musicInfos = currentRows.map(r => toMusicInfo(r))
    void addListMusics(LIST_IDS.TEMP, musicInfos, settingState.setting['list.addMusicLocationType'])
    toast(t('list_add_tip_exists'), 'short')
  }, [t])

  const handleScanAll = useCallback(() => {
    // 元数据修复后存量曲目需重扫刷新；扫描中重复点击由
    // startSourceScan 的单飞锁挡住
    void scanAllSources().then(() => { void refreshSources() })
  }, [])

  const handleAddFolder = useCallback(() => {
    // 顺序关键：必须等来源列表刷新进 store 后才能发起扫描，
    // `startSourceScan` 从 store 查来源，并发执行时新来源还不在，
    // 会直接 return false 导致「来源落库但永不扫描」
    void (async() => {
      let result
      try {
        result = await pickLocalFolder({ recursive: addFolderRecursive })
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
  }, [t, addFolderRecursive])

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
                  <Button style={styles.backBtn} onPress={() => { setDrill(null); setDrillArtworkUrl(null) }}>
                    <Text size={13} color={theme['c-primary-font']}>{t('back')}</Text>
                  </Button>
                  {drillArtworkUrl
                    ? <Image source={{ uri: drillArtworkUrl }} style={styles.drillArtwork} />
                    : <View style={styles.drillArtworkPlaceholder} />}
                  <Text style={styles.drillTitle} numberOfLines={1}>{drill.title}</Text>
                  <Button style={styles.backBtn} onPress={handleDrillPlayAll}>
                    <Text size={13} color={theme['c-primary-font']}>{t('play')}</Text>
                  </Button>
                  <Button style={styles.backBtn} onPress={handleDrillAddToList}>
                    <Text size={13} color={theme['c-primary-font']}>{t('library_add_to_list')}</Text>
                  </Button>
                </View>
              )
            : (
                <View style={styles.searchInputWrap}>
                  {(tabId === 'tracks' || tabId === 'recent')
                    ? (
                        <Button
                          style={styles.sortBtn}
                          onPress={() => { setTrackSort(trackSort === 'title' ? 'artist' : trackSort === 'artist' ? 'album' : 'title') }}
                        >
                          <Text size={12} color={theme['c-font']}>
                            {t(trackSort === 'title' ? 'library_sort_title' : trackSort === 'artist' ? 'library_sort_artist' : 'library_sort_album')}
                          </Text>
                        </Button>
                      )
                    : null}
                  <DorpDownMenu
                    menus={sourceMenus}
                    onPress={handleSourceChange}
                    activeId={filterSourceId ? `src:${filterSourceId}` : 'all'}
                    btnStyle={styles.sourceBtn}
                    fontSize={13}
                  >
                    <Text size={13} color={theme['c-font']} numberOfLines={1}>
                      {(() => {
                        const cur = filterSourceId ? sources.find(s => s.id === filterSourceId) : undefined
                        return cur ? sourceLabel(cur) : t('library_all_sources')
                      })()}
                    </Text>
                  </DorpDownMenu>
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
          <Button style={styles.addBtn} onPress={() => { sourceManageRef.current?.show() }}>
            <Text size={13} color={theme['c-font']}>{t('library_source_manage')}</Text>
          </Button>
          <Button style={styles.addBtn} onPress={handleScanAll}>
            <Text size={13} color={theme['c-font']}>{t('library_scan_all')}</Text>
          </Button>
          <TouchableOpacity style={styles.recursiveToggle} onPress={() => { setAddFolderRecursive(!addFolderRecursive) }}>
            <Icon name={addFolderRecursive ? 'checkbox-marked' : 'checkbox-blank-outline'} size={14} color={theme['c-font-label']} />
            <Text size={11} color={theme['c-font-label']}>{t('library_add_folder_recursive_tip')}</Text>
          </TouchableOpacity>
          <Button style={styles.addBtn} onPress={handleAddFolder}>
            <Text size={13} color={theme['c-primary-font']}>{t('library_add_folder')}</Text>
          </Button>
        </View>
      </View>
      {multiSelect
        ? (
            <View style={styles.multiBar}>
              <Button style={styles.multiBtn} onPress={handleBatchPlay}>
                <Text size={13} color={theme['c-primary-font']}>{t('play')}</Text>
              </Button>
              <Button style={styles.multiBtn} onPress={handleBatchAddToList}>
                <Text size={13} color={theme['c-primary-font']}>{t('library_add_to_list')}</Text>
              </Button>
              <Button style={styles.multiBtn} onPress={() => { void handleBatchRemove() }}>
                <Text size={13} color={theme['c-primary-font']}>{t('library_remove')}</Text>
              </Button>
              <Button style={styles.multiBtn} onPress={() => { void handleBatchDeleteFiles() }}>
                <Text size={13} color="#f24a4a">{t('library_delete_file')}</Text>
              </Button>
              <Button style={styles.multiBtn} onPress={() => { listRef.current?.exitMultiSelect() }}>
                <Text size={13} color={theme['c-font']}>{t('back')}</Text>
              </Button>
            </View>
          )
        : null}
      {hasSource
        ? (drill
            ? (
                <List
                  ref={listRef}
                  onPlay={handlePlayRow}
                  onShowMenu={handleShowMenu}
                  onMultiSelectModeChange={handleMultiSelectModeChange}
                  isTrackView
                  loveSet={loveSet}
                />
              )
            : tabId === 'albums'
              ? <AlbumGrid rows={state.rows} onOpenAlbum={handleOpenAlbum} />
              : tabId === 'artists'
                ? <ArtistList rows={state.rows} onOpenArtist={handleOpenArtist} />
                : (
                    <List
                      ref={listRef}
                      onPlay={handlePlayRow}
                      onShowMenu={handleShowMenu}
                      onMultiSelectModeChange={handleMultiSelectModeChange}
                      isTrackView
                      loveSet={loveSet}
                    />
                  ))
        : (
            <View style={styles.empty}>
              <Text color={theme['c-font-label']}>{t('library_empty')}</Text>
              <Button style={styles.emptyBtn} onPress={handleAddFolder}>
                <Text size={13} color={theme['c-primary-font']}>{t('library_add_folder')}</Text>
              </Button>
            </View>
          )}
      <ListMenu
        ref={listMenuRef}
        onHideMenu={() => {}}
        onTagInfo={(row) => { metadataEditRef.current?.show(row.locator) }}
        onAddToList={handleAddToList}
        onToggleLove={(row) => { void handleToggleLove(row) }}
        onSearchLyric={handleSearchLyric}
        onViewAlbum={handleViewAlbum}
        onViewArtist={handleViewArtist}
        onRemove={(row) => { void handleRemove(row) }}
        onDeleteFile={(row) => { void handleDeleteFile(row) }}
        isLoved={(locator) => loveSet.has(locator)}
      />
      <MetadataEditModal ref={metadataEditRef} onUpdate={() => {}} />
      <MusicAddModal ref={listAddModalRef} />
      <SourceManageModal ref={sourceManageRef} />
      {/* 歌词搜索候选（§13.1）：按时长差排序，选中即应用 */}
      <Modal
        ref={lyricModalRef}
        onHide={() => { setLyricCandidates(null) }}
      >
        <View style={styles.lyricModal}>
          <Text size={15} style={styles.lyricModalTitle}>{t('library_search_lyric')}</Text>
          <FlatList
            data={lyricCandidates ?? []}
            keyExtractor={(item) => item.musicInfo.id}
            style={styles.lyricList}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.lyricItem} onPress={() => { void handleApplyLyric(item) }}>
                <Text numberOfLines={1} size={13}>{item.musicInfo.name} - {item.musicInfo.singer}</Text>
                <Text numberOfLines={1} size={11} color={theme['c-font-label']}>
                  {item.musicInfo.meta.albumName ?? ''}
                  {item.durationDiff !== 0 ? ` (${item.durationDiff > 0 ? '+' : ''}${item.durationDiff.toFixed(0)}s)` : ''}
                </Text>
              </TouchableOpacity>
            )}
          />
        </View>
      </Modal>
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
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 8,
  },
  sortBtn: {
    flexGrow: 0,
    flexShrink: 0,
    paddingLeft: 4,
    paddingRight: 6,
    paddingTop: 7,
    paddingBottom: 7,
  },
  sourceBtn: {
    flexGrow: 0,
    flexShrink: 1,
    maxWidth: 110,
    paddingLeft: 6,
    paddingRight: 6,
    paddingTop: 7,
    paddingBottom: 7,
    marginRight: 6,
  },
  input: {
    flex: 1,
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
  drillArtwork: {
    width: 30,
    height: 30,
    borderRadius: 3,
    marginRight: 6,
  },
  drillArtworkPlaceholder: {
    width: 30,
    height: 30,
    borderRadius: 3,
    marginRight: 6,
    backgroundColor: 'rgba(128,128,128,0.15)',
  },
  drillTitle: {
    flex: 1,
  },
  recursiveToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 4,
    paddingRight: 4,
    paddingTop: 8,
    paddingBottom: 8,
    marginRight: 4,
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
  emptyBtn: {
    marginTop: 12,
    paddingLeft: 12,
    paddingRight: 12,
    paddingTop: 8,
    paddingBottom: 8,
  },
  lyricModal: {
    flex: 1,
    minHeight: 320,
    maxHeight: 480,
    width: '100%',
  },
  lyricModalTitle: {
    textAlign: 'center',
    paddingTop: 12,
    paddingBottom: 8,
  },
  lyricList: {
    flexGrow: 0,
  },
  lyricItem: {
    paddingLeft: 16,
    paddingRight: 16,
    paddingTop: 8,
    paddingBottom: 8,
  },
  multiBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 6,
    paddingRight: 6,
    paddingTop: 4,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.08)',
  },
  multiBtn: {
    paddingLeft: 8,
    paddingRight: 8,
    paddingTop: 6,
    paddingBottom: 6,
  },
})
