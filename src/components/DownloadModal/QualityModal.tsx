import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { View, TouchableHighlight } from 'react-native'
import Dialog, { type DialogType } from '@/components/common/Dialog'
import Text from '@/components/common/Text'
import { useI18n } from '@/lang'
import { useTheme } from '@/store/theme/hook'
import { createStyle } from '@/utils/tools'

const QUALITY_LABELS: Record<LX.Quality, string | null> = {
  '128k': 'download__normal',
  '192k': null,
  '320k': 'download__high_quality',
  flac: 'download__lossless',
  flac24bit: 'FLAC Hires',
  wav: 'WAV',
  ape: 'APE',
}

const qualityLabel = (quality: LX.Quality): string => {
  const key = QUALITY_LABELS[quality]
  if (key === null) return quality.toUpperCase()
  if (key.startsWith('download__')) return global.i18n.t(key as Parameters<typeof global.i18n.t>[0])
  return key
}

/**
 * 音源常不返回真实文件大小（size 为 "0" / "0B" / "" 等）。
 * 大小解析为 0 或为空时返回空串，避免显示误导性的 "0B"。
 * 真实大小形如 "3.56M"，parseFloat 取其数值部分判断。
 */
const formatSize = (size: string | null): string => {
  if (!size) return ''
  const num = parseFloat(size)
  if (!num || Number.isNaN(num)) return ''
  return size.toUpperCase()
}

export interface QualitySelectInfo {
  title: string
  qualitys: Array<{ type: LX.Quality, size: string | null }>
}
const initSelectInfo: QualitySelectInfo = { title: '', qualitys: [] }

export interface QualityModalProps {
  onSelect: (quality: LX.Quality) => void
}
export interface QualityModalType {
  show: (info: QualitySelectInfo) => void
}

export default forwardRef<QualityModalType, QualityModalProps>(({ onSelect }, ref) => {
  const t = useI18n()
  const theme = useTheme()
  const dialogRef = useRef<DialogType>(null)
  const [selectInfo, setSelectInfo] = useState<QualitySelectInfo>(initSelectInfo)

  useImperativeHandle(ref, () => ({
    show(info) {
      setSelectInfo(info)
      requestAnimationFrame(() => {
        dialogRef.current?.setVisible(true)
      })
    },
  }))

  const handleSelect = (quality: LX.Quality) => {
    dialogRef.current?.setVisible(false)
    onSelect(quality)
  }

  const title = useMemo(() => {
    if (selectInfo.qualitys.length) return `${selectInfo.title} · ${t('download__quality')}`
    return t('download__not_available_tip')
  }, [selectInfo, t])

  return (
    <Dialog ref={dialogRef} title={title} onHide={() => { setSelectInfo(initSelectInfo) }}>
      <View style={styles.content}>
        {
          selectInfo.qualitys.length
            ? selectInfo.qualitys.map(({ type, size }) => (
              <TouchableHighlight
                key={type}
                underlayColor={theme['c-primary-background-hover']}
                style={styles.btn}
                onPress={() => { handleSelect(type) }}
              >
                <Text color={theme['c-primary-font']} size={14}>
                  {qualityLabel(type)}{formatSize(size) ? ` · ${formatSize(size)}` : ''}
                </Text>
              </TouchableHighlight>
            ))
            : null
        }
      </View>
    </Dialog>
  )
})

const styles = createStyle({
  content: {
    flexGrow: 0,
    flexShrink: 1,
    paddingTop: 5,
    paddingBottom: 10,
  },
  btn: {
    paddingLeft: 15,
    paddingRight: 15,
    paddingTop: 12,
    paddingBottom: 12,
    alignItems: 'center',
  },
})
