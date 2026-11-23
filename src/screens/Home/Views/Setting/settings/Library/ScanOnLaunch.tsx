import { memo } from 'react'

import CheckBoxItem from '../../components/CheckBoxItem'
import { useSettingValue } from '@/store/setting/hook'
import { useI18n } from '@/lang'
import { updateSetting } from '@/core/common'

export default memo(() => {
  const t = useI18n()
  const scanOnLaunch = useSettingValue('library.scanOnLaunch')

  return <CheckBoxItem check={scanOnLaunch} label={t('setting_library_scan_on_launch')} onChange={(check) => { updateSetting({ 'library.scanOnLaunch': check }) }} />
})
