import { memo, useMemo } from 'react'

import { StyleSheet, View } from 'react-native'

import SubTitle from '../../components/SubTitle'
import CheckBox from '@/components/common/CheckBox'
import { useSettingValue } from '@/store/setting/hook'
import { updateSetting } from '@/core/common'
import { useI18n } from '@/lang'

const QUALITYS = ['raw', '320', '192', '128'] as const
type Quality = typeof QUALITYS[number]

const Item = ({ id, name }: { id: Quality, name: string }) => {
  const q = useSettingValue('library.streamQuality')
  const isActive = q == id
  return <CheckBox marginRight={8} check={isActive} label={name} onChange={() => { updateSetting({ 'library.streamQuality': id }) }} need />
}

export default memo(() => {
  const t = useI18n()
  const list = useMemo(() => [...QUALITYS], [])

  return (
    <SubTitle title={t('setting_library_stream_quality')}>
      <View style={styles.list}>
        {list.map(q => <Item name={q} id={q} key={q} />)}
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
