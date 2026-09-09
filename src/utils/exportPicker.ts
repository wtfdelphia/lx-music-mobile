// 导出位置选择的平台扩展（任务 9.16）：基名文件为 Android 实现，
// iOS 走 exportPicker.ios.ts（Metro 平台扩展解析，同 fs.ts / fs.ios.ts 模式）。
// Android 导出保持「选目录 → 写入」，系统另存为面板为 iOS 专属；
// 本侧函数不会被调用，显式抛错防止误用。
// 注：基名文件必须存在——tsc 不做平台扩展解析，共享代码 import
// '@/utils/exportPicker' 时基名缺失会新增 Cannot find module 错误
// （toast 基名缺失的两条既有错误即同款，见 AGENTS.md 类型检查现状）

export const systemExportPicker = false

export const saveViaSystemExportPicker = async(_fileName: string, _data: any): Promise<{ saved: boolean, path: string | null }> => {
  throw new Error('saveViaSystemExportPicker is iOS only')
}
