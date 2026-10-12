import { memo } from 'react'

import CheckBoxItem from '../../components/CheckBoxItem'
import { useSettingValue } from '@/store/setting/hook'
import { useI18n } from '@/lang'
import { updateSetting } from '@/core/common'

export default memo(() => {
  const t = useI18n()
  const isSavePathGroupByListName = useSettingValue('download.isSavePathGroupByListName')

  return <CheckBoxItem check={isSavePathGroupByListName} label={t('setting_download_save_group_list_name')} onChange={(check) => { updateSetting({ 'download.isSavePathGroupByListName': check }) }} />
})
