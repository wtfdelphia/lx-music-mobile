import { memo } from 'react'

import CheckBoxItem from '../../components/CheckBoxItem'
import { useSettingValue } from '@/store/setting/hook'
import { useI18n } from '@/lang'
import { updateSetting } from '@/core/common'

export default memo(() => {
  const t = useI18n()
  const autoResume = useSettingValue('download.autoResume')

  return <CheckBoxItem check={autoResume} label={t('setting_download_auto_resume')} onChange={(check) => { updateSetting({ 'download.autoResume': check }) }} />
})
