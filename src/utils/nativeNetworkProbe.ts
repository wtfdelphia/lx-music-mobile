import { NativeModules, Platform } from 'react-native'

// 请求失败时的原生侧交叉探针（任务 9.6）：RN Networking 把 NSError
// 吞成无文本的 "Network request failed"，真机错误日志里只有这一句，
// 归因无从谈起。fetch 失败后用原生 NSURLSession 重打同一 URL，把
// NSError domain/code/description 追加进同一份错误日志。异步发射、
// 失败静默：探针只加厚证据，绝不影响原请求的错误传播。仅 iOS 启用。

interface HttpProbeResult { ok: boolean, domain: string, code: number, desc: string, status: number, elapsedMs: number }
type HttpProbeFn = (url: string) => Promise<HttpProbeResult>

const probeFn = (Platform.OS === 'ios'
  ? (NativeModules.UtilsModule as { httpProbe?: HttpProbeFn } | undefined)?.httpProbe
  : undefined)

export const fireNativeNetworkProbe = (url: string, logError: (msg: string) => void): void => {
  if (!probeFn) return
  void probeFn(url).then(r => {
    logError(`[native probe] ${url} -> ${r.ok
      ? `ok status=${r.status} ${r.elapsedMs.toFixed(0)}ms`
      : `${r.domain}/${r.code} ${r.desc} (${r.elapsedMs.toFixed(0)}ms)`}`)
  }).catch(() => { /* 探针失败静默，不影响主链路 */ })
}

interface AvStreamProbeResult { status: string, errorDomain: string, errorCode: number, errorDesc: string, elapsedMs: number }
type AvStreamProbeFn = (url: string) => Promise<AvStreamProbeResult>

const avProbeFn = (Platform.OS === 'ios'
  ? (NativeModules.UtilsModule as { avStreamProbe?: AvStreamProbeFn } | undefined)?.avStreamProbe
  : undefined)

// 播放装载失败时的媒体通道归因探针（任务 9.8）：裸 AVPlayer 重装载
// 同一 URL 带回 NSError。数据通道（NSURLSession）放行不蕴含媒体通道
// （AVFoundation）放行，两者受不同 ATS 辖区治理；errorCode -1022 即
// 媒体通道被 ATS 拦截，其他错误码说明 ATS 已放行、失败在传输/解码
// 层。异步发射、失败静默，不影响错误传播。仅 iOS 启用
export const fireAvStreamProbe = (url: string, logError: (msg: string) => void): void => {
  if (!avProbeFn) return
  void avProbeFn(url).then(r => {
    logError(`[av stream probe] ${url.split('?')[0]} -> ${r.status} ${r.errorDomain}/${r.errorCode} ${r.errorDesc.slice(0, 200)} (${r.elapsedMs.toFixed(0)}ms)`)
  }).catch(() => { /* 探针失败静默，不影响主链路 */ })
}
