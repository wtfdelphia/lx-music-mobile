import { useEffect, useState } from 'react'
import state from './state'

export const useDownloadList = () => {
  const [list, setList] = useState(state.downloadList)

  useEffect(() => {
    const handleUpdate = () => {
      // 调度器原地改任务字段、对象引用不变；浅克隆出快照，
      // 使 ListItem 的 memo 比较器能对比出前后差异触发重渲染
      setList(state.downloadList.map(t => ({ ...t })))
    }
    global.app_event.on('downloadListUpdate', handleUpdate)
    return () => {
      global.app_event.off('downloadListUpdate', handleUpdate)
    }
  }, [])

  return list
}
