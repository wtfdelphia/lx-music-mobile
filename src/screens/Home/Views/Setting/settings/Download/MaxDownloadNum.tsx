import { memo } from 'react'

import { StyleSheet, View } from 'react-native'

import SubTitle from '../../components/SubTitle'
import CheckBox from '@/components/common/CheckBox'
import { useSettingValue } from '@/store/setting/hook'
import { useI18n } from '@/lang'
import { updateSetting } from '@/core/common'

const useActive = (id: number) => {
  const maxDownloadNum = useSettingValue('download.maxDownloadNum')
  return maxDownloadNum === id
}

const Item = ({ id }: {
  id: number
}) => {
  const isActive = useActive(id)
  return <CheckBox marginRight={8} check={isActive} label={String(id)} onChange={() => { updateSetting({ 'download.maxDownloadNum': id as LX.AppSetting['download.maxDownloadNum'] }) }} need />
}

export default memo(() => {
  const t = useI18n()

  return (
    <SubTitle title={t('setting_download_max_num')}>
      <View style={styles.list}>
        <Item id={1} />
        <Item id={2} />
        <Item id={3} />
      </View>
    </SubTitle>
  )
})

const styles = StyleSheet.create({
  list: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
})
