import { memo } from 'react'

import CheckBoxItem from '../../components/CheckBoxItem'
import { useSettingValue } from '@/store/setting/hook'
import { useI18n } from '@/lang'
import { updateSetting } from '@/core/common'

export default memo(() => {
  const t = useI18n()
  const scrobble = useSettingValue('library.scrobble')

  return <CheckBoxItem check={scrobble} label={t('setting_library_scrobble')} onChange={(check) => { updateSetting({ 'library.scrobble': check }) }} />
})
