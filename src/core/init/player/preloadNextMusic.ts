import { getMusicUrl } from '@/core/music'
import { getNextPlayMusicInfo, resetRandomNextMusicInfo } from '@/core/player/player'
import { checkUrl } from '@/utils/request'
import playerState from '@/store/player/state'
import { isCached } from '@/plugins/player/utils'


const preloadMusicInfo = {
  isLoading: false,
  preProgress: 0,
  info: null as LX.Player.PlayMusicInfo | null,
}
const resetPreloadInfo = () => {
  preloadMusicInfo.preProgress = 0
  preloadMusicInfo.info = null
  preloadMusicInfo.isLoading = false
}
// 预载是纯优化旁路：拿不到就下一首现取，慢一点也不该拖累当前播放。
// 但 getMusicUrl 会串行试换源、checkUrl 默认 15s，源不可达时单轮能挂几十秒，
// 期间 RN 桥被这些请求占住，前台的播放/切歌调用跟着变慢（CI run
// 33842498724 是这条链的实证）。故给整轮预载封一个硬超时短路
const PRELOAD_TIMEOUT = 10_000
const withTimeout = async<T>(task: Promise<T>, ms: number) => {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      task,
      new Promise<null>((resolve) => { timer = setTimeout(() => { resolve(null) }, ms) }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const doPreload = async() => {
  const info = await getNextPlayMusicInfo()
  if (!info) return
  preloadMusicInfo.info = info
  const url = await getMusicUrl({ musicInfo: info.musicInfo }).catch(() => '')
  if (!url) return
  console.log('preload url', url)
  const [cached, available] = await Promise.all([
    isCached(url),
    checkUrl(url, { timeout: PRELOAD_TIMEOUT }).then(() => true).catch(() => { return false }),
  ])
  if (!cached && !available) {
    const url = await getMusicUrl({ musicInfo: info.musicInfo, isRefresh: true }).catch(() => '')
    console.log('preload url refresh', url)
  }
}

const preloadNextMusicUrl = async(curTime: number) => {
  if (preloadMusicInfo.isLoading || curTime - preloadMusicInfo.preProgress < 3) return
  preloadMusicInfo.isLoading = true
  console.log('preload next music url')
  try {
    await withTimeout(doPreload(), PRELOAD_TIMEOUT)
  } catch { /* 预载失败不影响当前播放 */ }
  preloadMusicInfo.isLoading = false
}

export default () => {
  const setProgress = (time: number) => {
    if (!playerState.musicInfo.id) return
    preloadMusicInfo.preProgress = time
  }

  const handleSetPlayInfo = () => {
    resetPreloadInfo()
  }

  const handleConfigUpdated: typeof global.state_event.configUpdated = (keys, settings) => {
    if (!keys.includes('player.togglePlayMethod')) return
    if (!preloadMusicInfo.info || preloadMusicInfo.info.isTempPlay) return
    resetRandomNextMusicInfo()
    preloadMusicInfo.info = null
    preloadMusicInfo.preProgress = playerState.progress.nowPlayTime
  }

  const handlePlayProgressChanged: typeof global.state_event.playProgressChanged = (progress) => {
    // CI 自测下彻底关掉预载：夹具是本地文件，预载没有验证价值，
    // 但它取的是在线源，会把外网请求灌进自测时间预算
    if (global.lx.isCiSelfTest) return
    const duration = progress.maxPlayTime
    if (duration > 10 && duration - progress.nowPlayTime < 10 && !preloadMusicInfo.info) {
      void preloadNextMusicUrl(progress.nowPlayTime)
    }
  }

  global.app_event.on('setProgress', setProgress)
  global.app_event.on('musicToggled', handleSetPlayInfo)
  global.state_event.on('configUpdated', handleConfigUpdated)
  global.state_event.on('playProgressChanged', handlePlayProgressChanged)
}
