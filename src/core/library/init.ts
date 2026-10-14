/**
 * 曲库初始化（add-ios-local-library §6、§11.7）。
 * 依赖两个前置：`initDownload` 完成（下载列表已加载）与
 * `dataInit` 完成（存储就绪）。仅 iOS 有效；非 iOS 平台
 * 原生封装一律 reject，此处用平台门控直接跳过
 */
import { Platform } from 'react-native'
import { refreshSources, startSourceScan } from './sync'
import { setInited } from '@/store/library/action'
import { initAssociate } from './associate'
import { subscribePlayTracking } from './playTracker'
import state from '@/store/library/state'
import settingState from '@/store/setting/state'
import { log } from '@/utils/log'

/** 启动时增量扫描的延迟（§14.6 `library.scanOnLaunch`） */
const SCAN_ON_LAUNCH_DELAY_MS = 10_000

const scanOnLaunch = () => {
  setTimeout(() => {
    for (const source of state.sources) {
      if (source.enabled && source.type === 'local') void startSourceScan(source.id)
    }
  }, SCAN_ON_LAUNCH_DELAY_MS)
}

/**
 * 初始化。须在 `initDownload` 之后调用（§11.7 双依赖）。
 * 失败不阻断启动：曲库不可用时其余功能照常
 */
export const initLibrary = async(): Promise<void> => {
  if (Platform.OS !== 'ios') return
  try {
    await refreshSources()
    // S2：首次对账不阻塞启动链。对账只影响曲库页可见性，
    // 不影响首页渲染与播放；内部自持节流与错误吞并
    initAssociate()
    subscribePlayTracking()
    setInited(true)
    if (settingState.setting['library.scanOnLaunch']) scanOnLaunch()
  } catch (err) {
    log.error('[library] init failed: ' + String(err))
  }
}
