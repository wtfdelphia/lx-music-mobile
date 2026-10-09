import { memo } from 'react'

import CheckBoxItem from '../../components/CheckBoxItem'
import { useSettingValue } from '@/store/setting/hook'
import { useI18n } from '@/lang'
import { updateSetting } from '@/core/common'

export default memo(() => {
  const t = useI18n()
  const allowsCellular = useSettingValue('download.allowsCellular')

  return <CheckBoxItem check={allowsCellular} label={t('setting_download_allows_cellular')} onChange={(check) => { updateSetting({ 'download.allowsCellular': check }) }} />
})
