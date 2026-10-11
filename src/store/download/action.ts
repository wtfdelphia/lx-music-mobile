import state from './state'
import { createDownloadPersist, type DownloadStorage } from '@/core/download/persist'
import { getData, removeData, saveData } from '@/plugins/storage'

/**
 * 任务列表存储层：内存 `state.downloadList` 为唯一读面，
 * 所有变更经本文件落盘并触发 `downloadListUpdate` 事件（§2.4）
 */

const asyncStorageAdapter: DownloadStorage = {
  getItem: async(key) => {
    const val = await getData<unknown>(key)
    return val == null ? null : JSON.stringify(val)
  },
  setItem: async(key, value) => {
    await saveData(key, JSON.parse(value))
  },
  removeItem: async(key) => {
    await removeData(key)
  },
}

const persist = createDownloadPersist(asyncStorageAdapter)

const notify = () => {
  global.app_event.downloadListUpdate()
}

/**
 * 冷启动加载任务列表（只加载，不重置状态）。
 * 状态重置由调度层 `finalizeColdStart` 在认领原生存活任务之后执行，
 * 顺序错会让仍在传输的任务被误置为暂停
 */
export const initDownloadList = async(): Promise<void> => {
  const tasks = await persist.load()
  state.downloadList = tasks
  notify()
}

/**
 * 整体覆盖并落盘；新增任务按 `addMusicLocationType` 决定插入位置由调用方完成
 */
const commit = (tasks: LX.Download.ListItem[]) => {
  state.downloadList = tasks
  persist.save(tasks)
  notify()
}

export const addDownloadTasks = (tasks: LX.Download.ListItem[], addLocationType: LX.AddMusicLocationType): void => {
  if (!tasks.length) return
  const next = addLocationType === 'top'
    ? [...tasks, ...state.downloadList]
    : [...state.downloadList, ...tasks]
  commit(next)
}

export const removeDownloadTasks = (ids: string[]): void => {
  if (!ids.length) return
  const idSet = new Set(ids)
  commit(state.downloadList.filter(t => !idSet.has(t.id)))
}

export const clearDownloadList = (): void => {
  if (!state.downloadList.length) return
  commit([])
}

/**
 * 任务字段变更（状态、进度、链接等）后调用；进度类高频字段
 * 依赖 persist 的 100ms 合并，关键状态须 `await flushForAck()` 再 ack（§4.6）
 */
export const updateDownloadTask = (): void => {
  persist.save(state.downloadList)
  notify()
}

/**
 * 关键状态强制落盘，供事件确认前调用（§4.6、§7.5）
 */
export const flushForAck = async(): Promise<void> => {
  await persist.flush()
}

export const getDownloadList = (): LX.Download.ListItem[] => {
  return state.downloadList
}
