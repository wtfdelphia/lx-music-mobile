import { memo } from 'react'

import CheckBoxItem from '../../components/CheckBoxItem'
import { useSettingValue } from '@/store/setting/hook'
import { useI18n } from '@/lang'
import { updateSetting } from '@/core/common'
import { getData, saveData } from '@/plugins/storage'
import { confirmDialog } from '@/utils/tools'

const downloadAgreedKey = '@download_agree_tip'

/**
 * 下载总开关（§10.5、§12）。首次开启弹出合规提示，
 * 用户确认后才置位；关闭语义由 `core/download` 冻结任务（§7.7）
 */
export default memo(() => {
  const t = useI18n()
  const enable = useSettingValue('download.enable')

  const handleChange = (check: boolean) => {
    if (!check) {
      updateSetting({ 'download.enable': false })
      return
    }
    void getData<boolean>(downloadAgreedKey).then(async(agreed) => {
      if (!agreed) {
        const confirmed = await confirmDialog({
          message: t('download_enable_confirm_tip'),
          confirmButtonText: t('download_enable_confirm_btn'),
        })
        if (!confirmed) return
        await saveData(downloadAgreedKey, true)
      }
      updateSetting({ 'download.enable': true })
    })
  }

  return <CheckBoxItem check={enable} label={t('setting_download_enable')} onChange={handleChange} />
})
