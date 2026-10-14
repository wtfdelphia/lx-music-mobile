import { memo, useCallback, useEffect, useState } from 'react'

import { View } from 'react-native'

import SubTitle from '../../components/SubTitle'
import Button from '@/components/common/Button'
import Text from '@/components/common/Text'
import * as native from '@/core/library/native'
import { toast, createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * 空间管理（P1 缺口）：封面缓存占用展示与清理。
 * 非 iOS 平台原生封装返回 reject，静默显示 0
 */
export default memo(() => {
  const t = useI18n()
  const theme = useTheme()
  const [size, setSize] = useState<number | null>(null)
  const [clearing, setClearing] = useState(false)

  const refresh = useCallback(() => {
    void native.artworkCacheSize().then(setSize).catch(() => { setSize(0) })
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const handleClear = useCallback(() => {
    if (clearing) return
    setClearing(true)
    void native.clearArtworkCache().then(() => {
      toast(t('setting_library_clear_cache_done'), 'short')
      refresh()
    }).catch(() => {}).finally(() => { setClearing(false) })
  }, [clearing, refresh, t])

  return (
    <SubTitle title={t('setting_library_space')}>
      <View style={styles.row}>
        <Text size={13} color={theme['c-font-label']}>
          {t('setting_library_artwork_cache_size')}: {size == null ? '…' : formatSize(size)}
        </Text>
        <Button style={styles.clearBtn} disabled={clearing || !size} onPress={handleClear}>
          <Text size={12} color={theme['c-primary-font']}>{t('setting_library_clear_cache')}</Text>
        </Button>
      </View>
    </SubTitle>
  )
})

const styles = createStyle({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  clearBtn: {
    paddingLeft: 10,
    paddingRight: 10,
    paddingTop: 5,
    paddingBottom: 5,
  },
})
