// CI 自测报告断言（宿主侧）：读取应用内自测报告与 Tab 截图，任一失败则退出码 1。
// 用法：node test/ci-report-assert.js <ci-report.json> [tab-*.png ...]
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const zlib = require('zlib')

const [,, reportFile, ...tabPngs] = process.argv
if (!reportFile) {
  console.error('usage: node test/ci-report-assert.js <ci-report.json> [tab-*.png ...]')
  process.exit(2)
}
if (!fs.existsSync(reportFile)) {
  console.error(`FAIL: report not found: ${reportFile}（应用内自测未完成）`)
  process.exit(1)
}

const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'))
const failures = []

// finished=false：应用增量写的部分报告（套件中途崩溃，如 run 32995785233
// 旋转通道崩进程）。照常断言已有结果，并显式判套件未完成
if (report.finished === false) {
  failures.push('suite_incomplete: 部分报告（应用中途退出，未见 lx-ci-done 标记）')
}

console.log(`report v${report.v} ok=${report.ok} duration=${(report.durationMs / 1000).toFixed(1)}s`)
for (const r of report.results) {
  console.log(`  [${r.ok ? 'PASS' : 'FAIL'}] ${r.id} (${r.ms}ms)`)
  if (!r.ok) failures.push(`${r.id}: ${typeof r.detail === 'string' ? r.detail : JSON.stringify(r.detail)}`)
}

// gzip 交叉验证：设备端 gzipString 产物必须能被宿主标准 gunzip 解压（iOS→Android 互操作）
const gzipResult = report.results.find(r => r.id === 'gzip_contract')
if (gzipResult && gzipResult.ok && gzipResult.detail && gzipResult.detail.gzipOutB64) {
  try {
    const text = zlib.gunzipSync(Buffer.from(gzipResult.detail.gzipOutB64, 'base64')).toString('utf8')
    if (text !== gzipResult.detail.expectText) {
      failures.push(`gzip_host_crosscheck: 文本不一致: ${text}`)
    } else console.log('  [PASS] gzip_host_crosscheck')
  } catch (err) {
    failures.push(`gzip_host_crosscheck: 宿主 gunzip 失败: ${err.message}`)
  }
} else {
  failures.push('gzip_host_crosscheck: 缺少 gzip_contract 结果')
}

// Tab 截图必须互不相同（证明切换确实触发了重新渲染）
const hashes = []
for (const p of tabPngs) {
  if (!fs.existsSync(p)) {
    failures.push(`tab 截图缺失: ${p}`)
    continue
  }
  hashes.push({ p: path.basename(p), h: crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex') })
}
for (let i = 0; i < hashes.length; i++) {
  for (let j = i + 1; j < hashes.length; j++) {
    if (hashes[i].h === hashes[j].h) failures.push(`tab 截图相同（未重新渲染？）: ${hashes[i].p} == ${hashes[j].p}`)
  }
}
const tabPairsFailed = hashes.length >= 2 && hashes.some((a, i) => hashes.slice(i + 1).some(b => a.h === b.h))
if (hashes.length >= 4 && !tabPairsFailed) console.log('  [PASS] tab_screenshots_differ')

console.log('env: isAgreePact=%s langId=%s bootLogTail=%j',
  report.env && report.env.isAgreePact,
  report.env && report.env.langId,
  String((report.env && report.env.bootLog) || '').slice(-120))
console.log('alerts=%d overlays=%s linkingListeners=%s',
  (report.alerts || []).length,
  JSON.stringify((report.overlays || []).map(o => `${o.name}${o.dismissed ? '(dismissed)' : ''}`)),
  JSON.stringify((report.env && report.env.linkingListeners) || []))

// 脚本回归集通过率摘要（G1 雏形）：硬断言失败已由 runTest 计入 failures，
// 这里仅呈现逐脚本结果供 design.md D6 判读
const regression = report.results.find(r => r.id === 'user_api_regression')
if (regression && regression.detail && Array.isArray(regression.detail.results)) {
  console.log(`\nscripts regression: ${regression.detail.inited}/${regression.detail.total} inited (hard-required ${regression.detail.hardRequired})`)
  for (const r of regression.detail.results) {
    const tag = r.ok ? 'INITED' : (r.expectInited ? 'HARD-FAIL' : 'soft')
    console.log(`  [${tag}] ${r.script} (${r.ms}ms, sources=${r.sources}${r.error ? ', ' + String(r.error).slice(0, 80) : ''})`)
  }
}

// 任务 4.4 取证：内置源真实搜索返回（mainflow_local 用例写入）
if (Array.isArray(report.searchHits) && report.searchHits.length) {
  console.log('\nsearch hits (task 4.4):')
  for (const h of report.searchHits) console.log(`  [${h.source}] ${h.name} - ${h.singer} (id=${h.id})`)
}

// 任务 5.2 取证：全程 AppState 序列须出现 background（后台续播放生效）
if (Array.isArray(report.appStates) && report.appStates.length) {
  const seq = report.appStates.map(e => e.s).join(' -> ')
  console.log(`\napp state trail (task 5.2): ${seq}`)
}

if (failures.length) {
  console.error(`\nFAIL (${failures.length}):`)
  for (const f of failures) console.error('  - ' + f)
  process.exit(1)
}
console.log('\nALL CI SELF-TEST ASSERTIONS PASSED')
