import { useEffect, useState } from 'react'
import state from './state'

export const useDownloadList = () => {
  const [list, setList] = useState(state.downloadList)

  useEffect(() => {
    const handleUpdate = () => {
      setList([...state.downloadList])
    }
    global.app_event.on('downloadListUpdate', handleUpdate)
    return () => {
      global.app_event.off('downloadListUpdate', handleUpdate)
    }
  }, [])

  return list
}
