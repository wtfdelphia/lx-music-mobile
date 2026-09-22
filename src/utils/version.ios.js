// 任务 7.3：iOS 无应用内更新（指南 2.5.2）。版本检查逻辑保留，
// 下载/安装改为跳转 GitHub Release 页面。
import { Linking } from 'react-native'
import { httpGet } from '@/utils/request'
import { author, name } from '../../package.json'

const address = [
  // fork 更新通道：单源指向本仓库（见 openspec/changes/fork-update-channel）
  [`https://raw.githubusercontent.com/${author.name}/${name}/main/publish/version.json`, 'direct'],
]


const request = async(url, retryNum = 0) => {
  return new Promise((resolve, reject) => {
    httpGet(url, {
      timeout: 10000,
    }, (err, resp, body) => {
      if (err || resp.statusCode != 200) {
        ++retryNum >= 3
          ? reject(err || new Error(resp.statusMessage || resp.statusCode))
          : request(url, retryNum).then(resolve).catch(reject)
      } else resolve(body)
    })
  })
}

const getDirectInfo = async(url) => {
  return request(url).then(info => {
    if (info.version == null) throw new Error('failed')
    return info
  })
}

export const getVersionInfo = async(index = 0) => {
  const [url] = address[index]
  const promise = getDirectInfo(url)

  return promise.catch(async(err) => {
    index++
    if (index >= address.length) throw err
    return getVersionInfo(index)
  })
}

export const downloadNewVersion = async(version, onDownload = (total, download) => {}) => {
  await Linking.openURL(`https://github.com/${author.name}/${name}/releases/tag/v${version}`)
}

export const updateApp = async() => {
  await Linking.openURL(`https://github.com/${author.name}/${name}/releases`)
}
