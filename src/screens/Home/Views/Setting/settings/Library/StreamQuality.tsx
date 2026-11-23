import { memo, useMemo } from 'react'

import { StyleSheet, View } from 'react-native'

import SubTitle from '../../components/SubTitle'
import CheckBox from '@/components/common/CheckBox'
import { useSettingValue } from '@/store/setting/hook'
import { updateSetting } from '@/core/common'
import { useI18n } from '@/lang'

const QUALITYS = ['raw', '320', '192', '128'] as const
type Quality = typeof QUALITYS[number]

// 音质按网络类型分设（对齐参照基线：WiFi 与移动网络各自独立）
const WifiItem = ({ id }: { id: Quality }) => {
  const q = useSettingValue('library.streamQualityWifi')
  const isActive = q == id
  return <CheckBox marginRight={8} check={isActive} label={id} onChange={() => { updateSetting({ 'library.streamQualityWifi': id }) }} need />
}

const CellularItem = ({ id }: { id: Quality }) => {
  const q = useSettingValue('library.streamQualityCellular')
  const isActive = q == id
  return <CheckBox marginRight={8} check={isActive} label={id} onChange={() => { updateSetting({ 'library.streamQualityCellular': id }) }} need />
}

export default memo(() => {
  const t = useI18n()
  const list = useMemo(() => [...QUALITYS], [])

  return (
    <>
      <SubTitle title={t('setting_library_stream_quality_wifi')}>
        <View style={styles.list}>
          {list.map(q => <WifiItem id={q} key={q} />)}
        </View>
      </SubTitle>
      <SubTitle title={t('setting_library_stream_quality_cellular')}>
        <View style={styles.list}>
          {list.map(q => <CellularItem id={q} key={q} />)}
        </View>
      </SubTitle>
    </>
  )
})

const styles = StyleSheet.create({
  list: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
})
