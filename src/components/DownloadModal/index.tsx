import { useRef, useImperativeHandle, forwardRef, useState } from 'react'
import QualityModal, { type QualityModalType, type QualitySelectInfo } from './QualityModal'
import { createDownloadTasks } from '@/core/download'
import { toast } from '@/utils/tools'

/**
 * 下载入口弹窗（§10.3）。
 * 单曲：列出 `meta.qualitys` ∩ `qualityList[source]` 的交集，附大小。
 * 批量：固定四档 128K / 320K / FLAC / FLAC Hires，逐首降级。
 */

export interface DownloadSelectInfo {
  musicInfo: LX.Music.MusicInfoOnline | null
  selectedList: LX.Music.MusicInfoOnline[]
  listId?: string
}
const initSelectInfo: DownloadSelectInfo = { musicInfo: null, selectedList: [] }

export interface DownloadModalType {
  show: (info: DownloadSelectInfo) => void
}

/** 批量下载的固定档位（§10.3） */
const MULTIPLE_QUALITYS: Array<{ type: LX.Quality, size: string | null }> = [
  { type: '128k', size: null },
  { type: '320k', size: null },
  { type: 'flac', size: null },
  { type: 'flac24bit', size: null },
]

export default forwardRef<DownloadModalType, {}>((props, ref) => {
  const qualityModalRef = useRef<QualityModalType>(null)
  const [selectInfo, setSelectInfo] = useState<DownloadSelectInfo>(initSelectInfo)

  useImperativeHandle(ref, () => ({
    show(info) {
      setSelectInfo(info)
      const isMulti = info.selectedList.length > 1
      const qualitySelect: QualitySelectInfo = isMulti
        ? {
            title: global.i18n.t('download__multiple_tip', { len: info.selectedList.length }),
            qualitys: MULTIPLE_QUALITYS,
          }
        : {
            title: `${info.musicInfo?.name ?? ''} - ${info.musicInfo?.singer ?? ''}`,
            qualitys: buildSingleQualitys(info.musicInfo),
          }
      requestAnimationFrame(() => {
        qualityModalRef.current?.show(qualitySelect)
      })
    },
  }))

  const buildSingleQualitys = (musicInfo: LX.Music.MusicInfoOnline | null): Array<{ type: LX.Quality, size: string | null }> => {
    if (!musicInfo) return []
    const sourceQualitys = global.lx.qualityList[musicInfo.source] ?? []
    // meta.qualitys 是该歌曲实际拥有的音质；与当前源支持的列表求交集
    const owned = musicInfo.meta.qualitys ?? []
    const available = owned.filter(q => sourceQualitys.includes(q.type))
    return available.map(q => ({ type: q.type, size: q.size }))
  }

  const handleSelect = (quality: LX.Quality) => {
    const list = selectInfo.selectedList.length > 1
      ? selectInfo.selectedList
      : (selectInfo.musicInfo ? [selectInfo.musicInfo] : [])
    const count = createDownloadTasks(list, quality, selectInfo.listId)
    if (count > 0) {
      toast(global.i18n.t('download__start_tip', { num: count }))
    } else {
      toast(global.i18n.t('download__duplicate_tip'))
    }
    setSelectInfo(initSelectInfo)
  }

  return (
    <QualityModal ref={qualityModalRef} onSelect={handleSelect} />
  )
})
