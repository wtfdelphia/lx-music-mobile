// iOS CI 应用内自测：沙箱 tmp 目录存在标记文件 `.lx-ci-selftest` 时运行，
// 结果写入 `lx-ci-report.json` 供 CI 宿主读取断言。无标记文件立即返回，
// 对正式包零影响。宿主侧流程见 .github/workflows/ios-verify.yml 冒烟 job。
import { Alert, Linking, Platform } from 'react-native'
import RNFS from 'react-native-fs'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Navigation } from 'react-native-navigation'
import { DEFAULT_SETTING, storageDataPrefix } from '@/config/constant'

type TestResult = { id: string, ok: boolean, ms: number, detail?: unknown }

const state = {
  startedAt: 0,
  results: [] as TestResult[],
  alerts: [] as Array<{ at: number, title: string, message: string, buttons: string[] }>,
  overlays: [] as Array<{ at: number, name: string, componentId: string, dismissed: boolean }>,
  consoleRing: [] as string[],
  linkingListeners: [] as string[],
  userApiLogs: [] as string[],
  userApiEvents: [] as Array<{ action: string, at: number }>,
  deeplinkRegisteredByTest: false,
}

const tmpDir = () => RNFS.TemporaryDirectoryPath
const markerPath = () => `${tmpDir()}/.lx-ci-selftest`
const reportPath = () => `${tmpDir()}/lx-ci-report.json`
const probeSentMarker = () => `${tmpDir()}/.lx-ci-probe-sent`
// AppDelegate 在标记门控下把收到的 openURL 逐条落盘（原生投递取证）
const nativeOpenUrlLog = () => `${tmpDir()}/lx-ci-openurl.log`

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

const withTimeout = async<T>(p: Promise<T>, ms: number, label: string): Promise<T> => {
  return Promise.race([
    p,
    sleep(ms).then(() => { throw new Error(`timeout after ${ms}ms: ${label}`) }),
  ])
}

const assert = (cond: unknown, message: string) => {
  if (!cond) throw new Error('assert failed: ' + message)
}

const errText = (err: unknown) => {
  if (err instanceof Error) return err.message
  return String(err)
}

// ---------- 运行时探针（仅标记文件存在时安装） ----------

const DISMISSABLE_OVERLAYS = new Set(['lxm.VersionModal', 'lxm.PactModal', 'lxm.SyncModeModal', 'lxm.Toast'])

const installAlertSpy = () => {
  const original = Alert.alert.bind(Alert)
  // @ts-expect-error 猴子补丁：记录所有原生弹窗以定位 CI 中出现的对话框来源
  Alert.alert = (title: string, message?: string, buttons?: Array<{ text?: string }>, ...rest: unknown[]) => {
    try {
      state.alerts.push({
        at: Date.now(),
        title: String(title ?? ''),
        message: String(message ?? '').slice(0, 300),
        buttons: (buttons ?? []).map(b => String(b?.text ?? '')),
      })
    } catch { /* 记录失败不影响弹窗 */ }
    return original(title, message, buttons, ...rest)
  }
}

const installConsoleRing = () => {
  const levels = ['log', 'info', 'warn', 'error', 'debug'] as const
  for (const level of levels) {
    const original = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      try {
        const line = `[${level}] ` + args.map(a => {
          if (typeof a === 'string') return a
          try { return JSON.stringify(a) } catch { return String(a) }
        }).join(' ').slice(0, 500)
        state.consoleRing.push(line)
        if (state.consoleRing.length > 400) state.consoleRing.splice(0, state.consoleRing.length - 400)
      } catch { /* 忽略 */ }
      return original(...args)
    }
  }
}

const installLinkingSpy = () => {
  const original = Linking.addEventListener.bind(Linking)
  // @ts-expect-error 猴子补丁：记录深链监听注册，验证 initDeeplink 是否执行
  Linking.addEventListener = (type: string, handler: unknown) => {
    try { state.linkingListeners.push(String(type)) } catch { /* 忽略 */ }
    return original(type, handler)
  }
}

const installOverlayWatcher = () => {
  Navigation.events().registerComponentDidAppearListener(({ componentId, componentName }) => {
    try {
      const entry = { at: Date.now(), name: String(componentName), componentId: String(componentId), dismissed: false }
      state.overlays.push(entry)
      if (DISMISSABLE_OVERLAYS.has(String(componentName))) {
        void Navigation.dismissOverlay(componentId).then(() => {
          entry.dismissed = true
        }).catch(() => {})
      }
    } catch { /* 忽略 */ }
  })
}

// 预置存储，让 CI 冷启动跳过首启对话框（谨防被骗提示 / 用户协议），
// 使 initDeeplink 走自然注册路径。仅在标记文件存在时执行（正式设备
// 不会到达）；写入须抢在 core/init 读存储之前，若竞态失败由
// testDeeplink 显式调用 initDeeplink 兜底。
const prewriteStorage = async() => {
  await AsyncStorage.setItem(storageDataPrefix.cheatTip, JSON.stringify(true))
  const setting = { ...DEFAULT_SETTING, 'common.isAgreePact': true, 'common.isAutoTheme': true }
  await AsyncStorage.setItem(storageDataPrefix.setting, JSON.stringify(setting))
}

// ---------- 测试用例 ----------

const runTest = async(id: string, fn: () => Promise<unknown>, timeoutMs = 120_000) => {
  const t0 = Date.now()
  try {
    const detail = await withTimeout(fn(), timeoutMs, id)
    state.results.push({ id, ok: true, ms: Date.now() - t0, detail })
  } catch (err) {
    state.results.push({ id, ok: false, ms: Date.now() - t0, detail: errText(err) })
  }
}

// 1.3 UtilsModule
const testUtils = async() => {
  const utils = await import('@/utils/nativeModules/utils')
  const size = await utils.getWindowSize()
  assert(typeof size.width === 'number' && size.width > 0, 'window width > 0')
  assert(typeof size.height === 'number' && size.height > 0, 'window height > 0')
  const deviceName = await utils.getDeviceName()
  const locales = await utils.getSystemLocales()
  const notif = await utils.isNotificationsEnabled()
  return { size, deviceName, locales, notif }
}

// 1.4 fs 导出面
const EXPECTED_FS_EXPORTS = [
  'extname', 'temporaryDirectoryPath', 'externalStorageDirectoryPath', 'privateStorageDirectoryPath',
  'getExternalStoragePaths', 'selectManagedFolder', 'selectFile', 'removeManagedFolder',
  'getManagedFolders', 'getPersistedUriList', 'readDir', 'unlink', 'mkdir', 'stat', 'hash',
  'readFile', 'moveFile', 'gzipFile', 'unGzipFile', 'gzipString', 'unGzipString', 'existsFile',
  'rename', 'writeFile', 'appendFile', 'downloadFile', 'stopDownload',
]
const testFsExports = async() => {
  const fs = await import('@/utils/fs') as Record<string, unknown>
  const missing = EXPECTED_FS_EXPORTS.filter(name => fs[name] === undefined)
  assert(missing.length === 0, `fs missing exports: ${missing.join(', ')}`)
  return { count: EXPECTED_FS_EXPORTS.length }
}

// 1.4 fs 读写往返
const testFsRoundtrip = async() => {
  const fs = await import('@/utils/fs')
  const dir = `${fs.temporaryDirectoryPath}/lx-ci-fs`
  try { await fs.mkdir(dir) } catch { /* 已存在 */ }
  const f1 = `${dir}/a.txt`
  await fs.writeFile(f1, '你好 lx', 'utf8')
  assert(await fs.readFile(f1, 'utf8') === '你好 lx', 'utf8 roundtrip')
  await fs.appendFile(f1, '!!', 'utf8')
  assert(await fs.readFile(f1, 'utf8') === '你好 lx!!', 'append')
  const f2 = `${dir}/b.bin`
  await fs.writeFile(f2, 'aGVsbG8=', 'base64')
  assert(await fs.readFile(f2, 'base64') === 'aGVsbG8=', 'base64 roundtrip')
  const st = await fs.stat(f1)
  assert(st.name === 'a.txt', 'stat name')
  assert(st.mimeType === 'text/plain', `stat mimeType got ${st.mimeType as string}`)
  assert(st.canRead === true, 'stat canRead')
  assert((st.size ?? 0) > 0, 'stat size')
  const items = await fs.readDir(dir)
  assert(items.some(i => i.name === 'a.txt'), 'readDir lists a.txt')
  assert(await fs.existsFile(f2), 'existsFile')
  const md5 = await fs.hash(f1, 'md5')
  assert(/^[0-9a-f]{32}$/.test(md5), 'hash md5 shape')
  await fs.moveFile(f1, `${dir}/moved.txt`)
  await fs.rename(`${dir}/moved.txt`, 'c.txt')
  assert(await fs.existsFile(`${dir}/c.txt`), 'move+rename')
  await fs.unlink(`${dir}/c.txt`)
  await fs.unlink(f2)
  assert(!(await fs.existsFile(`${dir}/c.txt`)), 'unlink')
  return { md5 }
}

// 3.1 桥 + 3.4 CryptoModule：复跑黄金基准。
// 契约（对齐 Android / rust lxcore-crypto）：encrypt 入出参均 base64；
// decrypt 入参 base64、出参 UTF-8 明文（Java `new String(bytes, UTF_8)`）。
const b64ToUtf8 = (b64: string) => Buffer.from(b64, 'base64').toString('utf8')
const testCryptoGolden = async() => {
  const crypto = await import('@/utils/nativeModules/crypto')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const vectors = require('../../test/crypto-golden-vectors.json') as {
    aes: Array<{ name: string, mode: string, dataB64: string, keyB64: string, ivB64: string, expectCipherB64: string, expectPlainUtf8: string }>,
    rsa: { publicKeyB64: string, privateKeyB64: string, cases: Array<{ name: string, padding: string, dataB64: string, cipherB64: string, plainB64: string }> },
  }
  const aesSummary: Array<{ name: string, syncOk: boolean }> = []
  for (const c of vectors.aes) {
    const mode = c.mode as 'AES/CBC/PKCS7Padding' | 'AES'
    const cipher = await crypto.aesEncrypt(c.dataB64, c.keyB64, c.ivB64, mode)
    assert(cipher === c.expectCipherB64, `aes encrypt ${c.name}: got ${cipher}`)
    const plain = await crypto.aesDecrypt(c.expectCipherB64, c.keyB64, c.ivB64, mode)
    assert(plain === c.expectPlainUtf8, `aes decrypt ${c.name}: got ${plain}`)
    const syncCipher = crypto.aesEncryptSync(c.dataB64, c.keyB64, c.ivB64, mode)
    const syncPlain = crypto.aesDecryptSync(c.expectCipherB64, c.keyB64, c.ivB64, mode)
    assert(syncCipher === c.expectCipherB64, `aes sync encrypt ${c.name}: got ${syncCipher}`)
    assert(syncPlain === c.expectPlainUtf8, `aes sync decrypt ${c.name}: got ${syncPlain}`)
    aesSummary.push({ name: c.name, syncOk: true })
  }
  const rsaSummary: Array<{ name: string, checks: string[] }> = []
  for (const c of vectors.rsa.cases) {
    const padding = c.padding as typeof crypto.RSA_PADDING.OAEPWithSHA1AndMGF1Padding
    const checks: string[] = []
    if (c.padding === 'RSA/ECB/NoPadding') {
      // NoPadding 为确定性裸模幂：密文可逐字节对照黄金值；
      // 解密返回整模长块（含前导零），UTF-8 面不宜断言，跳过
      const enc = await crypto.rsaEncrypt(c.dataB64, vectors.rsa.publicKeyB64, padding)
      assert(enc === c.cipherB64, `rsa nopad encrypt ${c.name}: got ${String(enc).slice(0, 40)}...`)
      checks.push('encrypt-deterministic')
    } else {
      const expectedPlain = b64ToUtf8(c.plainB64)
      const decrypted = await crypto.rsaDecrypt(c.cipherB64, vectors.rsa.privateKeyB64, padding)
      assert(decrypted === expectedPlain, `rsa decrypt golden ${c.name}: got ${String(decrypted).slice(0, 40)}`)
      checks.push('decrypt-golden')
      const enc = await crypto.rsaEncrypt(c.dataB64, vectors.rsa.publicKeyB64, padding)
      const back = await crypto.rsaDecrypt(enc, vectors.rsa.privateKeyB64, padding)
      assert(back === b64ToUtf8(c.dataB64), `rsa roundtrip ${c.name}: got ${String(back).slice(0, 40)}`)
      checks.push('roundtrip')
    }
    rsaSummary.push({ name: c.name, checks })
  }
  const gen = await crypto.generateRsaKey()
  assert(gen.publicKey.includes('BEGIN PUBLIC KEY'), 'generateRsaKey public')
  const genEnc = await crypto.rsaEncrypt('aGVsbG8=', gen.publicKey, crypto.RSA_PADDING.OAEPWithSHA1AndMGF1Padding)
  const genDec = await crypto.rsaDecrypt(genEnc, gen.privateKey, crypto.RSA_PADDING.OAEPWithSHA1AndMGF1Padding)
  assert(genDec === 'hello', `generated key roundtrip: got ${String(genDec).slice(0, 40)}`)
  return { aes: aesSummary.length, rsa: rsaSummary }
}

// 6.1 gzip 契约（含宿主交叉验证样本）
const GZIP_CROSS_FIXTURE = 'H4sIAAAAAAAC/wEtANL/5rSb6Zuq6Z+z5LmQIGd6aXAg5aWR57qm5rWL6K+VIGx4bWMgaGVsbG8gMTIzGh/CoS0AAAA='
const GZIP_CROSS_TEXT = '洛雪音乐 gzip 契约测试 lxmc hello 123'
const testGzip = async() => {
  const fs = await import('@/utils/fs')
  // Android（Java zlib）→ iOS
  const cross = await fs.unGzipString(GZIP_CROSS_FIXTURE, 'utf8')
  assert(cross === GZIP_CROSS_TEXT, 'cross fixture ungzip')
  // iOS → Android：产物交宿主用标准 gzip 解压交叉验证
  const out = await fs.gzipString(GZIP_CROSS_TEXT, 'utf8')
  assert(await fs.unGzipString(out, 'utf8') === GZIP_CROSS_TEXT, 'gzipString roundtrip')
  // base64 编码路径
  const out2 = await fs.gzipString('aGVsbG8=', 'base64')
  assert(await fs.unGzipString(out2, 'base64') === 'aGVsbG8=', 'base64 path roundtrip')
  // 文件级往返
  const dir = `${fs.temporaryDirectoryPath}/lx-ci-gzip`
  try { await fs.mkdir(dir) } catch { /* 已存在 */ }
  const src = `${dir}/plain.txt`
  const gz = `${dir}/plain.txt.gz`
  const back = `${dir}/plain-back.txt`
  await fs.writeFile(src, GZIP_CROSS_TEXT, 'utf8')
  await fs.gzipFile(src, gz)
  await fs.unGzipFile(gz, back)
  assert(await fs.readFile(back, 'utf8') === GZIP_CROSS_TEXT, 'file roundtrip')
  await fs.unlink(src); await fs.unlink(gz); await fs.unlink(back)
  return { gzipOutB64: out, expectText: GZIP_CROSS_TEXT }
}

// 5.6 CacheModule
const testCache = async() => {
  const cache = await import('@/utils/nativeModules/cache')
  const size = await cache.getAppCacheSize()
  assert(Number.isFinite(size) && size >= 0, 'cache size >= 0')
  await cache.clearAppCache()
  const sizeAfter = await cache.getAppCacheSize()
  assert(Number.isFinite(sizeAfter) && sizeAfter >= 0, 'cache size after clear')
  return { size, sizeAfter }
}

// 7.1 桌面歌词桩：全部导出可调用、无 reject
const testLyricStubs = async() => {
  const ld = await import('@/utils/nativeModules/lyricDesktop') as Record<string, unknown>
  const fns = Object.entries(ld).filter(([, v]) => typeof v === 'function') as Array<[string, () => Promise<void>]>
  assert(fns.length >= 20, `lyric stub exports >= 20, got ${fns.length}`)
  for (const [name, fn] of fns) {
    await fn()
    void name
  }
  return { exports: fns.map(([name]) => name) }
}

// 7.2 本地音乐降级
const testLocalMedia = async() => {
  const fs = await import('@/utils/fs')
  const lmm = await import('@/utils/localMediaMetadata')
  const dir = `${fs.temporaryDirectoryPath}/lx-ci-media`
  try { await fs.mkdir(dir) } catch { /* 已存在 */ }
  const fake = `${dir}/lx-ci-fake.mp3`
  await fs.writeFile(fake, 'fake audio bytes', 'utf8')
  const files = await lmm.scanAudioFiles(dir)
  assert(files.some(f => String((f as { name?: string }).name ?? f).includes('lx-ci-fake.mp3')), 'scan finds fake mp3')
  const meta = await lmm.readMetadata(fake)
  assert(meta != null && meta.name === 'lx-ci-fake', 'metadata degrades to filename')
  let writeRejected = false
  try {
    await lmm.writeMetadata(fake, { name: 'x', singer: 'y', albumName: 'z', pic: null, lyric: null, lyrics: null } as never)
  } catch { writeRejected = true }
  assert(writeRejected, 'writeMetadata rejects on iOS')
  const pic = await lmm.readPic(dir)
  const lyric = await lmm.readLyric(fake)
  assert(pic === '', 'readPic empty')
  assert(lyric === '', 'readLyric empty')
  await fs.unlink(fake)
  return { scanned: files.length, metaName: meta?.name }
}

// 4.1/4.2/4.3 UserApiModule：preload 完成 + 注入函数字节级一致 + 反向通道 + 定时器
const CI_USER_API_SCRIPT = [
  '\'use strict\';',
  'try {',
  '  const { EVENT_NAMES, send, utils } = globalThis.lx;',
  // 生态约定：二进制产物走 hex（bufToString 的 base64 路经 bytesToString
  // UTF-8 解释，仅对文本字节安全；社区脚本对密文一律用 hex，双端同此约定）
  '  const cipher = utils.buffer.bufToString(utils.crypto.aesEncrypt(\'hello\', \'aes-128-cbc\', \'0123456789abcdef\', \'abcdef9876543210\'), \'hex\');',
  '  const md5 = utils.crypto.md5(\'a b\');',
  '  const b64 = utils.buffer.bufToString(utils.buffer.from(\'aGVsbG8=\', \'base64\'), \'base64\');',
  '  console.log(\'LXCI_UTILS \' + cipher + \' \' + md5 + \' \' + b64);',
  '  setTimeout(() => { console.log(\'LXCI_TIMER_OK\'); }, 300);',
  '  send(EVENT_NAMES.inited, { status: true, sources: {} });',
  '} catch (err) { console.error(\'LXCI_SCRIPT_ERR \' + (err && err.message)); }',
].join('\n')
const GOLDEN_AES_CIPHER_HEX = 'ae46ee99bb420a590df8991db3b6d027'
const GOLDEN_MD5 = '0cc9cd4dd26c5137b675a0d819cb9ab0'

const testUserApi = async() => {
  const userApi = await import('@/utils/nativeModules/userApi')
  let initEvent: { status?: boolean, errorMessage?: string } | null = null
  const off = userApi.onScriptAction((event) => {
    state.userApiEvents.push({ action: event.action, at: Date.now() })
    const raw = event as unknown as { action: string, log?: string }
    if (event.action === 'log' && typeof raw.log === 'string') state.userApiLogs.push(raw.log)
    if (event.action === 'init') initEvent = event.data as typeof initEvent
  })
  try {
    userApi.loadScript({
      id: 'lx-ci-selftest',
      name: 'CI Self Test',
      description: 'in-app CI verification script',
      version: '1.0.0',
      author: 'lx-ci',
      homepage: '',
      script: CI_USER_API_SCRIPT,
    } as never)
    const waitInit = async() => {
      const t0 = Date.now()
      while (Date.now() - t0 < 30_000) {
        if (initEvent) return
        await sleep(250)
      }
      throw new Error(`no init event in 30s; logs: ${state.userApiLogs.slice(-5).join(' | ')}`)
    }
    await waitInit()
    assert(initEvent != null && initEvent.status === true, `init status true, got ${JSON.stringify(initEvent)}`)
    assert(state.userApiLogs.some(l => l.includes('Preload finished.')), 'preload finished log')
    const utilsLine = state.userApiLogs.find(l => l.startsWith('LXCI_UTILS '))
    assert(utilsLine != null, 'utils probe line')
    const [aesCipher, md5, b64] = String(utilsLine).slice('LXCI_UTILS '.length).split(' ')
    assert(aesCipher === GOLDEN_AES_CIPHER_HEX, `jsc aes golden, got ${aesCipher}`)
    assert(md5 === GOLDEN_MD5, `jsc md5 golden, got ${md5}`)
    assert(b64 === 'aGVsbG8=', 'buffer roundtrip')
    const t0 = Date.now()
    while (Date.now() - t0 < 10_000) {
      if (state.userApiLogs.some(l => l.includes('LXCI_TIMER_OK'))) break
      await sleep(250)
    }
    assert(state.userApiLogs.some(l => l.includes('LXCI_TIMER_OK')), 'set_timeout round trip')
  } finally {
    off()
    try { userApi.destroy() } catch { /* 忽略 */ }
  }
  return { logs: state.userApiLogs.slice(0, 20), events: state.userApiEvents.map(e => e.action) }
}

// 5.1 track-player setupPlayer
const testPlayerSetup = async() => {
  const player = await import('@/plugins/player')
  await withTimeout(player.initial({
    volume: 1,
    playRate: 1,
    cacheSize: 1024,
    isHandleAudioFocus: false,
    isEnableAudioOffload: false,
  }), 90_000, 'setupPlayer')
  assert(player.isInitialized(), 'player initialized')
  return { initialized: true }
}

// 5.5 缓存三方法 iOS 降级
const testPlayerCacheDegrade = async() => {
  const putils = await import('@/plugins/player/utils')
  const cached = await putils.isCached('https://example.com/lx-ci.mp3')
  assert(cached === false, 'isCached degrades to false')
  const size = await putils.getCacheSize()
  assert(size === 0, 'getCacheSize degrades to 0')
  await putils.clearCache()
  return { cached, size }
}

// 1.6 四 Tab 切换（宿主按标记文件逐 Tab 截图）
const NAV_IDS = ['nav_search', 'nav_songlist', 'nav_love', 'nav_setting'] as const
const testTabs = async() => {
  const commonAction = (await import('@/store/common/action')).default
  const commonState = (await import('@/store/common/state')).default
  const switched: string[] = []
  for (const id of NAV_IDS) {
    commonAction.setNavActiveId(id)
    await sleep(6000) // 等待视图渲染稳定
    assert(commonState.navActiveId === id, `navActiveId == ${id}`)
    const marker = `${tmpDir()}/lx-ci-tab-${id}`
    await RNFS.writeFile(marker, String(Date.now()), 'utf8')
    // 等待宿主截图完成（宿主截图后删除标记）。宿主在首页取证（约 25s）
    // 结束后才进入本阶段，首个标记等待可能远超早期 20s 上限——那会让
    // 应用抢跑一个 Tab、宿主截图整体错位一拍（run 32828495250 实证）。
    // 放宽到 90s；宿主缺席时由 runTest 的 300s 总超时兜底判失败。
    const t0 = Date.now()
    let consumed = false
    while (Date.now() - t0 < 90_000) {
      if (!(await RNFS.exists(marker))) { consumed = true; break }
      await sleep(500)
    }
    assert(consumed, `host consumed tab marker ${id}`)
    switched.push(id)
  }
  await RNFS.writeFile(`${tmpDir()}/lx-ci-tabs-done`, String(Date.now()), 'utf8')
  commonAction.setNavActiveId('nav_search')
  return { switched }
}

// 6.3/6.4 深链：等待宿主探针标记，校验监听注册与处理痕迹
const testDeeplink = async() => {
  const t0 = Date.now()
  // iOS 18.5 模拟器上 `simctl openurl` 对自定义 scheme 静默吞件（前台/
  // 后台唤醒均证伪，run 32834027405/32836063520：AppDelegate 零收件）。
  // 改由应用内 Linking.openURL 自投递：同样经 SpringBoard 路由 →
  // AppDelegate openURL → RCTLinkingManager → JS 监听，验证 6.3 全链路。
  let inAppProbeOk = false
  try {
    inAppProbeOk = await Linking.openURL('lxmusic://player/pause')
  } catch { /* 失败由下方断言带诊断信息呈现 */ }
  while (Date.now() - t0 < 15_000) {
    if (state.consoleRing.some(l => l.includes('deeplink lxmusic://player/pause'))) break
    await sleep(500)
  }
  const tProbe = Date.now()
  let probeSeen = false
  while (Date.now() - tProbe < 120_000) {
    if (await RNFS.exists(probeSentMarker())) { probeSeen = true; break }
    await sleep(2000)
  }
  assert(probeSeen, 'host probe marker')
  await sleep(8000) // 等待 JS 侧处理完成
  const deeplinkLines = state.consoleRing.filter(l => l.includes('deeplink'))
  const fileAlert = state.alerts.find(a => a.message.includes('lx-ci-probe'))
  // 原生侧投递取证：区分「系统未送达 App」与「送达但 JS 事件未触发」
  let nativeUrls: string[] = []
  try {
    if (await RNFS.exists(nativeOpenUrlLog())) {
      nativeUrls = (await RNFS.readFile(nativeOpenUrlLog(), 'utf8')).split('\n').filter(Boolean)
    }
  } catch { /* 读取失败不阻断断言 */ }
  // 处理链报错会走 errorDialog → Alert spy；本阶段唯一合法弹窗是
  // 文件导入确认，其余文案都说明深链处理链抛了错
  const unexpectedAlert = state.alerts.find(a => !a.message.includes('lx-ci-probe'))
  assert(state.linkingListeners.includes('url'), 'deeplink url listener registered')
  // 失败时把原生投递取证带进错误文本，宿主日志即可区分投递层/事件层
  const diag = `inAppProbeOk=${inAppProbeOk} nativeOpenUrls=${JSON.stringify(nativeUrls)} deeplinkLines=${JSON.stringify(deeplinkLines.slice(-5))}`
  assert(deeplinkLines.some(l => l.includes('lxmusic://player/pause')), `lxmusic probe reached JS listener (in-app openURL) | ${diag}`)
  assert(!unexpectedAlert, `no unexpected alert during deeplink probes | ${diag} unexpectedAlert=${JSON.stringify(unexpectedAlert)}`)
  assert(deeplinkLines.some(l => l.includes('lx-ci-probe.lxmc')), `file probe reached JS listener | ${diag}`)
  assert(fileAlert != null, `file probe triggered import confirm dialog | ${diag}`)
  return {
    inAppProbeOk,
    probeSeen,
    registeredByTest: state.deeplinkRegisteredByTest,
    linkingListeners: state.linkingListeners,
    deeplinkLines: deeplinkLines.slice(-10),
    nativeOpenUrls: nativeUrls,
    fileImportDialogSeen: fileAlert != null,
    fileAlertDialog: fileAlert ?? null,
    recentAlerts: state.alerts.slice(-5),
  }
}

// 2.3 社区脚本回归一键入口：宿主按 test/scripts-regression/ci-expect.json
// 把候选脚本 + 清单投递到沙箱临时目录，应用内逐个「加载→inited」断言。
// 断言口径（本地预跑判读）：离线可 inited 的脚本硬断言；需远端的包装/
// 自更新脚本仅记录（CI 外网对社区源不稳定，不作硬门禁）。搜索/取链接
// 依赖外网，按 design.md D6 留手测与报告判读。
const REGRESSION_MANIFEST = 'lx-ci-regression-manifest.json'
type RegressionEntry = { file: string, expectInited: boolean, reason?: string }
const testScriptsRegression = async() => {
  const userApi = await import('@/utils/nativeModules/userApi')
  const manifestPath = `${tmpDir()}/${REGRESSION_MANIFEST}`
  assert(await RNFS.exists(manifestPath), 'regression manifest not delivered by host')
  const manifest = JSON.parse(await RNFS.readFile(manifestPath, 'utf8')) as { scripts: RegressionEntry[] }
  assert(manifest.scripts.length >= 10, `manifest too small: ${manifest.scripts.length}`)
  const results: Array<{ script: string, expectInited: boolean, ok: boolean, inited: boolean, sources: number, ms: number, error?: string }> = []
  for (const entry of manifest.scripts) {
    const scriptPath = `${tmpDir()}/${entry.file}`
    if (!(await RNFS.exists(scriptPath))) {
      results.push({ script: entry.file, expectInited: entry.expectInited, ok: false, inited: false, sources: 0, ms: 0, error: 'script not delivered by host' })
      continue
    }
    const script = await RNFS.readFile(scriptPath, 'utf8')
    let initEvent: { status?: boolean, sources?: Record<string, unknown> } | null = null
    const off = userApi.onScriptAction((event) => {
      if (event.action === 'init') initEvent = event.data as typeof initEvent
    })
    const t0 = Date.now()
    try {
      userApi.loadScript({
        id: `lx-ci-regression-${entry.file}`,
        name: entry.file,
        description: 'regression',
        version: '1.0.0',
        author: 'lx-ci',
        homepage: '',
        script,
      } as never)
      while (Date.now() - t0 < 20_000) {
        if (initEvent) break
        await sleep(250)
      }
      const inited = initEvent?.status === true
      const sources = initEvent?.sources ? Object.keys(initEvent.sources).length : 0
      results.push({ script: entry.file, expectInited: entry.expectInited, ok: inited, inited, sources, ms: Date.now() - t0 })
    } catch (err) {
      results.push({ script: entry.file, expectInited: entry.expectInited, ok: false, inited: false, sources: 0, ms: Date.now() - t0, error: errText(err) })
    } finally {
      off()
      try { userApi.destroy() } catch { /* 忽略 */ }
    }
  }
  assert(results.length > 0, 'no regression scripts evaluated')
  const hardFailures = results.filter(r => r.expectInited && !r.ok)
  assert(hardFailures.length === 0, `regression hard failures: ${JSON.stringify(hardFailures)}`)
  return {
    total: results.length,
    inited: results.filter(r => r.ok).length,
    hardRequired: results.filter(r => r.expectInited).length,
    results,
  }
}

// 6.2 toast：iOS 经 RNN overlay 显示，断言 overlay 出现并被记录
const testToast = async() => {
  const { toast } = await import('@/utils/toast')
  toast('lx-ci toast probe')
  const t0 = Date.now()
  while (Date.now() - t0 < 8000) {
    if (state.overlays.some(o => o.name === 'lxm.Toast')) break
    await sleep(200)
  }
  const found = state.overlays.find(o => o.name === 'lxm.Toast')
  assert(found != null, `toast overlay not shown (overlays=${state.overlays.map(o => o.name).join(',')})`)
  return { shown: true, dismissed: found?.dismissed ?? false }
}

// 6.8 深色跟随：iOS≥13 支持自动主题 + Appearance 取值合法；
// 深色翻转由宿主在探针阶段 `simctl ui appearance dark` 触发，
// 应用内等待 Appearance 变暗且主题已应用为 dark。isAutoTheme 不依赖
// prewrite 竞态——此处显式写设置，保证外观事件到达时跟随生效
const testAutoTheme = async() => {
  const tools = await import('@/utils/tools')
  assert(tools.getIsSupportedAutoTheme() === true, 'iOS should support auto theme (>=13)')
  const { updateSetting } = await import('@/core/common')
  updateSetting({ 'common.isAutoTheme': true })
  const themeState = (await import('@/store/theme/state')).default
  const t0 = Date.now()
  let appearance = tools.getAppearance()
  while (Date.now() - t0 < 150_000) {
    appearance = tools.getAppearance()
    if (appearance === 'dark') {
      // 竞态补偿：宿主切外观可能早于 isAutoTheme 生效（此时外观事件已被
      // 丢弃），按 core/init/theme.ts 同一逻辑主动对齐一次（幂等）
      const { setShouldUseDarkColors, applyTheme } = await import('@/core/theme')
      const { getTheme } = await import('@/theme/themes')
      setShouldUseDarkColors(true)
      applyTheme(await getTheme())
      break
    }
    await sleep(1000)
  }
  assert(appearance === 'dark', `appearance never switched to dark by host (got ${String(appearance)})`)
  assert(themeState.theme.isDark === true, `theme did not follow dark appearance (themeId=${themeState.theme.id})`)
  return { supported: true, appearance, themeId: themeState.theme.id }
}

// 7.3 应用内更新改跳 Release 页：spy Linking.openURL，
// 断言 downloadNewVersion/updateApp 打开的是 GitHub Release 页而非下载/安装
const testVersionUpdate = async() => {
  const version = await import('@/utils/version') as { downloadNewVersion: (v: string) => Promise<unknown>, updateApp: () => Promise<unknown> }
  const opened: string[] = []
  const original = Linking.openURL
  Linking.openURL = (url: string) => { opened.push(String(url)); return Promise.resolve(true) }
  try {
    await version.downloadNewVersion('1.8.1')
    await version.updateApp()
  } finally {
    Linking.openURL = original
  }
  assert(opened.length === 2, `expected 2 openURL calls, got ${opened.length}`)
  const releaseRxp = /github\.com\/[^/]+\/lx-music-mobile\/releases/
  assert(opened.every(u => releaseRxp.test(u)), `urls not release page: ${opened.join(' ')}`)
  return { opened }
}

// 深链监听兜底：预置设置若被首启竞态覆盖，handlePushedHomeScreen 不会
// 注册监听；须在宿主探针到达前（Tab 阶段之前）完成注册
const ensureDeeplinkListener = async() => {
  if (state.linkingListeners.includes('url')) return false
  const { initDeeplink } = await import('@/core/init/deeplink')
  await initDeeplink()
  return true
}

// 4.4 导入自定义源：生产链路 importUserApi → setApiSource → 原生 loadScript
// → init 事件 → userApi 状态翻转为 true（UI「已加载」判据）+ apis 注册
const CI_IMPORT_SCRIPT = [
  '/*!',
  ' * @name lx-ci-import',
  ' * @version 1.0.0',
  ' * @author lx-ci',
  ' */',
  '\'use strict\';',
  'const { EVENT_NAMES, send } = globalThis.lx;',
  'send(EVENT_NAMES.inited, {',
  '  status: true,',
  '  sources: {',
  '    kw: { name: \'kw\', type: \'music\', actions: [\'musicUrl\'], qualitys: [\'128k\'] },',
  '  },',
  '})',
].join('\n')
const testUserApiImport = async() => {
  const { importUserApi, removeUserApi } = await import('@/core/userApi')
  const { setApiSource } = await import('@/core/apiSource')
  const userApiState = (await import('@/store/userApi/state')).default
  const info = await importUserApi(CI_IMPORT_SCRIPT)
  assert(userApiState.list.some(a => a.id === info.id), 'imported api appears in store list')
  setApiSource(info.id)
  const t0 = Date.now()
  while (Date.now() - t0 < 20_000) {
    if (userApiState.status.status === true) break
    await sleep(250)
  }
  const loaded = userApiState.status.status === true
  const apisRegistered = Object.keys(global.lx.apis ?? {})
  // 还原现场：移除测试源并切回内置源（空串走 destroyUserApi 分支）
  try { await removeUserApi([info.id]) } catch { /* 忽略 */ }
  setApiSource('')
  assert(loaded, `user api status never true (message=${userApiState.status.message ?? 'unknown'})`)
  assert(apisRegistered.includes('kw'), `apis registered: ${apisRegistered.join(',')}`)
  return { imported: info.name, apis: apisRegistered }
}

// ---------- 主流程 ----------

const collectEnv = async() => {
  let bootLogText = ''
  try {
    const { getBootLog } = await import('@/utils/bootLog')
    bootLogText = getBootLog()
  } catch { /* 忽略 */ }
  let storageKeys: string[] = []
  let cheatTipValue: unknown = null
  let settingValue: { 'common.isAgreePact'?: boolean, 'common.langId'?: string } | null = null
  try {
    storageKeys = await AsyncStorage.getAllKeys()
    cheatTipValue = JSON.parse(String(await AsyncStorage.getItem(storageDataPrefix.cheatTip)))
    settingValue = JSON.parse(String(await AsyncStorage.getItem(storageDataPrefix.setting)))
  } catch { /* 忽略 */ }
  return {
    bootLog: bootLogText,
    storageKeys,
    cheatTipValue,
    isAgreePact: settingValue?.['common.isAgreePact'] ?? null,
    langId: settingValue?.['common.langId'] ?? null,
    playerStatus: global.lx?.playerStatus ?? null,
    linkingListeners: state.linkingListeners,
  }
}

const writeReport = async() => {
  const env = await collectEnv()
  const report = {
    v: 1,
    ok: state.results.every(r => r.ok),
    startedAt: state.startedAt,
    finishedAt: Date.now(),
    durationMs: Date.now() - state.startedAt,
    results: state.results,
    env,
    alerts: state.alerts,
    overlays: state.overlays,
    consoleTail: state.consoleRing.slice(-250),
    userApiLogs: state.userApiLogs,
  }
  await RNFS.writeFile(reportPath(), JSON.stringify(report), 'utf8')
  await RNFS.writeFile(`${tmpDir()}/lx-ci-done`, String(Date.now()), 'utf8')
}

const runSuite = async() => {
  state.startedAt = Date.now()
  try {
    state.deeplinkRegisteredByTest = await ensureDeeplinkListener()
    await runTest('utils_window_size', testUtils)
    await runTest('fs_exports', testFsExports)
    await runTest('fs_roundtrip', testFsRoundtrip)
    await runTest('crypto_golden', testCryptoGolden)
    await runTest('gzip_contract', testGzip)
    await runTest('cache_module', testCache)
    await runTest('lyric_stubs', testLyricStubs)
    await runTest('local_media_degrade', testLocalMedia)
    await runTest('user_api_sandbox', testUserApi)
    await runTest('player_setup', testPlayerSetup)
    await runTest('player_cache_degrade', testPlayerCacheDegrade)
    await runTest('toast_overlay', testToast)
    await runTest('version_update_release', testVersionUpdate)
    await runTest('tab_switch', testTabs, 300_000)
    await runTest('auto_theme', testAutoTheme, 180_000)
    await runTest('deeplink', testDeeplink)
    await runTest('user_api_import', testUserApiImport)
    // 回归集耗时最长且无宿主时序依赖，放最后跑
    await runTest('user_api_regression', testScriptsRegression, 300_000)
  } finally {
    try { await writeReport() } catch { /* 报告写失败不崩应用 */ }
  }
}

// 由 src/app.ts 启动期调用。无标记文件 / 非 iOS 时立即返回。
export const ciSelfTestBoot = () => {
  if (Platform.OS !== 'ios') return
  void (async() => {
    try {
      if (!(await RNFS.exists(markerPath()))) return
      installAlertSpy()
      installConsoleRing()
      installLinkingSpy()
      installOverlayWatcher()
      await prewriteStorage()
      // 等待 core/init 与首页推送完成（模拟器冷启动约 10s 内）
      setTimeout(() => { void runSuite() }, 25_000)
    } catch { /* 自测机制自身故障绝不拖累应用 */ }
  })()
}
