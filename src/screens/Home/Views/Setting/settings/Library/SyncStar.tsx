import { memo } from 'react'

import CheckBoxItem from '../../components/CheckBoxItem'
import { useSettingValue } from '@/store/setting/hook'
import { useI18n } from '@/lang'
import { updateSetting } from '@/core/common'

export default memo(() => {
  const t = useI18n()
  const syncStar = useSettingValue('library.syncStar')

  return <CheckBoxItem check={syncStar} label={t('setting_library_sync_star')} onChange={(check) => { updateSetting({ 'library.syncStar': check }) }} />
})
