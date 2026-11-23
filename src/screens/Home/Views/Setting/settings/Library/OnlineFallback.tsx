import { memo } from 'react'

import CheckBoxItem from '../../components/CheckBoxItem'
import { useSettingValue } from '@/store/setting/hook'
import { useI18n } from '@/lang'
import { updateSetting } from '@/core/common'

export default memo(() => {
  const t = useI18n()
  const fallback = useSettingValue('library.onlineFallback')

  return <CheckBoxItem check={fallback} label={t('setting_library_online_fallback')} onChange={(check) => { updateSetting({ 'library.onlineFallback': check }) }} />
})
