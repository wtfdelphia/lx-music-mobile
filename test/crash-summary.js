// iOS DiagnosticReports（.ips）崩溃摘要：抽取异常类型 + 崩溃线程栈头部，
// 直接内嵌进 CI 日志（.ips 全文在 artifact 里）。新格式 .ips 为逐行 JSON
// （首行 header + 次行 payload）；解析失败回退原文头部。
// 用法：node test/crash-summary.js <report.ips>
const fs = require('fs')
const file = process.argv[2]
if (!file || !fs.existsSync(file)) { console.error('usage: node test/crash-summary.js <report.ips>'); process.exit(2) }
const raw = fs.readFileSync(file, 'utf8')
let payload = null
for (const line of raw.split('\n')) {
  const t = line.trim()
  if (!t.startsWith('{')) continue
  try {
    const obj = JSON.parse(t)
    if (obj && (obj.exception || obj.faultingThread !== undefined)) { payload = obj; break }
  } catch { /* 非 payload 行，继续找 */ }
}
if (!payload) { console.log(raw.slice(0, 3000)); process.exit(0) }
const images = payload.usedImages || []
const threads = payload.threads || []
const ft = payload.faultingThread ?? 0
const thread = threads[ft] || {}
console.log('incident:', payload.incident || '?')
console.log('exception:', JSON.stringify(payload.exception || {}))
console.log('termination:', JSON.stringify(payload.termination || {}))
console.log(`faultingThread: ${ft} (of ${threads.length})`)
for (const fr of (thread.frames || []).slice(0, 16)) {
  const img = images[fr.imageIndex] || {}
  console.log(`  ${img.name || '?'} +${fr.imageOffset ?? '?'}${fr.symbol ? ' ' + fr.symbol : ''}`)
}
