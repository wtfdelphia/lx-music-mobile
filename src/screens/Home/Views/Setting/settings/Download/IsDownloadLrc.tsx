import { memo } from 'react'

import { View } from 'react-native'

import CheckBoxItem from '../../components/CheckBoxItem'
import CheckBox from '@/components/common/CheckBox'
import { useSettingValue } from '@/store/setting/hook'
import { useI18n } from '@/lang'
import { updateSetting } from '@/core/common'
import { createStyle } from '@/utils/tools'

export default memo(() => {
  const t = useI18n()
  const isDownloadLrc = useSettingValue('download.isDownloadLrc')
  const isDownloadLxLrc = useSettingValue('download.isDownloadLxLrc')
  const isDownloadTLrc = useSettingValue('download.isDownloadTLrc')
  const isDownloadRLrc = useSettingValue('download.isDownloadRLrc')

  return (
    <>
      <CheckBoxItem check={isDownloadLrc} label={t('setting_download_is_download_lrc')} onChange={(check) => { updateSetting({ 'download.isDownloadLrc': check }) }} />
      <View style={styles.subItem}>
        <CheckBox marginRight={8} check={isDownloadLxLrc} disabled={!isDownloadLrc} label={t('setting_download_lx_lrc')} onChange={(check) => { updateSetting({ 'download.isDownloadLxLrc': check }) }} />
        <CheckBox marginRight={8} check={isDownloadTLrc} disabled={!isDownloadLrc} label={t('setting_download_t_lrc')} onChange={(check) => { updateSetting({ 'download.isDownloadTLrc': check }) }} />
        <CheckBox marginRight={8} check={isDownloadRLrc} disabled={!isDownloadLrc} label={t('setting_download_r_lrc')} onChange={(check) => { updateSetting({ 'download.isDownloadRLrc': check }) }} />
      </View>
    </>
  )
})

const styles = createStyle({
  subItem: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingLeft: 25,
    paddingTop: 4,
    paddingBottom: 8,
  },
})
