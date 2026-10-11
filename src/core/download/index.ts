import { AppState } from 'react-native'
import settingState from '@/store/setting/state'
import { createDownloadInfo } from './utils'
import { getDownloadList, addDownloadTasks, initDownloadList, removeDownloadTasks, clearDownloadList } from '@/store/download/action'
import { bindEngineEvents, checkStartTask, startDownloadTasks, pauseDownloadTask, removeDownloadTaskFiles, handleDisable, rebuildIndex, adoptNativeRunningTasks, finalizeColdStart, alignWithNative, claimOrphanTasks, markInitialized } from './scheduler'
import { reconcile } from './reconcile'
import { removeFromIndex } from './downloadIndex'
import { isDownloadSupported } from './support'

export { isDownloadSupported }

/**
 * 下载模块对外动作面（§3 架构图 `index.ts`）
 */

/**
 * 初始化（§7.8，修复冷启动状态脱节）：
 * 加载列表 → 先订阅事件（避免回放期间漏接新事件）→ 回放积压事件日志
 * → 认领原生存活传输 → 重置残留任务 → 对账 → 重建索引 → 调度。
 * 顺序关键：回放与认领必须在重置之前，否则仍在传输的任务会被误置暂停。
 * 后台唤醒（AppState 非 active）只对齐状态，不取链接、不发起下载（审计#4）
 */
export const initDownload = async() => {
  bindEngineEvents()
  await initDownloadList()
  // 回放积压事件 + 认领原生存活传输。冷启动回放非终态错误置暂停不重试，
  // 不在这里补位——修 B：补位放到 AppState 门控之后，
  // 避免后台唤醒时把 waiting 任务启动起来
  await alignWithNative({ coldStart: true, schedule: false })
  // 未被认领的残留任务重置为暂停并清瞬态文案
  finalizeColdStart()
  // 修 E：认领孤儿暂存文件放回原位（元信息丢失时的完整下载）
  await claimOrphanTasks()
  const tasks = getDownloadList()
  const changed = await reconcile(tasks)
  await rebuildIndex(tasks)
  void changed
  const wantAutoResume = settingState.setting['download.enable'] && settingState.setting['download.autoResume']
  // 修 I：初始化完成，AppState 监听此后才生效。
  // 修 J：后台唤醒冷启动时不立即恢复，把 autoResume 意图暂存给首次回前台；
  // 前台启动则立即执行，故暂存标记置否避免重复
  markInitialized(AppState.currentState !== 'active' ? wantAutoResume : false)
  if (AppState.currentState !== 'active') return
  if (wantAutoResume) {
    for (const task of tasks) {
      if (task.status === 'pause') task.status = 'waiting'
    }
  }
  // 修 B：过了 AppState 门控才补位
  checkStartTask()
}


/**
 * 创建下载任务（§7.1）：过滤本地歌曲、逐首降级、按键去重，
 * 返回实际新增的任务数
 */
export const createDownloadTasks = (list: LX.Music.MusicInfo[], quality: LX.Quality, listId?: string): number => {
  if (!list.length || !settingState.setting['download.enable']) return 0
  const fileName = settingState.setting['download.fileName']
  const existing = new Set(getDownloadList().map(t => t.id))
  const tasks = list
    .filter((musicInfo): musicInfo is LX.Music.MusicInfoOnline => musicInfo.source !== 'local')
    .map(musicInfo => createDownloadInfo(musicInfo, quality, fileName, global.lx.qualityList, listId))
    .filter(task => {
      if (existing.has(task.id)) return false
      existing.add(task.id)
      return true
    })
  if (!tasks.length) return 0
  addDownloadTasks(tasks, settingState.setting['list.addMusicLocationType'])
  checkStartTask()
  return tasks.length
}

/**
 * UI 拿到的是 hook 浅克隆的快照（5038fbd 为进度刷新引入），
 * 直接传给调度层会把状态改在克隆上、原列表不动。统一入口
 * 按 id 回查原对象，快照或 id 传入都安全
 */
const resolveTasks = (tasks: Array<{ id: string }>): LX.Download.ListItem[] => {
  const map = new Map(getDownloadList().map(t => [t.id, t]))
  return tasks.map(t => map.get(t.id)).filter((t): t is LX.Download.ListItem => !!t)
}

/**
 * 手动开始任务（下载页操作）
 */
export const startTasks = (tasks: Array<{ id: string }>) => {
  startDownloadTasks(resolveTasks(tasks))
}

/**
 * 手动暂停任务；暂停运行中任务后补位（对齐桌面版
 * pauseDownloadTasks，等待任务顶上释放的并发槽）
 */
export const pauseTasks = async(tasks: Array<{ id: string }>) => {
  for (const task of resolveTasks(tasks)) await pauseDownloadTask(task)
  checkStartTask()
}

/**
 * 删除任务（可选连同文件）
 */
export const removeTasks = async(tasks: Array<{ id: string }>, removeFile: boolean) => {
  const list = resolveTasks(tasks)
  await removeDownloadTaskFiles(list, removeFile)
  removeDownloadTasks(list.map(t => t.id))
}

/**
 * 全部开始 / 全部暂停（各只触发一次调度，§7.6）
 */
export const startAll = () => {
  startDownloadTasks(getDownloadList().filter(t => t.status === 'pause' || t.status === 'error'))
}

export const pauseAll = async() => {
  const tasks = getDownloadList().filter(t => t.status === 'run' || t.status === 'waiting')
  for (const task of tasks) await pauseDownloadTask(task)
}

/**
 * 清空已完成任务（保留文件）
 */
export const clearCompleted = () => {
  const completed = getDownloadList().filter(t => t.status === 'completed')
  if (completed.length) removeDownloadTasks(completed.map(t => t.id))
}

/**
 * 本地文件播放失败回落在线时调用（§9）：移出索引并对账
 */
export const handleLocalPlayFallback = (musicInfo: LX.Music.MusicInfoOnline) => {
  removeFromIndex(musicInfo)
  void reconcile(getDownloadList()).then(async() => {
    await rebuildIndex(getDownloadList())
  })
}

/**
 * 进入下载页时触发对账（§7.8）
 */
export const enterDownloadView = async() => {
  const tasks = getDownloadList()
  const changed = await reconcile(tasks)
  if (changed) await rebuildIndex(tasks)
}

/**
 * 下载开关变更入口：关闭时冻结任务（§7.7）
 */
export const handleEnableChanged = (enable: boolean) => {
  if (!enable) handleDisable()
  else checkStartTask()
}

export { clearDownloadList }
