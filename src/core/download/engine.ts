import { Platform } from 'react-native'

/**
 * 下载引擎接口。P1a 按完整形态冻结（D10）：
 * pause / resume / removeResumeData / getActiveTasks / drainEvents / ack
 * 依赖原生 `DownloadModule` 的后续能力，P1a 在 iOS 上由原生返回显式错误，
 * 非 iOS 平台一律拒绝。原生侧实现完成后本文件不改接口、只改绑定。
 */
export interface DownloadEngine {
  configure: (opts: { maxConcurrent: number }) => Promise<void>
  start: (task: { taskId: string, url: string, targetPath: string, allowsCellular: boolean, headers?: Record<string, string> }) => Promise<void>
  pause: (taskId: string) => Promise<{ hasResumeData: boolean }>
  resume: (taskId: string, allowsCellular: boolean) => Promise<boolean>
  cancel: (taskId: string, removeResumeData: boolean) => Promise<void>
  removeResumeData: (taskId: string) => Promise<void>
  getActiveTasks: () => Promise<Array<{ taskId: string, state: 'running' | 'suspended', downloaded: number, total: number }>>
  drainEvents: () => Promise<LX.Download.EngineEvent[]>
  ack: (lastSeq: number) => Promise<void>
}

const notSupported = async(): Promise<never> => {
  throw new Error('download engine not supported on this platform')
}

/**
 * 非 iOS 的空实现：所有方法拒绝（`not supported`）。
 * Android 下载另立 change（`AGENTS.md:158`），不在此文件实现
 */
export const downloadEngine: DownloadEngine = {
  configure: notSupported,
  start: notSupported,
  pause: notSupported,
  resume: notSupported,
  cancel: notSupported,
  removeResumeData: notSupported,
  getActiveTasks: notSupported,
  drainEvents: notSupported,
  ack: notSupported,
}

export const isDownloadSupported = () => Platform.OS === 'ios'
