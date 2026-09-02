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
