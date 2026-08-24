// iOS 文件适配层：等价实现 fs.ts 的 27 个导出（任务 1.4 / design D4）。
// 基于 react-native-fs；stat/readDir 合成 name/path/mimeType/canRead 字段。
// gzip 四方法与 DocumentPicker 选择器为占位实现，分别由任务 6.1 / 6.5 接入。
import RNFS from 'react-native-fs'

export type Encoding = 'base64' | 'utf8'
export type HashAlgorithm = 'md5' | 'sha1' | 'sha256' | 'sha384' | 'sha512'

export interface FileType {
  name: string
  path: string
  mimeType: string
  canRead: boolean
  size: number
  isDirectory: boolean
}

export interface OpenDocumentOptions {
  extTypes: string[] | null
  toPath?: string
}

export const extname = (name: string) => name.lastIndexOf('.') > 0 ? name.substring(name.lastIndexOf('.') + 1) : ''

const MIME_MAP: Record<string, string> = {
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/opus',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wma: 'audio/x-ms-wma',
  ape: 'audio/x-ape',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  txt: 'text/plain',
  json: 'application/json',
  zip: 'application/zip',
  gz: 'application/gzip',
}
const getMimeType = (name: string): string => MIME_MAP[extname(name).toLowerCase()] ?? 'application/octet-stream'

// iOS 无外部存储；路径常量统一落到沙箱（外部存储路径与私有路径同指 Documents）
export const temporaryDirectoryPath = RNFS.CachesDirectoryPath
export const externalStorageDirectoryPath = RNFS.DocumentDirectoryPath
export const privateStorageDirectoryPath = RNFS.DocumentDirectoryPath

export const getExternalStoragePaths = async(_is_removable?: boolean): Promise<string[]> => []

// SAF / managed folder 概念在 iOS 不存在，相关 UI 由平台分支隐藏；
// 此处以空结果/显式 reject 桩化，保证导出面完整且调用不产生 undefined
export const selectManagedFolder = async(_isPersist: boolean = false): Promise<string> => {
  throw new Error('selectManagedFolder is not supported on iOS')
}
export const selectFile = async(_options: OpenDocumentOptions): Promise<{ data: string }> => {
  throw new Error('selectFile is not implemented on iOS yet (task 6.5: DocumentPicker)')
}
export const removeManagedFolder = async(_path: string): Promise<void> => {}
export const getManagedFolders = async(): Promise<string[]> => []
export const getPersistedUriList = async(): Promise<string[]> => []

export const readDir = async(path: string): Promise<FileType[]> => {
  const items = await RNFS.readDir(path)
  return items.map((item) => ({
    name: item.name,
    path: item.uri,
    size: item.size,
    isDirectory: item.isDirectory(),
    mimeType: item.isFile() ? getMimeType(item.name) : '',
    canRead: true,
  }))
}

export const unlink = async(path: string) => {
  await RNFS.unlink(path)
}

export const mkdir = async(path: string) => {
  await RNFS.mkdir(path)
}

export const stat = async(path: string): Promise<FileType> => {
  const info = await RNFS.stat(path)
  const name = path.split('/').pop() ?? path
  return {
    name,
    path: info.uri,
    size: info.size,
    isDirectory: info.isDirectory(),
    mimeType: info.isFile() ? getMimeType(name) : '',
    canRead: true,
  }
}

export const hash = async(path: string, algorithm: HashAlgorithm) => RNFS.hash(path, algorithm)

export const readFile = async(path: string, encoding?: Encoding) => RNFS.readFile(path, encoding)

export const moveFile = async(fromPath: string, toPath: string) => {
  await RNFS.moveFile(fromPath, toPath)
}

// gzip 族：iOS 原生实现待任务 6.1（libz，windowBits=31，与 Android 互通后启用）
const gzipNotImplemented = (method: string): never => {
  throw new Error(`${method} is not implemented on iOS yet (task 6.1)`)
}
export const gzipFile = async(_fromPath: string, _toPath: string) => gzipNotImplemented('gzipFile')
export const unGzipFile = async(_fromPath: string, _toPath: string) => gzipNotImplemented('unGzipFile')
export const gzipString = async(_data: string, _encoding?: Encoding) => gzipNotImplemented('gzipString')
export const unGzipString = async(_data: string, _encoding?: Encoding) => gzipNotImplemented('unGzipString')

export const existsFile = async(path: string) => RNFS.exists(path)

export const rename = async(path: string, name: string) => {
  const dir = path.substring(0, path.lastIndexOf('/'))
  await RNFS.moveFile(path, `${dir}/${name}`)
}

export const writeFile = async(path: string, data: string, encoding?: Encoding) => {
  await RNFS.writeFile(path, data, encoding)
}

export const appendFile = async(path: string, data: string, encoding?: Encoding) => {
  await RNFS.appendFile(path, data, encoding)
}

export const downloadFile = (url: string, path: string, options: Omit<RNFS.DownloadFileOptions, 'fromUrl' | 'toFile'> = {}) => {
  if (!options.headers) {
    options.headers = {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 10; Pixel 3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.79 Mobile Safari/537.36',
    }
  }
  return RNFS.downloadFile({
    fromUrl: url,
    toFile: path,
    ...options,
  })
}

export const stopDownload = (jobId: number) => {
  RNFS.stopDownload(jobId)
}
