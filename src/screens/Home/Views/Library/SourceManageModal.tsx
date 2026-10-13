import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { View, FlatList } from 'react-native'

import ConfirmAlert, { type ConfirmAlertType } from '@/components/common/ConfirmAlert'
import Text from '@/components/common/Text'
import Button from '@/components/common/Button'
import { useI18n } from '@/lang'
import { useTheme } from '@/store/theme/hook'
import { createStyle, confirmDialog } from '@/utils/tools'
import { useLibrarySources, useScanProgress } from '@/store/library/hook'
import { startSourceScan } from '@/core/library/sync'
import { deleteSource, setSourceEnabled, relinkSource } from '@/core/library/sources/local'
import { restoreRemoved } from '@/core/library/actions'
import type { LibrarySource } from '@/core/library/types'

export interface SourceManageModalType {
  show: () => void
}

const STATE_KEYS: Record<LibrarySource['state'], 'library_source_state_ok' | 'library_source_state_needs_reauth' | 'library_source_state_unreachable' | 'library_source_state_scanning'> = {
  ok: 'library_source_state_ok',
  needs_reauth: 'library_source_state_needs_reauth',
  unreachable: 'library_source_state_unreachable',
  scanning: 'library_source_state_scanning',
}

export default forwardRef<SourceManageModalType, {}>((_props, ref) => {
  const t = useI18n()
  const theme = useTheme()
  const alertRef = useRef<ConfirmAlertType>(null)
  const [visible, setVisible] = useState(false)
  const sources = useLibrarySources()
  const scanProgress = useScanProgress()

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

  const handleScan = (source: LibrarySource) => {
    void startSourceScan(source.id).then(started => {
      if (!started) void confirmDialog({ message: t('library_scan_busy') }).catch(() => {})
    })
  }

  const handleDelete = async(source: LibrarySource) => {
    const confirmed = await confirmDialog({
      message: `${source.name} - ${t('library_source_delete_tip')}`,
      confirmButtonText: t('delete'),
    })
    if (!confirmed) return
    await deleteSource(source.id)
  }

  const handleToggleEnabled = async(source: LibrarySource) => {
    await setSourceEnabled(source, !source.enabled)
  }

  const handleRelink = (source: LibrarySource) => {
    void relinkSource(source.id)
  }

  const handleRestore = (source: LibrarySource) => {
    void restoreRemoved(source.id)
  }

  const renderItem = ({ item }: { item: LibrarySource }) => {
    const progress = scanProgress[item.id]
    const stateLabel = progress ? t('library_source_state_scanning') : t(STATE_KEYS[item.state])
    return (
      <View style={styles.sourceItem}>
        <View style={styles.sourceInfo}>
          <Text numberOfLines={1} size={14}>{item.name}</Text>
          <Text numberOfLines={1} size={11} color={theme['c-font-label']}>
            {item.type} · {stateLabel}
            {progress ? ` (${progress.scanned})` : ''}
          </Text>
        </View>
        <View style={styles.sourceActions}>
          <Button style={styles.actionBtn} onPress={() => { handleScan(item) }}>
            <Text size={12} color={theme['c-primary-font']}>{t('library_scan')}</Text>
          </Button>
          {item.type === 'local'
            ? (
                <Button style={styles.actionBtn} onPress={() => { handleRelink(item) }}>
                  <Text size={12} color={theme['c-font']}>{t('library_source_relink')}</Text>
                </Button>
              )
            : null}
          <Button style={styles.actionBtn} onPress={() => { void handleToggleEnabled(item) }}>
            <Text size={12} color={theme['c-font']}>{item.enabled ? t('library_source_disable') : t('library_source_enable')}</Text>
          </Button>
          <Button style={styles.actionBtn} onPress={() => { handleRestore(item) }}>
            <Text size={12} color={theme['c-font']}>{t('library_restore_removed')}</Text>
          </Button>
          <Button style={styles.actionBtn} onPress={() => { void handleDelete(item) }}>
            <Text size={12} color="#f24a4a">{t('delete')}</Text>
          </Button>
        </View>
      </View>
    )
  }

  return (
    visible
      ? (
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
    paddingBottom: 8,
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
})
