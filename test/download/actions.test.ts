import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * core/download/index 对外动作：验证 UI 传入快照（hook 浅克隆）时
 * 按 id 回查原对象，避免状态改在克隆上无效（5038fbd 引入的回归）。
 * 同时验证暂停运行任务后补位（对齐桌面版）
 */

const mockStore = vi.hoisted(() => ({
  tasks: [] as LX.Download.ListItem[],
  updateDownloadTask: vi.fn(),
  flushForAck: vi.fn(async() => {}),
  removeDownloadTasks: vi.fn(),
}))

const mockEngine = vi.hoisted(() => ({
  subscribe: vi.fn(() => () => {}),
  start: vi.fn(async(_task: { taskId: string, url: string, targetPath: string, allowsCellular: boolean }) => {}),
  pause: vi.fn(async() => ({ hasResumeData: true })),
  resume: vi.fn(async() => false),
  cancel: vi.fn(async() => {}),
  removeResumeData: vi.fn(async() => {}),
  getActiveTasks: vi.fn(async() => [] as Array<{ taskId: string, state: 'running' | 'suspended', downloaded: number, total: number }>),
  drainEvents: vi.fn(async() => [] as LX.Download.EngineEvent[]),
  ack: vi.fn(async() => {}),
}))

const mockSetting = vi.hoisted(() => ({
  setting: {
    'download.enable': true,
    'download.maxDownloadNum': 2,
    'download.skipExistFile': false,
    'download.allowsCellular': false,
  } as Record<string, unknown>,
}))

vi.mock('@/store/download/action', () => ({
  getDownloadList: () => mockStore.tasks,
  updateDownloadTask: mockStore.updateDownloadTask,
  flushForAck: mockStore.flushForAck,
  removeDownloadTasks: mockStore.removeDownloadTasks,
}))
vi.mock('@/core/download/engine', () => ({ downloadEngine: mockEngine }))
vi.mock('@/core/download/urlResolver', () => ({
  getUrl: vi.fn(async() => 'https://example.com/a.mp3'),
  refreshUrl: vi.fn(async() => 'https://example.com/a.mp3'),
}))
vi.mock('@/core/download/lrc', () => ({ saveLrc: vi.fn(async() => {}) }))
vi.mock('@/core/download/reconcile', () => ({ reconcile: vi.fn(async() => false) }))
vi.mock('@/core/download/downloadIndex', () => ({
  rebuildIndex: vi.fn(async() => {}),
  addToIndex: vi.fn(),
  removeFromIndex: vi.fn(),
}))
vi.mock('@/core/download/support', () => ({ isDownloadSupported: () => true }))
vi.mock('@/utils/fs', () => ({
  stat: vi.fn(async() => { throw new Error('no file') }),
  unlink: vi.fn(async() => {}),
  writeFile: vi.fn(async() => {}),
  privateStorageDirectoryPath: '/mock/Documents',
}))
vi.mock('@/store/setting/state', () => ({ default: mockSetting }))
vi.mock('@/store/list/state', () => ({ default: { userList: [] } }))

import { pauseTasks, startTasks } from '@/core/download/index'
import { __resetForTest } from '@/core/download/scheduler'

const makeTask = (id: string, status: LX.Download.DownloadTaskStatus): LX.Download.ListItem => ({
  id,
  isComplate: false,
  status,
  statusText: '',
  downloaded: 0,
  total: 0,
  progress: 0,
  speed: '',
  metadata: {
    musicInfo: {
      id: `music_${id}`,
      name: 'song',
      singer: 'artist',
      source: 'kw',
      interval: '04:00',
      meta: { qualitys: [], _qualitys: { '128k': { size: '3M' } }, albumName: '', picUrl: '', toggleMusicInfo: null },
    } as unknown as LX.Music.MusicInfoOnline,
    url: null,
    quality: '128k',
    ext: 'mp3',
    fileName: `${id}.mp3`,
    filePath: '',
  },
})

beforeEach(() => {
  __resetForTest()
  mockStore.tasks = []
  mockStore.updateDownloadTask.mockClear()
  mockStore.removeDownloadTasks.mockClear()
  mockEngine.start.mockClear()
  mockEngine.pause.mockClear()
  mockEngine.cancel.mockClear()
  global.i18n = { t: (key: string) => key } as never
})

describe('快照安全：UI 传克隆时按 id 回查原对象', () => {
  it('用克隆调 pauseTasks：原任务从 waiting 变 pause', async() => {
    const original = makeTask('a', 'waiting')
    mockStore.tasks = [original]
    const snapshot = { ...original } // hook 浅克隆出来的快照
    await pauseTasks([snapshot])
    expect(original.status).toBe('pause')
    expect(snapshot).not.toBe(original)
  })

  it('用克隆调 startTasks：原任务从 pause 进入调度', async() => {
    const original = makeTask('a', 'pause')
    mockStore.tasks = [original]
    const snapshot = { ...original }
    startTasks([snapshot])
    await vi.waitFor(() => expect(mockEngine.start).toHaveBeenCalled())
    expect(original.status).toBe('run')
  })

  it('已删除的任务传入时安全跳过', async() => {
    mockStore.tasks = []
    const ghost = makeTask('gone', 'pause')
    await pauseTasks([{ ...ghost }])
    expect(mockStore.updateDownloadTask).not.toHaveBeenCalled()
  })
})

describe('暂停运行任务后补位', () => {
  it('并发 2、3 个任务：暂停 1 个运行中，等待任务立即顶上', async() => {
    mockStore.tasks = [makeTask('a', 'waiting'), makeTask('b', 'waiting'), makeTask('c', 'waiting')]
    // 入队调度：并发 2 → a、b 运行，c 等待
    const { checkStartTask } = await import('@/core/download/scheduler')
    checkStartTask()
    await vi.waitFor(() => expect(mockEngine.start).toHaveBeenCalledTimes(2))
    expect(mockStore.tasks.map(t => t.status)).toEqual(['run', 'run', 'waiting'])
    // 暂停 a（用快照模拟菜单操作）
    await pauseTasks([{ ...mockStore.tasks[0] }])
    expect(mockEngine.pause).toHaveBeenCalledWith('a')
    expect(mockStore.tasks[0].status).toBe('pause')
    // c 立即补位为 run
    await vi.waitFor(() => expect(mockStore.tasks[2].status).toBe('run'))
    expect(mockEngine.start).toHaveBeenCalledTimes(3)
  })

  it('暂停等待中任务不触发引擎、释放的是调度机会', async() => {
    mockStore.tasks = [makeTask('a', 'waiting')]
    await pauseTasks([{ ...mockStore.tasks[0] }])
    expect(mockStore.tasks[0].status).toBe('pause')
    expect(mockEngine.pause).not.toHaveBeenCalled()
  })
})
