import { memo } from 'react'

import CheckBoxItem from '../../components/CheckBoxItem'
import { useSettingValue } from '@/store/setting/hook'
import { useI18n } from '@/lang'
import { updateSetting } from '@/core/common'

export default memo(() => {
  const t = useI18n()
  const autoAssociate = useSettingValue('library.autoAssociateDownloads')

  return <CheckBoxItem check={autoAssociate} label={t('setting_library_auto_associate')} onChange={(check) => { updateSetting({ 'library.autoAssociateDownloads': check }) }} />
})
