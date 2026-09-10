// iOS 本地音乐元数据降级实现（任务 7.2 / plan §6.5）：
// react-native-local-media-metadata 无 iOS 原生实现，
// 读取降级为"仅文件名"，写入类操作显式 reject，保证扫描不崩、无未捕获异常
import { temporaryDirectoryPath, readDir, unlink, extname, stat } from '@/utils/fs'

export interface MusicMetadata {
  albumName: string
  singer: string
  name: string
}
export interface MusicMetadataFull {
  type: 'mp3' | 'flac' | 'ogg' | 'wav'
  bitrate: string
  interval: number
  size: number
  ext: 'mp3' | 'flac' | 'ogg' | 'wav'
  albumName: string
  singer: string
  name: string
}

let cleared = false
const picCachePath = temporaryDirectoryPath + '/local-media-metadata'

export const scanAudioFiles = async(dirPath: string) => {
  const files = await readDir(dirPath)
  return files.filter(file => {
    if (file.mimeType?.startsWith('audio/')) return true
    if (extname(file?.name ?? '') === 'ogg') return true
    return false
  }).map(file => file)
}

const clearPicCache = async() => {
  try {
    await unlink(picCachePath)
  } catch { /* 缓存目录不存在时忽略 */ }
  cleared = true
}

// 降级：仅以文件名构造元数据，标签信息留空
export const readMetadata = async(filePath: string): Promise<MusicMetadataFull | null> => {
  const name = filePath.split('/').pop() ?? filePath
  const dotIndex = name.lastIndexOf('.')
  const ext = (dotIndex > 0 ? name.substring(dotIndex + 1) : '').toLowerCase()
  let size = 0
  try {
    size = (await stat(filePath)).size ?? 0
  } catch { /* 取不到大小不影响导入 */ }
  return {
    type: 'mp3',
    bitrate: '0',
    interval: 0,
    size,
    ext: (ext || 'mp3') as MusicMetadataFull['ext'],
    albumName: '',
    singer: '',
    name: dotIndex > 0 ? name.substring(0, dotIndex) : name,
  }
}

const unsupported = async(): Promise<void> => {
  throw new Error('Writing media tags is not supported on iOS')
}

export const writeMetadata: (filePath: string, metadata: MusicMetadata, isOverwrite?: boolean) => Promise<void> = unsupported
export const writePic: (filePath: string, picPath: string) => Promise<void> = unsupported
export const writeLyric: (filePath: string, lyric: string) => Promise<void> = unsupported

// 封面 / 歌词读取降级为空结果（调用方均有 catch/空值分支）
export const readPic = async(_dirPath: string): Promise<string> => {
  if (!cleared) await clearPicCache()
  return Promise.resolve('')
}

export const readLyric = async(_filePath: string, _isReadLrcFile?: boolean): Promise<string> => {
  return Promise.resolve('')
}
