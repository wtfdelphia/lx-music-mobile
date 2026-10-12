import { memo } from 'react'

import { View } from 'react-native'
import Button from '@/components/common/Button'
import Text from '@/components/common/Text'
import { useI18n } from '@/lang'
import { useTheme } from '@/store/theme/hook'
import { confirmDialog, createStyle } from '@/utils/tools'
import { useDownloadList } from '@/store/download/hook'
import { removeTasks } from '@/core/download'

/**
 * 清除全部下载（含文件），只读区操作项（§10.5）
 */
export default memo(() => {
  const t = useI18n()
  const theme = useTheme()
  const downloadList = useDownloadList()

  const handleClear = () => {
    if (!downloadList.length) return
    void confirmDialog({
      message: t('download_clear_all_tip', { num: downloadList.length }),
      confirmButtonText: t('download_clear_all'),
    }).then(async(isClear) => {
      if (!isClear) return
      await removeTasks([...downloadList], true)
    })
  }

  return (
    <View style={styles.container}>
      <Text size={13} color={theme['c-font-label']}>{t('download_total_tasks', { num: downloadList.length })}</Text>
      <Button style={styles.btn} disabled={!downloadList.length} onPress={() => { handleClear() }}>
        <Text size={13} color={downloadList.length ? theme['c-font'] : theme['c-font-label']}>{t('download_clear_all')}</Text>
      </Button>
    </View>
  )
})

const styles = createStyle({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 25,
    paddingRight: 10,
    paddingTop: 6,
    paddingBottom: 6,
  },
  btn: {
    paddingLeft: 10,
    paddingRight: 10,
    paddingTop: 6,
    paddingBottom: 6,
    borderRadius: 4,
  },
})
