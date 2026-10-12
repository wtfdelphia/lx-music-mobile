import { memo } from 'react'

import CheckBoxItem from '../../components/CheckBoxItem'
import { useSettingValue } from '@/store/setting/hook'
import { useI18n } from '@/lang'
import { updateSetting } from '@/core/common'

export default memo(() => {
  const t = useI18n()
  const allow = useSettingValue('library.allowCellularStream')

  return <CheckBoxItem check={allow} label={t('setting_library_allow_cellular_stream')} onChange={(check) => { updateSetting({ 'library.allowCellularStream': check }) }} />
})
