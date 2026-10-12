import { memo } from 'react'

import Section from '../../components/Section'
import IsEnable from './IsEnable'
import ScanOnLaunch from './ScanOnLaunch'
import StreamQuality from './StreamQuality'
import AllowCellularStream from './AllowCellularStream'
import DownloadQuality from './DownloadQuality'
import OnlineFallback from './OnlineFallback'
import Scrobble from './Scrobble'
import SyncStar from './SyncStar'
import AutoAssociate from './AutoAssociate'
import { useI18n } from '@/lang'

/**
 * 设置 → 本地曲库（add-ios-local-library §14.6）
 */
export default memo(() => {
  const t = useI18n()

  return (
    <Section title={t('setting_library')}>
      <IsEnable />
      <ScanOnLaunch />
      <StreamQuality />
      <AllowCellularStream />
      <DownloadQuality />
      <OnlineFallback />
      <Scrobble />
      <SyncStar />
      <AutoAssociate />
    </Section>
  )
})
