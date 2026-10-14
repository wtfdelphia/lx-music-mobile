import { forwardRef, useImperativeHandle, useRef, useState, useEffect, useMemo } from 'react'
import { View, FlatList, TouchableOpacity } from 'react-native'

import ConfirmAlert, { type ConfirmAlertType } from '@/components/common/ConfirmAlert'
import Text from '@/components/common/Text'
import Button from '@/components/common/Button'
import Input from '@/components/common/Input'
import { useI18n } from '@/lang'
import { useTheme } from '@/store/theme/hook'
import { createStyle, confirmDialog, toast } from '@/utils/tools'
import { useLibrarySources, useScanProgress, useScanReport } from '@/store/library/hook'
import { startSourceScan, cancelSourceScan, refreshSources } from '@/core/library/sync'
import { setSourceEnabled, relinkSource, renameSource } from '@/core/library/sources/local'
import { restoreRemoved, countListRefsForSource, deleteLibrarySource } from '@/core/library/actions'
import * as native from '@/core/library/native'
import type { LibrarySource, LibraryScanReport } from '@/core/library/types'

export interface SourceManageModalType {
  show: () => void
}

const STATE_KEYS: Record<LibrarySource['state'], 'library_source_state_ok' | 'library_source_state_needs_reauth' | 'library_source_state_unreachable' | 'library_source_state_scanning'> = {
  ok: 'library_source_state_ok',
  needs_reauth: 'library_source_state_needs_reauth',
  unreachable: 'library_source_state_unreachable',
  scanning: 'library_source_state_scanning',
}

const formatLastScan = (ts: number | null): string => {
  if (!ts) return ''
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 来源条目：曲目数、最后扫描时间、操作行 */
const SourceItem = ({ source, isScanning, scanned, trackCount, onScan, onCancelScan, onRelink, onToggleEnabled, onRename, onRestore, onDelete }: {
  source: LibrarySource
  isScanning: boolean
  scanned: number
  trackCount: number
  onScan: (s: LibrarySource) => void
  onCancelScan: (s: LibrarySource) => void
  onRelink: (s: LibrarySource) => void
  onToggleEnabled: (s: LibrarySource) => void
  onRename: (s: LibrarySource) => void
  onRestore: (s: LibrarySource) => void
  onDelete: (s: LibrarySource) => void
}) => {
  const t = useI18n()
  const theme = useTheme()
  const stateLabel = isScanning ? t('library_source_state_scanning') : t(STATE_KEYS[source.state])
  const lastScan = formatLastScan(source.lastScanAt)

  return (
    <View style={styles.sourceItem}>
      <View style={styles.sourceInfo}>
        <Text numberOfLines={1} size={14}>{source.name}</Text>
        <Text numberOfLines={1} size={11} color={theme['c-font-label']}>
          {source.type === 'local' ? t('library_type_local') : source.type === 'download' ? t('nav_download') : source.type} · {trackCount}{t('library_tracks_suffix')} · {stateLabel}
          {isScanning ? ` (${scanned})` : ''}
          {lastScan ? ` · ${lastScan}` : ''}
        </Text>
      </View>
      <View style={styles.sourceActions}>
        {isScanning
          ? (
              <Button style={styles.actionBtn} onPress={() => { onCancelScan(source) }}>
                <Text size={12} color="#f24a4a">{t('dialog_cancel')}</Text>
              </Button>
            )
          : (
              <Button style={styles.actionBtn} onPress={() => { onScan(source) }}>
                <Text size={12} color={theme['c-primary-font']}>{t('library_scan')}</Text>
              </Button>
            )}
        {source.type === 'local'
          ? (
              <Button style={styles.actionBtn} onPress={() => { onRelink(source) }}>
                <Text size={12} color={theme['c-font']}>{t('library_source_relink')}</Text>
              </Button>
            )
          : null}
        <Button style={styles.actionBtn} onPress={() => { onRename(source) }}>
          <Text size={12} color={theme['c-font']}>{t('library_source_edit')}</Text>
        </Button>
        <Button style={styles.actionBtn} onPress={() => { onToggleEnabled(source) }}>
          <Text size={12} color={theme['c-font']}>{source.enabled ? t('library_source_disable') : t('library_source_enable')}</Text>
        </Button>
        <Button style={styles.actionBtn} onPress={() => { onRestore(source) }}>
          <Text size={12} color={theme['c-font']}>{t('library_restore_removed')}</Text>
        </Button>
        {source.type !== 'download'
          ? (
              <Button style={styles.actionBtn} onPress={() => { onDelete(source) }}>
                <Text size={12} color="#f24a4a">{t('delete')}</Text>
              </Button>
            )
          : null}
      </View>
    </View>
  )
}

/**
 * 重命名独立弹窗：此前渲染在来源管理 ConfirmAlert 的 ScrollView
 * 末尾，来源多时被顶出屏幕外，点「编辑」像没反应（真机反馈）。
 * 独立成嵌套 Modal 后永远可见
 */
const RenameModal = ({ initialName, onConfirm, onCancel }: {
  initialName: string
  onConfirm: (name: string) => void
  onCancel: () => void
}) => {
  const t = useI18n()
  const dialogRef = useRef<ConfirmAlertType>(null)
  const [name, setName] = useState(initialName)
  useEffect(() => {
    dialogRef.current?.setVisible(true)
  }, [])
  return (
    <ConfirmAlert
      ref={dialogRef}
      title={t('library_source_edit')}
      confirmText={t('dialog_confirm')}
      cancelText={t('dialog_cancel')}
      onConfirm={() => { onConfirm(name) }}
      onCancel={onCancel}
    >
      <View style={styles.renameBox}>
        <Input
          value={name}
          onChangeText={setName}
          style={styles.renameInput}
        />
      </View>
    </ConfirmAlert>
  )
}

/** 扫描报告子面板（§14.4） */
const ScanReportView = ({ source }: { source: LibrarySource }) => {
  const t = useI18n()
  const theme = useTheme()
  // 本次会话的扫描报告（实时事件写入）；没有则回读来源行里持久化的
  // lastScanReport（上次扫描落库，跨会话可见）——此前只读内存，
  // 打开来源管理时本会话没扫过就永远「暂无扫描报告」（真机反馈）
  const liveReport = useScanReport(source.id)
  const report = useMemo(() => {
    if (liveReport) return liveReport
    if (!source.lastScanReport) return null
    try {
      const parsed = JSON.parse(source.lastScanReport) as LibraryScanReport
      // 持久化摘要字段齐全才用，缺明细结构则视为无报告
      if (parsed?.unsupported && parsed.failed) return parsed
      return null
    } catch {
      return null
    }
  }, [liveReport, source.lastScanReport])
  if (!report) return <Text size={12} color={theme['c-font-label']} style={styles.reportEmpty}>{t('library_report_empty')}</Text>

  return (
    <View style={styles.reportBox}>
      <Text size={12}>
        {t('library_report_summary')}: {t('library_report_imported')} {report.imported} · {t('library_report_updated')} {report.updated} · {t('library_report_removed')} {report.removed}
      </Text>
      {report.unsupported.total > 0
        ? <Text size={11} color={theme['c-font-label']}>{t('library_report_unsupported')}: {report.unsupported.total}</Text>
        : null}
      {report.notDownloaded.total > 0
        ? <Text size={11} color={theme['c-font-label']}>{t('library_report_not_downloaded')}: {report.notDownloaded.total}</Text>
        : null}
      {report.failed.total > 0
        ? <Text size={11} color={theme['c-font-label']}>{t('library_report_failed')}: {report.failed.total}</Text>
        : null}
      {report.unreadableDirs.total > 0
        ? <Text size={11} color={theme['c-font-label']}>{t('library_report_unreadable')}: {report.unreadableDirs.total}</Text>
        : null}
    </View>
  )
}

export default forwardRef<SourceManageModalType, {}>((_props, ref) => {
  const t = useI18n()
  const theme = useTheme()
  const alertRef = useRef<ConfirmAlertType>(null)
  const [visible, setVisible] = useState(false)
  const sources = useLibrarySources()
  const scanProgress = useScanProgress()
  const [trackCounts, setTrackCounts] = useState<Record<string, number>>({})
  const [countsTick, setCountsTick] = useState(0)
  const [expandedReportId, setExpandedReportId] = useState<string | null>(null)
  const [renameTarget, setRenameTarget] = useState<LibrarySource | null>(null)

  // 扫描完成直接驱动计数刷新：此前只依赖 sources 数组引用变化，
  // 扫描事件链路一旦有延迟，数量就停在旧值（真机反馈）
  useEffect(() => {
    const handleScanDone = () => { setCountsTick(v => v + 1) }
    global.app_event.on('libraryScanDone', handleScanDone)
    return () => { global.app_event.off('libraryScanDone', handleScanDone) }
  }, [])

  useImperativeHandle(ref, () => ({
    show() {
      if (visible) alertRef.current?.setVisible(true)
      else {
        setVisible(true)
        requestAnimationFrame(() => {
          alertRef.current?.setVisible(true)
        })
      }
    },
  }))

  // 曲目数：来源列表变化或扫描完成时刷新
  useEffect(() => {
    if (!sources.length) return
    void (async() => {
      const counts: Record<string, number> = {}
      for (const source of sources) {
        counts[source.id] = await native.countTracks(source.id).catch(() => 0)
      }
      setTrackCounts(counts)
    })()
  }, [sources, countsTick])

  const handleScan = (source: LibrarySource) => {
    void startSourceScan(source.id).then(started => {
      if (!started) void confirmDialog({ message: t('library_scan_busy') }).catch(() => {})
    })
  }

  const handleCancelScan = (source: LibrarySource) => {
    void cancelSourceScan(source.id)
  }

  const handleToggleEnabled = async(source: LibrarySource) => {
    await setSourceEnabled(source, !source.enabled)
    await refreshSources()
    setCountsTick(v => v + 1)
  }

  const handleRelink = (source: LibrarySource) => {
    void relinkSource(source.id).then(() => { void refreshSources() })
  }

  const handleRestore = (source: LibrarySource) => {
    void restoreRemoved(source.id, source.type).then(ok => {
      if (ok) toast(t('library_restore_removed_done'), 'short')
    })
  }

  const handleRenameOpen = (source: LibrarySource) => {
    setRenameTarget(source)
  }

  const handleRenameConfirm = async(name: string) => {
    if (!renameTarget) return
    setRenameTarget(null)
    const ok = await renameSource(renameTarget, name)
    if (ok) {
      await refreshSources()
      setCountsTick(v => v + 1)
      toast(t('library_source_renamed'), 'short')
    } else {
      toast(t('list_add_tip_exists'), 'short')
    }
  }

  const handleDelete = async(source: LibrarySource) => {
    // §9：删除前统计列表中该来源的引用曲目数
    const refCount = await countListRefsForSource(source.id).catch(() => 0)
    const msg = refCount > 0
      ? t('library_source_still_in_lists').replace('{num}', String(refCount))
      : t('library_source_delete_tip')
    const confirmed = await confirmDialog({
      message: `${source.name} - ${msg}`,
      confirmButtonText: t('delete'),
    })
    if (!confirmed) return
    let removeFromLists = false
    if (refCount > 0) {
      removeFromLists = await confirmDialog({
        message: t('library_source_remove_from_lists'),
        confirmButtonText: t('dialog_confirm'),
        cancelButtonText: t('dialog_cancel'),
      })
    }
    await deleteLibrarySource(source.id, removeFromLists)
    await refreshSources()
    setCountsTick(v => v + 1)
  }

  const renderItem = ({ item }: { item: LibrarySource }) => {
    const progress = scanProgress[item.id]
    const isScanning = !!progress
    return (
      <View>
        <SourceItem
          source={item}
          isScanning={isScanning}
          scanned={progress?.scanned ?? 0}
          trackCount={trackCounts[item.id] ?? 0}
          onScan={handleScan}
          onCancelScan={handleCancelScan}
          onRelink={handleRelink}
          onToggleEnabled={(s) => { void handleToggleEnabled(s) }}
          onRename={handleRenameOpen}
          onRestore={handleRestore}
          onDelete={(s) => { void handleDelete(s) }}
        />
        {/* 扫描报告：点击来源名展开 */}
        <TouchableOpacity style={styles.reportToggle} onPress={() => { setExpandedReportId(expandedReportId === item.id ? null : item.id) }}>
          <Text size={11} color={theme['c-font-label']}>
            {expandedReportId === item.id ? '▲' : '▼'} {t('library_scan_report')}
          </Text>
        </TouchableOpacity>
        {expandedReportId === item.id ? <ScanReportView source={item} /> : null}
      </View>
    )
  }

  return (
    visible
      ? (
        <>
          <ConfirmAlert ref={alertRef} showConfirm={false} closeBtn>
            <View style={styles.content}>
              <Text size={15} style={styles.title}>{t('library_source_manage')}</Text>
              <FlatList
                data={sources}
                keyExtractor={item => item.id}
                renderItem={renderItem}
                style={styles.list}
              />
            </View>
          </ConfirmAlert>
          {renameTarget
            ? (
                <RenameModal
                  key={renameTarget.id}
                  initialName={renameTarget.name}
                  onConfirm={(name) => { void handleRenameConfirm(name) }}
                  onCancel={() => { setRenameTarget(null) }}
                />
              )
            : null}
        </>
        )
      : null
  )
})

const styles = createStyle({
  content: {
    minHeight: 240,
    maxHeight: 480,
    width: '100%',
  },
  title: {
    textAlign: 'center',
    paddingTop: 12,
    paddingBottom: 8,
  },
  list: {
    flexGrow: 0,
  },
  sourceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 12,
    paddingRight: 12,
    paddingTop: 8,
    paddingBottom: 4,
  },
  sourceInfo: {
    flex: 1,
    marginRight: 8,
  },
  sourceActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  actionBtn: {
    paddingLeft: 6,
    paddingRight: 6,
    paddingTop: 4,
    paddingBottom: 4,
    marginLeft: 4,
  },
  reportToggle: {
    paddingLeft: 12,
    paddingBottom: 4,
  },
  reportBox: {
    paddingLeft: 24,
    paddingRight: 12,
    paddingBottom: 8,
  },
  reportEmpty: {
    paddingLeft: 24,
    paddingBottom: 8,
  },
  renameBox: {
    paddingLeft: 16,
    paddingRight: 16,
    paddingBottom: 12,
  },
  renameTitle: {
    marginBottom: 6,
  },
  renameInput: {
    marginBottom: 6,
  },
  renameBtns: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
})
