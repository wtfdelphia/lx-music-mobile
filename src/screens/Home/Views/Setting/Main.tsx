import { forwardRef, useImperativeHandle, useMemo, useState } from 'react'
import { Platform } from 'react-native'

import Basic from './settings/Basic'
import Player from './settings/Player'
import LyricDesktop from './settings/LyricDesktop'
import Search from './settings/Search'
import List from './settings/List'
import Sync from './settings/Sync'
import Backup from './settings/Backup'
import Other from './settings/Other'
import Version from './settings/Version'
import About from './settings/About'

const ALL_SETTING_SCREENS = [
  'basic',
  'player',
  'lyric_desktop',
  'search',
  'list',
  'sync',
  'backup',
  'other',
  'version',
  'about',
] as const

export type SettingScreenIds = typeof ALL_SETTING_SCREENS[number]

// 任务 7.1：iOS 无桌面歌词，设置导航整组隐藏
export const SETTING_SCREENS: SettingScreenIds[] = Platform.OS === 'ios'
  ? ALL_SETTING_SCREENS.filter(id => id !== 'lyric_desktop')
  : [ ...ALL_SETTING_SCREENS ]

// interface MainProps {
//   onUpdateActiveId: (id: string) => void
// }
export interface MainType {
  setActiveId: (id: SettingScreenIds) => void
}

const Main = forwardRef<MainType, {}>((props, ref) => {
  const [id, setId] = useState(global.lx.settingActiveId)

  useImperativeHandle(ref, () => ({
    setActiveId(id) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setId(id)
        })
      })
    },
  }))

  const component = useMemo(() => {
    switch (id) {
      case 'player': return <Player />
      case 'lyric_desktop': return <LyricDesktop />
      case 'search': return <Search />
      case 'list': return <List />
      case 'sync': return <Sync />
      case 'backup': return <Backup />
      case 'other': return <Other />
      case 'version': return <Version />
      case 'about': return <About />
      case 'basic':
      default: return <Basic />
    }
  }, [id])

  return component
})


export default Main
