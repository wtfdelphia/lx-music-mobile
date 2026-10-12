import { memo } from 'react'

import { View, StyleSheet } from 'react-native'

import SubTitle from '../../components/SubTitle'
import CheckBox from '@/components/common/CheckBox'
import { useSettingValue } from '@/store/setting/hook'
import { useI18n } from '@/lang'
import { updateSetting } from '@/core/common'

type FileNameType = LX.AppSetting['download.fileName']

const useActive = (id: FileNameType) => {
  const fileName = useSettingValue('download.fileName')
  return fileName === id
}

const Item = ({ id, name }: {
  id: FileNameType
  name: string
}) => {
  const isActive = useActive(id)
  return <CheckBox marginRight={8} check={isActive} label={name} onChange={() => { updateSetting({ 'download.fileName': id }) }} need />
}

export default memo(() => {
  const t = useI18n()

  return (
    <SubTitle title={t('setting_download_name')}>
      <View style={styles.list}>
        <Item id="歌名 - 歌手" name={t('setting_download_name1')} />
        <Item id="歌手 - 歌名" name={t('setting_download_name2')} />
        <Item id="歌名" name={t('setting_download_name3')} />
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
