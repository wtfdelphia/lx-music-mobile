/**
 * 曲库状态 hook（add-ios-local-library §6）。
 * 与 `store/download/hook.ts` 同模式：订阅事件，浅克隆触发重渲染
 */
import { useEffect, useState } from 'react'
import state from './state'
import type { LibrarySource, NativeTrackRow, LibraryScanReport } from '@/core/library/types'
import type { ScanProgress } from './state'

export const useLibrarySources = (): LibrarySource[] => {
  const [sources, setSources] = useState(state.sources)
  useEffect(() => {
    const handleUpdate = () => { setSources([...state.sources]) }
    global.app_event.on('librarySourcesUpdated', handleUpdate)
    return () => {
      global.app_event.off('librarySourcesUpdated', handleUpdate)
    }
  }, [])
  return sources
}

export const useLibraryRows = (): { rows: NativeTrackRow[], total: number } => {
  const [rows, setRows] = useState({ rows: state.rows, total: state.rowsTotal })
  useEffect(() => {
    const handleUpdate = () => { setRows({ rows: [...state.rows], total: state.rowsTotal }) }
    global.app_event.on('libraryRowsUpdated', handleUpdate)
    return () => {
      global.app_event.off('libraryRowsUpdated', handleUpdate)
    }
  }, [])
  return rows
}

export const useScanProgress = (): Record<string, ScanProgress | undefined> => {
  const [progress, setProgress] = useState(state.scanProgress)
  useEffect(() => {
    const handleUpdate = () => { setProgress({ ...state.scanProgress }) }
    global.app_event.on('libraryScanProgressUpdated', handleUpdate)
    return () => {
      global.app_event.off('libraryScanProgressUpdated', handleUpdate)
    }
  }, [])
  return progress
}

export const useScanReport = (sourceId: string): LibraryScanReport | null => {
  const [report, setReport] = useState<LibraryScanReport | null>(state.scanReports[sourceId] ?? null)
  useEffect(() => {
    const handleUpdate = () => { setReport(state.scanReports[sourceId] ?? null) }
    global.app_event.on('librarySourcesUpdated', handleUpdate)
    return () => {
      global.app_event.off('librarySourcesUpdated', handleUpdate)
    }
  }, [sourceId])
  return report
}
