import { NativeModules } from 'react-native'
import TrackPlayer, { State } from 'react-native-track-player'
import BackgroundTimer from 'react-native-background-timer'
import { defaultUrl } from '@/config'
// import { action as playerAction } from '@/store/modules/player'
import settingState from '@/store/setting/state'
import { isAndroid } from '@/utils/tools'


const list: LX.Player.Track[] = []

const defaultUserAgent = 'Mozilla/5.0 (Linux; Android 10; Pixel 3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.79 Mobile Safari/537.36'
const httpRxp = /^(https?:\/\/.+|\/.+)/

export const state = {
  isPlaying: false,
  prevDuration: -1,
}

// iOS 队列手术守卫（任务 9.10）：fork 的 QueuedAudioPlayer.stop() 清空队列
// 并无条件发 queueIndex 事件，QueueManager.removeItem 每次索引漂移也发一件，
// 事件形状与自然播完无法区分。任何队列手术（handlePlayMusic 的 add/skip/
// remove、initTrackInfo 的 add/skip、setStop）开始前置位，全部原生操作
// 落地后释放；守卫期内 PlaybackTrackChanged 处理器（service.ts）不把
// 「当前轨为 default 兜底轨/空队列」判为播放结束，阻断
// stop→playerEnded→playNext→handlePlay→setStop 的瞬间循环
// （iPhone 17 Pro 真机 2026-09-04：点排行歌快速循环切歌、无法播放；
// run 33842498724 同款链路致全套件级联超时）。Android 侧两类手术事件
// 均为 prevIndex/track=null 形状，落在处理器 `info.track == null` 分支
// 被过滤，守卫对 Android 是恒不生效的无操作。
// 令牌语义：每次手术领取递增令牌，释放只认自己的令牌——快速连续切歌时
// 上一首的裁剪（异步）晚于下一首手术落地，其延迟释放不得覆盖新手术窗口。
// take 仅 iOS 生效：Android 的手术事件本就被处理器 `info.track == null`
// 分支过滤，守卫在 Android 恒为 false——不改变任何 Android 行为
export const queueSwitchGuard = { active: false }
let queueSwitchGuardToken = 0
export const takeQueueSwitchGuard = () => {
  if (isAndroid) return 0
  queueSwitchGuard.active = true
  return ++queueSwitchGuardToken
}
export const releaseQueueSwitchGuard = (token: number) => {
  if (token > 0 && token === queueSwitchGuardToken) queueSwitchGuard.active = false
}

// 队列镜像清空：仅 iOS 需要。fork 的 iOS stop() 经 QueuedAudioPlayer.reset
// → clearQueue 把原生队列清空但 JS 镜像无感知，下次 add 后镜像比原生多
// 一轮旧轨，getCurrentTrack（原生 index 查 JS list）从此错位。Android 的
// stop()（LocalPlayback/ExoPlayback）不清队列，镜像保持有效，清空反而
// 破坏对齐
export const resetQueueMirror = () => {
  if (isAndroid) return
  list.length = 0
}

// fork（lyswhut/react-native-track-player）iOS 侧两处实锤缺陷（任务 5.3/5.4）：
// 1. 桥接仅声明单参 updateNowPlayingMetadata:(metadata)，而 fork 的 JS wrapper
//    恒传 (metadata, playing) 两参——RCTModuleMethod 按参数个数不匹配拦截，
//    锁屏/通知栏元数据在 iOS 从未写入；
// 2. 原生实现从不调用 resolve/reject，任何 await 都会永久挂起。
// 因此 iOS 必须绕过 wrapper 直调原生单参接口，且不能等待 promise 落地。
export const updateNowPlayingMetadataIOS = (metadata: object) => {
  const native = NativeModules.TrackPlayerModule as
    { updateNowPlayingMetadata?: (metadata: object) => Promise<void> } | undefined
  native?.updateNowPlayingMetadata?.(metadata)?.catch(() => {})
}

const formatMusicInfo = (musicInfo: LX.Player.PlayMusic) => {
  return 'progress' in musicInfo ? {
    id: musicInfo.id,
    pic: musicInfo.metadata.musicInfo.meta.picUrl,
    name: musicInfo.metadata.musicInfo.name,
    singer: musicInfo.metadata.musicInfo.singer,
    album: musicInfo.metadata.musicInfo.meta.albumName,
  } : {
    id: musicInfo.id,
    pic: musicInfo.meta.picUrl,
    name: musicInfo.name,
    singer: musicInfo.singer,
    album: musicInfo.meta.albumName,
  }
}

const buildTracks = (musicInfo: LX.Player.PlayMusic, url?: LX.Player.Track['url'], duration?: LX.Player.Track['duration']): LX.Player.Track[] => {
  const mInfo = formatMusicInfo(musicInfo)
  const track = [] as LX.Player.Track[]
  const isShowNotificationImage = settingState.setting['player.isShowNotificationImage']
  const album = mInfo.album || undefined
  const artwork = isShowNotificationImage && mInfo.pic && httpRxp.test(mInfo.pic) ? mInfo.pic : undefined
  if (url) {
    track.push({
      id: `${mInfo.id}__//${Math.random()}__//${url}`,
      url,
      title: mInfo.name || 'Unknow',
      artist: mInfo.singer || 'Unknow',
      album,
      artwork,
      userAgent: defaultUserAgent,
      musicId: mInfo.id,
      // original: { ...musicInfo },
      duration,
    })
  }
  track.push({
    id: `${mInfo.id}__//${Math.random()}__//default`,
    url: defaultUrl,
    title: mInfo.name || 'Unknow',
    artist: mInfo.singer || 'Unknow',
    album,
    artwork,
    musicId: mInfo.id,
    // original: { ...musicInfo },
    duration: 0,
  })
  return track
  // console.log('buildTrack', musicInfo.name, url)
}
// const buildTrack = (musicInfo: LX.Player.PlayMusic, url: LX.Player.Track['url'], duration?: LX.Player.Track['duration']): LX.Player.Track => {
//   const mInfo = formatMusicInfo(musicInfo)
//   const isShowNotificationImage = settingState.setting['player.isShowNotificationImage']
//   const album = mInfo.album || undefined
//   const artwork = isShowNotificationImage && mInfo.pic && httpRxp.test(mInfo.pic) ? mInfo.pic : undefined
//   return url
//     ? {
//         id: `${mInfo.id}__//${Math.random()}__//${url}`,
//         url,
//         title: mInfo.name || 'Unknow',
//         artist: mInfo.singer || 'Unknow',
//         album,
//         artwork,
//         userAgent: defaultUserAgent,
//         musicId: `${mInfo.id}`,
//         original: { ...musicInfo },
//         duration,
//       }
//     : {
//         id: `${mInfo.id}__//${Math.random()}__//default`,
//         url: defaultUrl,
//         title: mInfo.name || 'Unknow',
//         artist: mInfo.singer || 'Unknow',
//         album,
//         artwork,
//         musicId: `${mInfo.id}`,
//         original: { ...musicInfo },
//         duration: 0,
//       }
// }

export const isTempTrack = (trackId: string) => /\/\/default$/.test(trackId)


export const getCurrentTrackId = async() => {
  const currentTrackIndex = await TrackPlayer.getCurrentTrack()
  return list[currentTrackIndex]?.id
}
export const getCurrentTrack = async() => {
  const currentTrackIndex = await TrackPlayer.getCurrentTrack()
  return list[currentTrackIndex]
}

export const updateMetaData = async(musicInfo: LX.Player.MusicInfo, isPlay: boolean, lyric?: string, force = false) => {
  if (!force && isPlay == state.isPlaying) {
    const duration = await TrackPlayer.getDuration()
    if (state.prevDuration != duration) {
      state.prevDuration = duration
      const trackInfo = await getCurrentTrack()
      if (trackInfo && musicInfo) {
        delayUpdateMusicInfo(musicInfo, lyric)
      }
    }
  } else {
    const [duration, trackInfo] = await Promise.all([TrackPlayer.getDuration(), getCurrentTrack()])
    state.prevDuration = duration
    if (trackInfo && musicInfo) {
      delayUpdateMusicInfo(musicInfo, lyric)
    }
  }
}

export const initTrackInfo = async(musicInfo: LX.Player.PlayMusic, mInfo: LX.Player.MusicInfo) => {
  const guardToken = takeQueueSwitchGuard()
  const tracks = buildTracks(musicInfo)
  await TrackPlayer.add(tracks).then(() => list.push(...tracks))
  const queue = await TrackPlayer.getQueue() as LX.Player.Track[]
  await TrackPlayer.skip(queue.findIndex(t => t.id == tracks[0].id))
  releaseQueueSwitchGuard(guardToken)
  delayUpdateMusicInfo(mInfo)
}


const handlePlayMusic = async(musicInfo: LX.Player.PlayMusic, url: string, time: number) => {
// console.log(tracks, time)
  const guardToken = takeQueueSwitchGuard()
  const tracks = buildTracks(musicInfo, url)
  const track = tracks[0]
  try {
    // await updateMusicInfo(track)
    const currentTrackIndex = await TrackPlayer.getCurrentTrack()
    await TrackPlayer.add(tracks).then(() => list.push(...tracks))
    const queue = await TrackPlayer.getQueue() as LX.Player.Track[]
    await TrackPlayer.skip(queue.findIndex(t => t.id == track.id))

    if (currentTrackIndex == null) {
      if (!isTempTrack(track.id as string)) {
        if (time) await TrackPlayer.seekTo(time)
        if (global.lx.restorePlayInfo) {
          await TrackPlayer.pause()
          // let startupAutoPlay = settingState.setting['player.startupAutoPlay']
          global.lx.restorePlayInfo = null

        // TODO startupAutoPlay
        // if (startupAutoPlay) store.dispatch(playerAction.playMusic())
        } else {
          await TrackPlayer.play()
        }
      }
    } else {
      await TrackPlayer.pause()
      if (!isTempTrack(track.id as string)) {
        await TrackPlayer.seekTo(time)
        await TrackPlayer.play()
      }
    }

    if (queue.length > 2) {
      // 降序删除（任务 9.9）：iOS QueueManager.removeItem 每删一个低于
      // currentIndex 的项就把 currentIndex 减 1。升序 [0,1,...] 删到第二个
      // 时，原 index 1 已漂移成 currentIndex，命中原生「不许删当前项」守卫
      // 被静默跳过——原生队列残留旧轨道、JS list 却按删净 splice，从第二首
      // 歌起索引永久错位：getCurrentTrack 返回 default 静音轨，
      // PlaybackTrackChanged 误判空队列触发暂停/切歌，正是真机「无法播放 +
      // 快速循环切歌」的机制（iOS 26.6 反馈）。降序先删高索引，偏移不会
      // 撞上待删项；Android LocalPlayback.remove 内部本就排序后倒序遍历，
      // 降序输入等价，双端安全。删除本身的索引漂移事件同样是循环点火源，
      // 守卫保持到 remove 落地（任务 9.10）
      const removeCount = queue.length - 2
      void TrackPlayer.remove(Array(removeCount).fill(null).map((_, i) => removeCount - 1 - i)).then(() => {
        list.splice(0, removeCount)
      }).catch(() => {
        // 裁剪失败不阻断：原生队列残留旧轨，下次切歌时再裁
      }).finally(() => {
        releaseQueueSwitchGuard(guardToken)
      })
    } else {
      releaseQueueSwitchGuard(guardToken)
    }
  } catch (err) {
    // 手术中途失败（add/skip reject）：守卫必须释放，否则自动切歌的
    // 播完判定被永久吞掉
    releaseQueueSwitchGuard(guardToken)
    throw err
  }
}
let playPromise = Promise.resolve()
let actionId = Math.random()
export const playMusic = (musicInfo: LX.Player.PlayMusic, url: string, time: number) => {
  const id = actionId = Math.random()
  void playPromise.finally(() => {
    if (id != actionId) return
    playPromise = handlePlayMusic(musicInfo, url, time)
  })
}

// let musicId = null
// let duration = 0
let prevArtwork: string | undefined
const updateMetaInfo = async(mInfo: LX.Player.MusicInfo, lyric?: string) => {
  console.log('updateMetaInfo', lyric)
  const isShowNotificationImage = settingState.setting['player.isShowNotificationImage']
  // const mInfo = formatMusicInfo(musicInfo)
  // console.log('+++++updateMusicPic+++++', track.artwork, track.duration)

  // if (track.musicId == musicId) {
  //   if (global.playInfo.musicInfo.img != null) artwork = global.playInfo.musicInfo.img
  //   if (track.duration != null) duration = global.playInfo.duration
  // } else {
  //   musicId = track.musicId
  //   artwork = global.playInfo.musicInfo.img
  //   duration = global.playInfo.duration || 0
  // }
  // console.log('+++++updateMetaInfo+++++', mInfo.name)
  state.isPlaying = await TrackPlayer.getState() == State.Playing
  let artwork = isShowNotificationImage ? mInfo.pic ?? prevArtwork : undefined
  if (mInfo.pic) prevArtwork = mInfo.pic
  let name: string
  let singer: string
  if (!state.isPlaying || lyric == null) {
    name = mInfo.name ?? 'Unknow'
    singer = mInfo.singer ?? 'Unknow'
  } else {
    name = lyric
    singer = `${mInfo.name}${mInfo.singer ? ` - ${mInfo.singer}` : ''}`
  }
  const metadata = {
    title: name,
    artist: singer,
    album: mInfo.album ?? undefined,
    artwork,
    duration: state.prevDuration || 0,
  }
  if (isAndroid) await TrackPlayer.updateNowPlayingMetadata(metadata, state.isPlaying)
  else updateNowPlayingMetadataIOS(metadata)
}


// 解决快速切歌导致的通知栏歌曲信息与当前播放歌曲对不上的问题
const debounceUpdateMetaInfoTools = {
  updateMetaPromise: Promise.resolve(),
  musicInfo: null as LX.Player.MusicInfo | null,
  debounce(fn: (musicInfo: LX.Player.MusicInfo, lyric?: string) => void | Promise<void>) {
    // let delayTimer = null
    let isDelayRun = false
    let timer: number | null = null
    let _musicInfo: LX.Player.MusicInfo | null = null
    let _lyric: string | undefined
    return (musicInfo: LX.Player.MusicInfo, lyric?: string) => {
      // console.log('debounceUpdateMetaInfoTools', musicInfo)
      if (timer) {
        BackgroundTimer.clearTimeout(timer)
        timer = null
      }
      // if (delayTimer) {
      //   BackgroundTimer.clearTimeout(delayTimer)
      //   delayTimer = null
      // }
      if (isDelayRun) {
        _musicInfo = musicInfo
        _lyric = lyric
        timer = BackgroundTimer.setTimeout(() => {
          timer = null
          let musicInfo = _musicInfo
          let lyric = _lyric
          _musicInfo = null
          _lyric = undefined
          if (!musicInfo) return
          // isDelayRun = false
          void fn(musicInfo, lyric)
        }, 500)
      } else {
        isDelayRun = true
        void fn(musicInfo, lyric)
        BackgroundTimer.setTimeout(() => {
          // delayTimer = null
          isDelayRun = false
        }, 500)
      }
    }
  },
  init() {
    return this.debounce(async(musicInfo: LX.Player.MusicInfo, lyric?: string) => {
      this.musicInfo = musicInfo
      return this.updateMetaPromise.then(() => {
        // console.log('run')
        if (this.musicInfo?.id === musicInfo.id) {
          this.updateMetaPromise = updateMetaInfo(musicInfo, lyric)
        }
      })
    })
  },
}

export const delayUpdateMusicInfo = debounceUpdateMetaInfoTools.init()

// export const delayUpdateMusicInfo = ((fn, delay = 800) => {
//   let delayTimer = null
//   let isDelayRun = false
//   let timer = null
//   let _track = null
//   return track => {
//     _track = track
//     if (timer) {
//       BackgroundTimer.clearTimeout(timer)
//       timer = null
//     }
//     if (isDelayRun) {
//       if (delayTimer) {
//         BackgroundTimer.clearTimeout(delayTimer)
//         delayTimer = null
//       }
//       timer = BackgroundTimer.setTimeout(() => {
//         timer = null
//         let track = _track
//         _track = null
//         isDelayRun = false
//         fn(track)
//       }, delay)
//     } else {
//       isDelayRun = true
//       fn(track)
//       delayTimer = BackgroundTimer.setTimeout(() => {
//         delayTimer = null
//         isDelayRun = false
//       }, 500)
//     }
//   }
// })(track => {
//   console.log('+++++delayUpdateMusicPic+++++', track.artwork)
//   updateMetaInfo(track)
// })
