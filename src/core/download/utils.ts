import { filterFileName } from '@/utils/common'
import { LIST_IDS } from '@/config/constant'
import settingState from '@/store/setting/state'
import listState from '@/store/list/state'
import { joinDownloadPath } from './path'

/**
 * 音质阶梯，与桌面版一致（`renderer/worker/download/utils.ts`）。
 * 移动端 `TRY_QUALITYS_LIST` 只有 3 档，不满足降级需要，单独建一份
 */
export const QUALITYS = ['flac24bit', 'flac', 'wav', 'ape', '320k', '192k', '128k'] as const

const MAX_NAME_LENGTH = 80
const MAX_FILE_NAME_LENGTH = 150

/**
 * 歌手名按「、」截断（桌面版 `tools.ts:139`）
 */
export const clipNameLength = (name: string): string => {
  if (name.length <= MAX_NAME_LENGTH || !name.includes('、')) return name
  const names = name.split('、')
  let newName = names.shift()!
  for (const name of names) {
    if (newName.length + name.length > MAX_NAME_LENGTH) break
    newName = newName + '、' + name
  }
  return newName
}

/**
 * 文件名按字符截断（桌面版 `tools.ts:149`），不是按字节
 */
export const clipFileNameLength = (name: string): string => {
  return name.length > MAX_FILE_NAME_LENGTH ? name.substring(0, MAX_FILE_NAME_LENGTH) : name
}

/**
 * 模板替换（桌面版 `tools.ts:153`）
 */
export const formatMusicName = (format: string, name: string, singer: string): string => {
  return format.replace('歌手', singer).replace('歌名', name)
}

/**
 * 音质到扩展名（桌面版同名函数）
 */
export const getExt = (type: string): LX.Download.FileExt => {
  switch (type) {
    case 'ape':
      return 'ape'
    case 'flac':
    case 'flac24bit':
      return 'flac'
    case 'wav':
      return 'wav'
    case '128k':
    case '192k':
    case '320k':
    default:
      return 'mp3'
  }
}

/**
 * 确定实际音质（桌面版 `getMusicType`）：
 * 源不支持请求音质时改用该源列表最后一项；
 * 再沿 `QUALITYS` 往下找歌曲实际拥有的第一档；都没有回 128k
 */
export const getMusicType = (musicInfo: LX.Music.MusicInfoOnline, type: LX.Quality, qualityList: LX.QualityList): LX.Quality => {
  let list = qualityList[musicInfo.source]
  if (!list) return '128k'
  if (!list.includes(type)) type = list[list.length - 1]
  const rangeType = QUALITYS.slice(QUALITYS.indexOf(type as typeof QUALITYS[number]))
  for (const type of rangeType) {
    if (musicInfo.meta._qualitys[type]) return type
  }
  return '128k'
}

/**
 * 构建下载任务（桌面版 `createDownloadInfo`）。
 * 任务键 `${歌曲id}_${音质}_${扩展名}`，与桌面版一致。
 * `filePath` 存相对 Documents 的路径，由调度层在启动时拼接；
 * `statusText` 由 store 层按语言设置
 */
export const createDownloadInfo = (musicInfo: LX.Music.MusicInfoOnline, type: LX.Quality, fileName: string, qualityList: LX.QualityList, listId?: string): LX.Download.ListItem => {
  type = getMusicType(musicInfo, type, qualityList)
  let ext = getExt(type)
  const key = `${musicInfo.id}_${type}_${ext}`
  return {
    id: key,
    isComplate: false,
    status: 'waiting',
    statusText: '',
    downloaded: 0,
    total: 0,
    progress: 0,
    speed: '',
    metadata: {
      musicInfo,
      url: null,
      quality: type,
      ext,
      fileName: filterFileName(`${clipFileNameLength(formatMusicName(fileName, musicInfo.name, clipNameLength(musicInfo.singer)))}.${ext}`),
      filePath: '',
      listId,
    },
  }
}


/**
 * 构建保存目录（相对 Documents，桌面版 `buildSavePath` 移植）：
 * 固定根目录为 `Download`；开启按列表分目录时，默认列表与我的收藏
 * 用 i18n 名，自建列表从列表状态取名，经清洗与截断；
 * 取不到名字归入默认列表名（§6）
 */
export const buildSavePath = (downloadInfo: LX.Download.ListItem): string => {
  let savePath = 'Download'
  if (!settingState.setting['download.isSavePathGroupByListName']) return savePath
  const listId = downloadInfo.metadata.listId
  let dirName: string | undefined
  if (listId === LIST_IDS.DEFAULT) dirName = global.i18n.t('list_name_default')
  else if (listId === LIST_IDS.LOVE) dirName = global.i18n.t('list_name_love')
  else dirName = listState.userList.find(l => l.id === listId)?.name
  if (dirName) dirName = filterFileName(dirName)
  return joinDownloadPath(savePath, clipFileNameLength(dirName ?? global.i18n.t('list_name_default')))
}
