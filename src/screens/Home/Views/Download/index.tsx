import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View } from 'react-native'

import List, { type ListType, type TabId } from './List'
import ListMenu, { type ListMenuType } from './ListMenu'
import { playListById } from '@/core/player/player'
import { LIST_IDS } from '@/config/constant'
import { enterDownloadView, startAll, pauseAll } from '@/core/download'
import { useDownloadList } from '@/store/download/hook'
import { useI18n } from '@/lang'
import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import Text from '@/components/common/Text'
import Button from '@/components/common/Button'

const TABS = [
  { id: 'all', key: 'download__all' },
  { id: 'running', key: 'download__running' },
  { id: 'paused', key: 'download__paused' },
  { id: 'error', key: 'download__error' },
  { id: 'completed', key: 'download__finished' },
] as const

export default () => {
  const t = useI18n()
  const theme = useTheme()
  const [tab, setTab] = useState<TabId>('all')
  const listRef = useRef<ListType>(null)
  const listMenuRef = useRef<ListMenuType>(null)
  const downloadList = useDownloadList()

  // 进入下载页触发对账（§7.8）
  useEffect(() => { void enterDownloadView() }, [])

  const handlePlay = useCallback((info: LX.Download.ListItem) => {
    if (info.status !== 'completed') return
    void playListById(LIST_IDS.DOWNLOAD, info.id)
  }, [])

  const hasRunning = useMemo(() => downloadList.some(item => item.status === 'run' || item.status === 'waiting'), [downloadList])
  const hasPaused = useMemo(() => downloadList.some(item => item.status === 'pause' || item.status === 'error'), [downloadList])

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.tabs}>
          {TABS.map(({ id, key }) => (
            <Button key={id} style={{ ...styles.tab, borderBottomColor: tab === id ? theme['c-primary-font'] : 'transparent' }} onPress={() => { setTab(id) }}>
              <Text color={tab === id ? theme['c-primary-font'] : theme['c-font']} size={14}>{t(key)}</Text>
            </Button>
          ))}
        </View>
        <View style={styles.actions}>
          <Button style={styles.actionBtn} disabled={!hasPaused} onPress={() => { startAll() }}>
            <Text size={13} color={hasPaused ? theme['c-primary-font'] : theme['c-font-label']}>{t('download__start_all')}</Text>
          </Button>
          <Button style={styles.actionBtn} disabled={!hasRunning} onPress={() => { pauseAll().catch(() => {}) }}>
            <Text size={13} color={hasRunning ? theme['c-primary-font'] : theme['c-font-label']}>{t('download__pause_all')}</Text>
          </Button>
        </View>
      </View>
      <List ref={listRef} tab={tab} onPlay={handlePlay} onShowMenu={(info, index, position) => {
        listMenuRef.current?.show(info, [], position)
      }} />
      <ListMenu ref={listMenuRef} onHideMenu={() => {}} />
    </View>
  )
}

const styles = createStyle({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 10,
    paddingRight: 10,
  },
  tabs: {
    flexDirection: 'row',
    flexShrink: 1,
    flexGrow: 1,
  },
  tab: {
    borderBottomWidth: 2,
    paddingTop: 10,
    paddingBottom: 8,
    marginRight: 14,
  },
  actions: {
    flexDirection: 'row',
  },
  actionBtn: {
    paddingLeft: 8,
    paddingRight: 8,
    paddingTop: 10,
    paddingBottom: 8,
  },
})
