import { memo } from 'react'

import CheckBoxItem from '../../components/CheckBoxItem'
import { useSettingValue } from '@/store/setting/hook'
import { useI18n } from '@/lang'
import { updateSetting } from '@/core/common'

export default memo(() => {
  const t = useI18n()
  const skipExistFile = useSettingValue('download.skipExistFile')

  return <CheckBoxItem check={skipExistFile} label={t('setting_download_skip_exist_file')} onChange={(check) => { updateSetting({ 'download.skipExistFile': check }) }} />
})
