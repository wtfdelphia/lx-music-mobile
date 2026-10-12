import { memo } from 'react'

import CheckBoxItem from '../../components/CheckBoxItem'
import { useSettingValue } from '@/store/setting/hook'
import { useI18n } from '@/lang'
import { updateSetting } from '@/core/common'

export default memo(() => {
  const t = useI18n()
  const enable = useSettingValue('library.enable')

  return <CheckBoxItem check={enable} label={t('setting_library_enable')} onChange={(check) => { updateSetting({ 'library.enable': check }) }} />
})
