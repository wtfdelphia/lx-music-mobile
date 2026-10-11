import settingState from '@/store/setting/state'
import { downloadEngine, type EngineLiveEvent } from './engine'
import { getUrl, refreshUrl } from './urlResolver'
import { buildSavePath } from './utils'
import { resolveDownloadPath } from './path'
import { stat, unlink } from '@/utils/fs'
import { AppState } from 'react-native'
import { saveLrc } from './lrc'
import { addToIndex, removeFromIndex, rebuildIndex } from './downloadIndex'
import { getDownloadList, updateDownloadTask, flushForAck } from '@/store/download/action'

/**
 * 队列调度（§7.2）：并发补位、重试、刷新链接、完成收尾。
 * 引擎事件统一从 `handleEngineEvent` 进入；进度节流由原生 500ms 保证
 */

const runningTask = new Map<string, LX.Download.ListItem>()
const tryNum = new Map<string, number>()
const refreshNum = new Map<string, number>()
/** 主动取消标记：区分系统取消（§4.4） */
const jsCancelled = new Set<string>()
/** 速度计算滑动窗口 */
const speedBase = new Map<string, { bytes: number, time: number }>()
/** 已处理事件的最大 seq，ack 单调递增（§4.6） */
let lastAckSeq = 0
/** 对齐单飞锁：init 与 AppState 回前台可能并发触发（审计#2） */
let aligning: Promise<void> | null = null
/** 回放模式：此期间非终态错误只置暂停、保留续传，不发起重试（审计#3） */
let replaying = false
/** 初始化完成标记：完成前 AppState 监听直接 return，
 *  避免空列表上 adopt 把存活任务当无主任务取消（修 I） */
let initialized = false
/** 后台唤醒冷启动时暂存的 autoResume 意图，第一次回前台时执行（修 J） */
let pendingAutoResume = false

const t = (key: Parameters<typeof global.i18n.t>[0]) => global.i18n.t(key)

const clearTaskMaps = (id: string) => {
  runningTask.delete(id)
  tryNum.delete(id)
  refreshNum.delete(id)
  speedBase.delete(id)
}

/**
 * 补位入口：`enable` 关闭或运行满并发时返回；否则取队首 `waiting` 启动（§7.2）
 */
export const checkStartTask = () => {
  if (!settingState.setting['download.enable']) return
  // 循环补满并发槽（对齐桌面版 while(result)）：单次只启动一个时，
  // maxDownloadNum>1 也只跑 1 个，要等前一个完成才补下一个。
  // 注意只能 void 不能 await：startTask 在首个 await 前已同步完成
  // runningTask.set 与状态置 run，循环内计数才是准确的；若 await
  // 要等上一首取完链接才轮到下一首
  while (runningTask.size < settingState.setting['download.maxDownloadNum']) {
    const next = getDownloadList().find(task => task.status === 'waiting')
    if (!next) break
    void startTask(next)
  }
}

const startTask = async(downloadInfo: LX.Download.ListItem) => {
  downloadInfo.status = 'run'
  downloadInfo.statusText = t('download___status_running')
  runningTask.set(downloadInfo.id, downloadInfo)
  tryNum.set(downloadInfo.id, 0)
  updateDownloadTask()
  await handleStartTask(downloadInfo)
}

const engineStart = async(downloadInfo: LX.Download.ListItem) => {
  // 状态校验（审计#3）：异步排队的启动若到达时任务已被重置为
  // 暂停，不再发起下载
  if (downloadInfo.status !== 'run') return
  await downloadEngine.start({
    taskId: downloadInfo.id,
    url: downloadInfo.metadata.url ?? '',
    targetPath: downloadInfo.metadata.filePath,
    allowsCellular: settingState.setting['download.allowsCellular'],
  }).catch((err: Error) => {
    handleError(downloadInfo, 'WRITE_FAILED', err.message)
  })
}

const handleStartTask = async(downloadInfo: LX.Download.ListItem) => {
  if (!downloadInfo.metadata.url) {
    downloadInfo.statusText = t('download_status_url_getting')
    updateDownloadTask()
    const url = await getUrl(downloadInfo)
    if (!url) {
      handleError(downloadInfo, 'URL_FAILED', t('download_status_error_url_failed'))
      return
    }
    downloadInfo.metadata.url = url
    // 取链接期间任务可能已被暂停/删除
    if (downloadInfo.status !== 'run') return
  }

  const savePath = buildSavePath(downloadInfo)
  const relPath = `${savePath}/${downloadInfo.metadata.fileName}`

  // skipExistFile：目标文件已存在（>100 字节）直接置完成（§6）
  if (settingState.setting['download.skipExistFile']) {
    const fileStat = await stat(resolveDownloadPath(relPath)).catch(() => null)
    if (fileStat && fileStat.size > 100) {
      downloadInfo.metadata.filePath = relPath
      downloadInfo.isComplate = true
      downloadInfo.status = 'completed'
      downloadInfo.progress = 100
      downloadInfo.statusText = t('download___status_completed')
      addToIndex(downloadInfo)
      clearTaskMaps(downloadInfo.id)
      updateDownloadTask()
      void flushForAck().then(() => { checkStartTask() })
      return
    }
  }

  downloadInfo.metadata.filePath = relPath
  downloadInfo.statusText = t('download_status_start')
  updateDownloadTask()

  await engineStart(downloadInfo)
}

/**
 * 刷新链接：两段式重取，删续传数据后从 0 下（§7.3、§4.6）。
 * 每任务最多刷新 2 次，超限置错（§7.4）
 */
const handleRefreshUrl = async(downloadInfo: LX.Download.ListItem) => {
  const num = (refreshNum.get(downloadInfo.id) ?? 0) + 1
  refreshNum.set(downloadInfo.id, num)
  if (num > 2) {
    handleError(downloadInfo, 'URL_FAILED', t('download_status_error_url_failed'))
    return
  }
  downloadInfo.statusText = t('download_status_error_refresh_url')
  updateDownloadTask()
  const url = await refreshUrl(downloadInfo)
  if (!url) {
    handleError(downloadInfo, 'URL_FAILED', t('download_status_error_url_failed'))
    return
  }
  downloadInfo.metadata.url = url
  await downloadEngine.removeResumeData(downloadInfo.id).catch(() => {})
  if (downloadInfo.status !== 'run') return
  await engineStart(downloadInfo)
}

const handleError = (downloadInfo: LX.Download.ListItem, code: LX.Download.DownloadErrorCode, message?: string) => {
  downloadInfo.status = 'error'
  downloadInfo.statusText = message ?? t('download___status_error')
  downloadInfo.errorCode = code
  removeFromIndex(downloadInfo.metadata.musicInfo)
  clearTaskMaps(downloadInfo.id)
  updateDownloadTask()
  void downloadEngine.cancel(downloadInfo.id, true).catch(() => {})
  // 磁盘不足：等待任务全部暂停（§7.4）
  if (code === 'NO_SPACE') {
    for (const task of getDownloadList()) {
      if (task.status === 'waiting') task.status = 'pause'
    }
    updateDownloadTask()
    return
  }
  checkStartTask()
}

/**
 * 完成收尾（§7.5）：状态 → 索引 → .lrc → 落盘 → ack → 补位
 */
const handleComplete = (downloadInfo: LX.Download.ListItem) => {
  downloadInfo.isComplate = true
  downloadInfo.status = 'completed'
  downloadInfo.progress = 100
  downloadInfo.statusText = t('download___status_completed')
  addToIndex(downloadInfo)
  clearTaskMaps(downloadInfo.id)
  updateDownloadTask()
  void saveLrc(downloadInfo).catch(() => {})
  void ackLoggedEvents().then(() => {
    checkStartTask()
  })
}

/**
 * 错误分类（§7.4，与桌面版 `worker/download/download.ts` 逐项对齐）
 */
const handleEngineError = (downloadInfo: LX.Download.ListItem, event: EngineLiveEvent) => {
  const code = event.data.code ?? 'NETWORK'
  // 回放模式（审计#3）：冷启动回放时任务还是持久化状态，非终态错误
  //（网络/超时/链接失效等）不应发起重试，只置暂停、保留续传数据
  if (replaying && code !== 'FORCE_QUIT' && code !== 'SYSTEM_CANCELLED' && code !== 'WRITE_FAILED' && code !== 'ORPHAN' && code !== 'NO_SPACE') {
    downloadInfo.status = 'pause'
    downloadInfo.statusText = ''
    clearTaskMaps(downloadInfo.id)
    updateDownloadTask()
    return
  }
  switch (code) {
    case 'WRITE_FAILED':
    case 'ORPHAN':
      // 不透传原生原始报错（移动失败的系统报错含临时文件名，
      // 对用户无意义），统一用本地化文案
      handleError(downloadInfo, 'WRITE_FAILED', t('download_status_error_write'))
      return
    case 'NO_SPACE':
      handleError(downloadInfo, code, t('download_status_error_no_space'))
      return
    case 'CANCELLED':
      // JS 主动取消：状态已由调用方处理，忽略；
      // 系统取消（强退 / 资源不足）：存续传数据，任务转暂停（§4.4）
      if (jsCancelled.has(downloadInfo.id)) return
      downloadInfo.status = 'pause'
      downloadInfo.statusText = t('download_status_paused_system')
      clearTaskMaps(downloadInfo.id)
      updateDownloadTask()
      return
    case 'FORCE_QUIT':
    case 'SYSTEM_CANCELLED':
      downloadInfo.status = 'pause'
      downloadInfo.statusText = code === 'FORCE_QUIT' ? t('download_status_paused_force_quit') : t('download_status_paused_system')
      clearTaskMaps(downloadInfo.id)
      updateDownloadTask()
      return
    case 'HTTP_401':
    case 'HTTP_403':
    case 'HTTP_410':
    case 'DNS': {
      const num = (tryNum.get(downloadInfo.id) ?? 0) + 1
      tryNum.set(downloadInfo.id, num)
      if (num > 2) {
        handleError(downloadInfo, code, t('download_status_error_url_failed'))
        return
      }
      void handleRefreshUrl(downloadInfo)
      return
    }
    case 'HTTP_416': {
      const num = (tryNum.get(downloadInfo.id) ?? 0) + 1
      tryNum.set(downloadInfo.id, num)
      if (num > 2) {
        handleError(downloadInfo, code)
        return
      }
      void downloadEngine.removeResumeData(downloadInfo.id).catch(() => {}).then(async() => { await engineStart(downloadInfo) })
      return
    }
    default: {
      const num = (tryNum.get(downloadInfo.id) ?? 0) + 1
      tryNum.set(downloadInfo.id, num)
      if (num > 2) {
        handleError(downloadInfo, code, event.data.message)
        return
      }
      // 有续传数据优先续传，否则 1 秒后重试（§7.4）
      void (async() => {
        const resumed = event.data.hasResumeData
          ? await downloadEngine.resume(downloadInfo.id, settingState.setting['download.allowsCellular']).catch(() => false)
          : false
        if (!resumed) setTimeout(() => { void engineStart(downloadInfo) }, 1000)
      })()
    }
  }
}

/**
 * 引擎事件总入口（§4.9）
 */
export const handleEngineEvent = (event: EngineLiveEvent) => {
  if (event.type === 'bgFinished') return
  const task = getDownloadList().find(item => item.id === event.data.taskId)
  if (!task) return
  if (typeof event.data.seq === 'number' && event.data.seq > lastAckSeq) lastAckSeq = event.data.seq
  switch (event.type) {
    case 'start':
      // 状态守卫（修 R4）：只接受调度发起的运行中任务；非 run 状态
      // 收到 start 说明是孤儿传输（如进程重建后旧会话残留），掐掉
      if (task.status !== 'run') {
        void downloadEngine.cancel(task.id, false).catch(() => {})
        return
      }
      task.statusText = t('download___status_running')
      tryNum.set(task.id, 0)
      speedBase.set(task.id, { bytes: 0, time: Date.now() })
      updateDownloadTask()
      return
    case 'progress': {
      // 非运行态任务的进度事件一律忽略（同上）
      if (task.status !== 'run') return
      task.downloaded = event.data.downloaded ?? task.downloaded
      task.total = event.data.total ?? task.total
      task.progress = task.total > 0 ? Math.min(99.99, (task.downloaded / task.total) * 100) : 0
      const base = speedBase.get(task.id)
      const now = Date.now()
      if (base && now - base.time >= 1000) {
        const speed = (task.downloaded - base.bytes) / ((now - base.time) / 1000)
        task.speed = speed >= 1048576 ? `${(speed / 1048576).toFixed(1)}MB/s` : `${Math.round(speed / 1024)}KB/s`
        speedBase.set(task.id, { bytes: task.downloaded, time: now })
      }
      updateDownloadTask()
      return
    }
    case 'complete':
      // 幂等：已完成任务重复收 complete 只确认不重复处理（§4.6）
      if (task.isComplate && task.status === 'completed') {
        void ackLoggedEvents()
        return
      }
      // 后台期间系统下完的任务，冷启动时状态已被重置为 pause：
      // 文件确实落盘了，照常记完成
      handleComplete(task)
      return
    case 'error':
      // 非运行态任务收到错误事件：不改状态（避免后台残留事件
      // 覆盖用户已暂停/已恢复的状态），事件照常确认
      if (task.status !== 'run' && event.data.code !== 'FORCE_QUIT' && event.data.code !== 'SYSTEM_CANCELLED') {
        // 续传数据保留：resumeData 自带 URL/ETag，「全部开始」续传时
        // 校验不过服务器会从头下发或 416，不会拼坏文件（审计#7，
        // 回退 4884321）
        void ackLoggedEvents()
        return
      }
      handleEngineError(task, event)
  }
}

/**
 * 确认已处理的事件：先落盘任务状态再截断事件日志（§4.6）
 */
export const ackLoggedEvents = async() => {
  await flushForAck()
  await downloadEngine.ack(lastAckSeq).catch(() => {})
}

/**
 * 冷启动对齐：把原生仍在跑的传输认领为运行中任务（§7.8），
 * 返回认领的任务数，供调用方判断后续重置范围
 */
export const adoptNativeRunningTasks = async(): Promise<number> => {
  const active = await downloadEngine.getActiveTasks().catch(() => [] as Array<{ taskId: string, state: string, downloaded: number, total: number }>)
  let adopted = 0
  for (const item of active) {
    const task = getDownloadList().find(t => t.id === item.taskId)
    // 审计#9：任务已从列表删除（或已完成）但原生仍在跑，取消掉，
    // 避免无人认领的传输继续下载落盘
    if (!task || task.status === 'completed') {
      void downloadEngine.cancel(item.taskId, true).catch(() => {})
      continue
    }
    // 修 A：用 runningTask.has 判断是否已认领，而不是看持久化状态。
    // 冷启动时持久化状态正是 run，若按 status === 'run' 跳过，
    // 最常见的在传任务永远认领不到
    if (item.state !== 'running' || runningTask.has(task.id)) continue
    task.status = 'run'
    task.statusText = t('download___status_running')
    task.downloaded = item.downloaded
    task.total = item.total
    runningTask.set(task.id, task)
    adopted++
  }
  if (adopted > 0) updateDownloadTask()
  return adopted
}

/**
 * 引擎事件订阅接线（初始化时调用一次）
 */
export const bindEngineEvents = () => {
  downloadEngine.subscribe(handleEngineEvent)
  // maxDownloadNum 调大时立即补位；调小时不打断已在运行的任务，
  // 与桌面版一致（仅影响后续补位）
  global.state_event.on('configUpdated', (keys: Array<keyof LX.AppSetting>) => {
    if (keys.includes('download.maxDownloadNum')) checkStartTask()
  })
  // 退后台再回前台时：进程未被杀但原生后台会话可能已完成/出错，
  // 实时事件在挂起期间被丢弃，需要回放日志 + 认领存活任务对齐状态
  AppState.addEventListener('change', (state) => {
    // 修 I：initDownload 完成前（列表未加载）不处理，
    // 否则空列表上 adopt 会把所有存活任务当无主任务取消
    if (!initialized || state !== 'active') return
    // 修 J：后台唤醒冷启动时暂存的 autoResume，第一次回前台执行
    if (pendingAutoResume) {
      pendingAutoResume = false
      for (const task of getDownloadList()) {
        if (task.status === 'pause') task.status = 'waiting'
      }
    }
    void alignWithNative()
  })
}

/**
 * 与原生会话对齐：回放积压事件 → 认领存活传输 → 补位。
 * 冷启动（initDownload）与回前台（bindEngineEvents 的 AppState 监听）共用
 */
export interface AlignOptions {
  /** 对齐完成后是否补位调度。冷启动传 false，过了 AppState 门控
   *  再由调用方执行，避免后台唤醒时把 waiting 任务启动起来（修 B） */
  schedule?: boolean
  /** 是否冷启动回放。只有冷启动回放时非终态错误才置暂停不重试（修 D）；
   *  回前台对齐时网络错误照常走重试链路，与桌面版一致 */
  coldStart?: boolean
}

export const alignWithNative = async(options: AlignOptions = {}) => {
  const { schedule = true, coldStart = false } = options
  // 单飞：并发触发（init + AppState 回前台）共享同一次对齐（审计#2）
  if (aligning) return aligning
  aligning = (async() => {
    await replayLoggedEvents(coldStart)
    await adoptNativeRunningTasks()
    if (schedule) checkStartTask()
  })().finally(() => { aligning = null })
  return aligning
}

/**
 * 回放原生事件日志里未确认的事件。事件按 seq 升序，
 * 交由 handleEngineEvent 统一状态守卫处理，处理后统一确认
 */
export const replayLoggedEvents = async(coldStart: boolean = false) => {
  const events = await downloadEngine.drainEvents().catch(() => [] as LX.Download.EngineEvent[])
  // 修 D：只有冷启动回放打开回放安全模式（非终态错误置暂停不重试）。
  // 回前台对齐保持正常重试链路
  replaying = coldStart
  try {
    for (const entry of events) {
      // 按 seq 去重：跳过已实时处理过的（审计#1）。旧日志条目外层有
      // entry.seq，内层 data.seq 兜底
      const seq = (entry.data as { seq?: number } | undefined)?.seq ?? (entry as unknown as { seq?: number }).seq
      if (typeof seq === 'number' && seq <= lastAckSeq) continue
      handleEngineEvent({ type: entry.type as 'complete' | 'error', data: entry.data ?? {} })
    }
  } finally {
    replaying = false
  }
  await ackLoggedEvents()
}

/** initDownload 收尾：标记初始化完成，后台唤醒的 autoResume 由首次回前台执行 */
export const markInitialized = (autoResume: boolean) => {
  initialized = true
  pendingAutoResume = autoResume
}

/* ============ 对外操作 ============ */

/**
 * 冷启动收尾：未被原生认领的残留任务重置为暂停并清文案
 *（瞬态文案「音源链接获取中」等不落盘残留到下次展示）
 */
export const finalizeColdStart = (): void => {
  let changed = false
  for (const task of getDownloadList()) {
    // 修 A：已被 adoptNativeRunningTasks 认领的任务保留运行态，
    // 不重置。原生确实在传，重置会导致界面显示「已暂停」且并发计数错乱
    if (runningTask.has(task.id)) continue
    if (task.status === 'run' || task.status === 'waiting') {
      task.status = 'pause'
      task.statusText = ''
      clearTaskMaps(task.id)
      changed = true
    }
  }
  if (changed) updateDownloadTask()
}

/**
 * 孤儿认领（修 E）：元信息丢失时完整文件被暂存为孤儿，
 * 但 JS 侧的 `metadata.filePath` 还在，可按任务认领放回原位。
 * 列表里没有的孤儿（任务已被删除）直接清理
 */
export const claimOrphanTasks = async(): Promise<void> => {
  const ids = await downloadEngine.listOrphanTaskIds().catch(() => [] as string[])
  if (!ids.length) return
  let changed = false
  for (const taskId of ids) {
    const task = getDownloadList().find(t => t.id === taskId)
    if (!task || !task.metadata.filePath) {
      // 任务已被删除：孤儿文件无人认领，清掉
      void downloadEngine.removeOrphan(taskId).catch(() => {})
      continue
    }
    // 修 H：仍在运行（原生还在下）的任务不认领，避免把活任务标成完成、
    // 并发计数泄漏。修 L1：已完成的任务（文件已就位）同样不认领，
    // 但其对应的孤儿文件是残留，清掉
    if (runningTask.has(task.id)) continue
    if (task.status === 'completed') {
      void downloadEngine.removeOrphan(taskId).catch(() => {})
      continue
    }
    const destPath = resolveDownloadPath(task.metadata.filePath)
    const claimed = await downloadEngine.claimOrphan(taskId, destPath).catch(() => false)
    if (claimed) {
      // 文件归位：任务标完成、进索引
      task.status = 'completed'
      task.isComplate = true
      task.progress = 100
      task.statusText = t('download___status_completed')
      addToIndex(task)
      changed = true
      // 修 L2：认领成功后清掉残留的续传数据
      void downloadEngine.removeResumeData(taskId).catch(() => {})
    } else {
      // 认领失败（目标已被占用等）：清理孤儿
      void downloadEngine.removeOrphan(taskId).catch(() => {})
    }
  }
  if (changed) updateDownloadTask()
}

/**
 * 批量开始：置 `waiting` 后进调度（§7.6）
 */
export const startDownloadTasks = (tasks: LX.Download.ListItem[]) => {
  for (const task of tasks) {
    if (task.status === 'completed' || task.status === 'run' || task.status === 'waiting') continue
    task.status = 'waiting'
    task.errorCode = undefined
  }
  updateDownloadTask()
  checkStartTask()
}

/**
 * 暂停单个任务：运行中的走引擎 `pause`（保留续传数据）（§7.6）
 */
export const pauseDownloadTask = async(task: LX.Download.ListItem) => {
  if (task.status === 'run') {
    jsCancelled.add(task.id)
    const result = await downloadEngine.pause(task.id).catch(() => ({ hasResumeData: false }))
    jsCancelled.delete(task.id)
    void result
  }
  if (task.status === 'run' || task.status === 'waiting' || task.status === 'error') {
    task.status = 'pause'
    task.statusText = t('download___status_paused')
    clearTaskMaps(task.id)
    updateDownloadTask()
  }
}

/**
 * 删除任务；`removeFile` 时同时删音频、`.lrc` 与续传数据（§7.6）
 */
export const removeDownloadTaskFiles = async(tasks: LX.Download.ListItem[], removeFile: boolean) => {
  for (const task of tasks) {
    if (task.status === 'run') {
      jsCancelled.add(task.id)
      await downloadEngine.cancel(task.id, true).catch(() => {})
    } else {
      await downloadEngine.cancel(task.id, true).catch(() => {})
    }
    clearTaskMaps(task.id)
    removeFromIndex(task.metadata.musicInfo)
    if (removeFile) {
      if (task.metadata.filePath) await unlink(resolveDownloadPath(task.metadata.filePath)).catch(() => {})
      if (task.metadata.lrcPath) await unlink(resolveDownloadPath(task.metadata.lrcPath)).catch(() => {})
      await downloadEngine.removeResumeData(task.id).catch(() => {})
    }
  }
  updateDownloadTask()
}

/**
 * 关闭开关：运行中任务全部暂停，入口冻结（§7.7）。
 * 有意偏离桌面版（桌面版只隐藏入口），理由见设计文档 §7.7
 */
export const handleDisable = () => {
  for (const task of getDownloadList()) {
    if (task.status === 'run') {
      jsCancelled.add(task.id)
      void downloadEngine.pause(task.id).catch(() => {})
      task.status = 'pause'
      task.statusText = t('download___status_paused')
      clearTaskMaps(task.id)
    } else if (task.status === 'waiting') {
      task.status = 'pause'
    }
  }
  updateDownloadTask()
}

export { rebuildIndex }

/**
 * 测试钩子：清空内存调度状态（生产不调用）
 */
export const __resetForTest = () => {
  runningTask.clear()
  tryNum.clear()
  refreshNum.clear()
  jsCancelled.clear()
  speedBase.clear()
  lastAckSeq = 0
}
