import { getMusicUrl } from '@/core/music/online'
import settingState from '@/store/setting/state'

/**
 * 取链接与刷新链接（桌面版 `store/download/action.ts` 两段式 `getUrl`）。
 * 直接调 `core/music/online.ts`，**不经过本地优先**，因此永远拿到网络链接
 * （§7.3、§9）。
 */

/**
 * 两段式取链接：优先切源记录（`toggleMusicInfo`），失败后按
 * `download.isUseOtherSource` 决定是否允许跨源（§7.3）
 */
export const getUrl = async(downloadInfo: LX.Download.ListItem, isRefresh = false): Promise<string> => {
  const quality = downloadInfo.metadata.quality
  const toggleMusicInfo = downloadInfo.metadata.musicInfo.meta.toggleMusicInfo
  const isUseOtherSource = settingState.setting['download.isUseOtherSource']
  // eslint-disable-next-line @typescript-eslint/promise-function-async
  return (toggleMusicInfo ? getMusicUrl({
    musicInfo: toggleMusicInfo,
    quality,
    isRefresh,
    allowToggleSource: false,
  }) : Promise.reject(new Error('not found'))).catch(async() => {
    return getMusicUrl({
      musicInfo: downloadInfo.metadata.musicInfo,
      quality,
      isRefresh,
      allowToggleSource: isUseOtherSource,
    })
  }).catch(() => '')
}

/**
 * 刷新链接（失败重试上限由调度层计数，§7.4）
 */
export const refreshUrl = async(downloadInfo: LX.Download.ListItem): Promise<string> => {
  return getUrl(downloadInfo, true)
}
