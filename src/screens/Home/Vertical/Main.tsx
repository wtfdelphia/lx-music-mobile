import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react'
import { View } from 'react-native'
import Search from '../Views/Search'
import SongList from '../Views/SongList'
import Mylist from '../Views/Mylist'
import Leaderboard from '../Views/Leaderboard'
import Download from '../Views/Download'
import Setting from '../Views/Setting'
import { NAV_MENUS, type NAV_ID_Type } from '@/config/constant'
import commonState, { type InitState as CommonState } from '@/store/common/state'
import { createStyle } from '@/utils/tools'
import PagerView, { type PageScrollStateChangedNativeEvent, type PagerViewOnPageSelectedEvent } from 'react-native-pager-view'
import { setNavActiveId } from '@/core/common'
import settingState from '@/store/setting/state'

const hideKeys = [
  'list.isShowAlbumName',
  'list.isShowInterval',
  'theme.fontShadow',
] as Readonly<Array<keyof LX.AppSetting>>

const SearchPage = () => {
  const [visible, setVisible] = useState(commonState.navActiveId == 'nav_search')
  const component = useMemo(() => <Search />, [])
  useEffect(() => {
    let currentId: CommonState['navActiveId'] = commonState.navActiveId
    const handleNavIdUpdate = (id: CommonState['navActiveId']) => {
      currentId = id
      if (id == 'nav_search') {
        requestAnimationFrame(() => {
          setVisible(true)
        })
      }
    }
    const handleHide = () => {
      if (currentId != 'nav_setting') return
      setVisible(false)
    }
    const handleConfigUpdated = (keys: Array<keyof LX.AppSetting>) => {
      if (keys.some(k => hideKeys.includes(k))) handleHide()
    }
    global.state_event.on('navActiveIdUpdated', handleNavIdUpdate)
    global.state_event.on('themeUpdated', handleHide)
    global.state_event.on('languageChanged', handleHide)
    global.state_event.on('configUpdated', handleConfigUpdated)

    return () => {
      global.state_event.off('navActiveIdUpdated', handleNavIdUpdate)
      global.state_event.off('themeUpdated', handleHide)
      global.state_event.off('languageChanged', handleHide)
      global.state_event.off('configUpdated', handleConfigUpdated)
    }
  }, [])

  return visible ? component : null
}
const SongListPage = () => {
  const [visible, setVisible] = useState(commonState.navActiveId == 'nav_songlist')
  const component = useMemo(() => <SongList />, [])
  useEffect(() => {
    let currentId: CommonState['navActiveId'] = commonState.navActiveId
    const handleNavIdUpdate = (id: CommonState['navActiveId']) => {
      currentId = id
      if (id == 'nav_songlist') {
        requestAnimationFrame(() => {
          setVisible(true)
        })
      }
    }
    const handleHide = () => {
      if (currentId != 'nav_setting') return
      setVisible(false)
    }
    const handleConfigUpdated = (keys: Array<keyof LX.AppSetting>) => {
      if (keys.some(k => hideKeys.includes(k))) handleHide()
    }
    global.state_event.on('navActiveIdUpdated', handleNavIdUpdate)
    global.state_event.on('themeUpdated', handleHide)
    global.state_event.on('languageChanged', handleHide)
    global.state_event.on('configUpdated', handleConfigUpdated)

    return () => {
      global.state_event.off('navActiveIdUpdated', handleNavIdUpdate)
      global.state_event.off('themeUpdated', handleHide)
      global.state_event.off('languageChanged', handleHide)
      global.state_event.on('configUpdated', handleConfigUpdated)
    }
  }, [])

  return visible ? component : null
  // return activeId == 1 || activeId == 0  ? SongList : null
}
const LeaderboardPage = () => {
  const [visible, setVisible] = useState(commonState.navActiveId == 'nav_top')
  const component = useMemo(() => <Leaderboard />, [])
  useEffect(() => {
    let currentId: CommonState['navActiveId'] = commonState.navActiveId
    const handleNavIdUpdate = (id: CommonState['navActiveId']) => {
      currentId = id
      if (id == 'nav_top') {
        requestAnimationFrame(() => {
          setVisible(true)
        })
      }
    }
    const handleHide = () => {
      if (currentId != 'nav_setting') return
      setVisible(false)
    }
    const handleConfigUpdated = (keys: Array<keyof LX.AppSetting>) => {
      if (keys.some(k => hideKeys.includes(k))) handleHide()
    }
    global.state_event.on('navActiveIdUpdated', handleNavIdUpdate)
    global.state_event.on('themeUpdated', handleHide)
    global.state_event.on('languageChanged', handleHide)
    global.state_event.on('configUpdated', handleConfigUpdated)

    return () => {
      global.state_event.off('navActiveIdUpdated', handleNavIdUpdate)
      global.state_event.off('themeUpdated', handleHide)
      global.state_event.off('languageChanged', handleHide)
      global.state_event.on('configUpdated', handleConfigUpdated)
    }
  }, [])

  return visible ? component : null
}
const MylistPage = () => {
  const [visible, setVisible] = useState(commonState.navActiveId == 'nav_love')
  const component = useMemo(() => <Mylist />, [])
  useEffect(() => {
    let currentId: CommonState['navActiveId'] = commonState.navActiveId
    const handleNavIdUpdate = (id: CommonState['navActiveId']) => {
      currentId = id
      if (id == 'nav_love') {
        requestAnimationFrame(() => {
          setVisible(true)
        })
      }
    }
    const handleHide = () => {
      if (currentId != 'nav_setting') return
      setVisible(false)
    }
    const handleConfigUpdated = (keys: Array<keyof LX.AppSetting>) => {
      if (keys.some(k => hideKeys.includes(k))) handleHide()
    }
    global.state_event.on('navActiveIdUpdated', handleNavIdUpdate)
    global.state_event.on('themeUpdated', handleHide)
    global.state_event.on('languageChanged', handleHide)
    global.state_event.on('configUpdated', handleConfigUpdated)

    return () => {
      global.state_event.off('navActiveIdUpdated', handleNavIdUpdate)
      global.state_event.off('themeUpdated', handleHide)
      global.state_event.off('languageChanged', handleHide)
      global.state_event.on('configUpdated', handleConfigUpdated)
    }
  }, [])

  return visible ? component : null
}
const DownloadPage = () => {
  const [visible, setVisible] = useState(commonState.navActiveId == 'nav_download')
  const component = useMemo(() => <Download />, [])
  useEffect(() => {
    const handleNavIdUpdate = (id: CommonState['navActiveId']) => {
      if (id == 'nav_download') {
        requestAnimationFrame(() => {
          setVisible(true)
        })
      }
    }
    global.state_event.on('navActiveIdUpdated', handleNavIdUpdate)

    return () => {
      global.state_event.off('navActiveIdUpdated', handleNavIdUpdate)
    }
  }, [])
  return visible ? component : null
}
const SettingPage = () => {
  const [visible, setVisible] = useState(commonState.navActiveId == 'nav_setting')
  const component = useMemo(() => <Setting />, [])
  useEffect(() => {
    const handleNavIdUpdate = (id: CommonState['navActiveId']) => {
      if (id == 'nav_setting') {
        requestAnimationFrame(() => {
          setVisible(true)
        })
      }
    }
    global.state_event.on('navActiveIdUpdated', handleNavIdUpdate)

    return () => {
      global.state_event.off('navActiveIdUpdated', handleNavIdUpdate)
    }
  }, [])
  return visible ? component : null
}

// §10.1：由平台导航列表生成，iOS 含下载页、Android 不含
const indexMap = NAV_MENUS.map(menu => menu.id)
const viewMap: Partial<Record<NAV_ID_Type, number>> = {}
NAV_MENUS.forEach((menu, i) => {
  viewMap[menu.id] = i
})

const pageComponents: Partial<Record<NAV_ID_Type, JSX.Element>> = {
  nav_search: <SearchPage />,
  nav_songlist: <SongListPage />,
  nav_top: <LeaderboardPage />,
  nav_love: <MylistPage />,
  nav_download: <DownloadPage />,
  nav_setting: <SettingPage />,
}

const Main = () => {
  const pagerViewRef = useRef<ComponentRef<typeof PagerView>>(null)
  let activeIndexRef = useRef(viewMap[commonState.navActiveId] ?? 0)
  // const isScrollingRef = useRef(false)
  // const scrollPositionRef = useRef(-1)

  // const handlePageScroll = useCallback(({ nativeEvent }) => {
  //   console.log(nativeEvent.offset, activeIndexRef.current)
  //   // if (activeIndexRef.current == -1) return
  //   // if (nativeEvent.offset == 0) {
  //   //   isScrollingRef.current = false

  //   //   const index = nativeEvent.position
  //   //   if (activeIndexRef.current == index) return
  //   //   activeIndexRef.current = index
  //   //   setNavActiveIndex(index)
  //   // } else if (!isScrollingRef.current) {
  //   //   isScrollingRef.current = true
  //   // }
  // }, [setNavActiveIndex])

  const onPageSelected = useCallback(({ nativeEvent }: PagerViewOnPageSelectedEvent) => {
    // console.log(nativeEvent)
    activeIndexRef.current = nativeEvent.position
    if (activeIndexRef.current != viewMap[commonState.navActiveId]) {
      const id = indexMap[activeIndexRef.current]
      if (id) setNavActiveId(id)
    }
  }, [])

  const onPageScrollStateChanged = useCallback(({ nativeEvent }: PageScrollStateChangedNativeEvent) => {
    // console.log(nativeEvent)
    const idle = nativeEvent.pageScrollState == 'idle'
    if (global.lx.homePagerIdle != idle) global.lx.homePagerIdle = idle
    // if (nativeEvent.pageScrollState != 'idle') return
    // if (scrollPositionRef.current != commonState.navActiveIndex) {
    //   setNavActiveIndex(scrollPositionRef.current)
    // }
    // if (activeIndexRef.current == -1) return
    // if (nativeEvent.offset == 0) {
    //   isScrollingRef.current = false

    //   const index = nativeEvent.position
    //   if (activeIndexRef.current == index) return
    //   activeIndexRef.current = index
    //   setNavActiveIndex(index)
    // } else if (!isScrollingRef.current) {
    //   isScrollingRef.current = true
    // }
  }, [])

  useEffect(() => {
    const handleUpdate = (id: CommonState['navActiveId']) => {
      const index = viewMap[id]
      if (index == null || activeIndexRef.current == index) return
      activeIndexRef.current = index
      pagerViewRef.current?.setPageWithoutAnimation(index)
    }
    const handleConfigUpdate = (keys: Array<keyof LX.AppSetting>, setting: Partial<LX.AppSetting>) => {
      if (!keys.includes('common.homePageScroll')) return
      pagerViewRef.current?.setScrollEnabled(setting['common.homePageScroll']!)
    }
    // window.requestAnimationFrame(() => pagerViewRef.current && pagerViewRef.current.setPage(activeIndexRef.current))
    global.state_event.on('navActiveIdUpdated', handleUpdate)
    global.state_event.on('configUpdated', handleConfigUpdate)
    return () => {
      global.state_event.off('navActiveIdUpdated', handleUpdate)
      global.state_event.off('configUpdated', handleConfigUpdate)
    }
  }, [])


  const component = useMemo(() => (
    <PagerView ref={pagerViewRef}
      initialPage={activeIndexRef.current}
      // onPageScroll={handlePageScroll}
      offscreenPageLimit={1}
      onPageSelected={onPageSelected}
      onPageScrollStateChanged={onPageScrollStateChanged}
      scrollEnabled={settingState.setting['common.homePageScroll']}
      style={styles.pagerView}
    >
      {NAV_MENUS.map(menu => (
        <View collapsable={false} key={menu.id} style={styles.pageStyle}>
          {pageComponents[menu.id]}
        </View>
      ))}
      {/* <View collapsable={false} key="nav_search" style={styles.pageStyle}>
        <Search />
      </View>
      <View collapsable={false} key="nav_songlist" style={styles.pageStyle}>
        <SongList />
      </View>
      <View collapsable={false} key="nav_top" style={styles.pageStyle}>
        <Leaderboard />
      </View>
      <View collapsable={false} key="nav_love" style={styles.pageStyle}>
        <Mylist />
      </View>
      <View collapsable={false} key="nav_setting" style={styles.pageStyle}>
        <Setting />
      </View> */}
    </PagerView>
  ), [onPageScrollStateChanged, onPageSelected])

  return component
}

const styles = createStyle({
  pagerView: {
    flex: 1,
    overflow: 'hidden',
  },
  pageStyle: {
    // alignItems: 'center',
    // padding: 20,
  },
})


export default Main

