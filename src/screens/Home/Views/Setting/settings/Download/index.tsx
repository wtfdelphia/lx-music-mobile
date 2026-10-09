import { memo } from 'react'

import Section from '../../components/Section'
import IsEnable from './IsEnable'
import MaxDownloadNum from './MaxDownloadNum'
import FileName from './FileName'
import IsSavePathGroupByListName from './IsSavePathGroupByListName'
import SkipExistFile from './SkipExistFile'
import IsUseOtherSource from './IsUseOtherSource'
import IsDownloadLrc from './IsDownloadLrc'
import AllowsCellular from './AllowsCellular'
import AutoResume from './AutoResume'
import ClearAll from './ClearAll'
import { useI18n } from '@/lang'

/**
 * 设置 → 下载（§10.5）
 */
export default memo(() => {
  const t = useI18n()

  return (
    <Section title={t('setting_download')}>
      <IsEnable />
      <MaxDownloadNum />
      <FileName />
      <IsSavePathGroupByListName />
      <SkipExistFile />
      <IsUseOtherSource />
      <IsDownloadLrc />
      <AllowsCellular />
      <AutoResume />
      <ClearAll />
    </Section>
  )
})
