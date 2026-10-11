/**
 * vitest 用的最小 react-native 桩。
 * 下载相关模块经 `@/config/constant`、`@/core/download/support` 引入
 * `Platform`；RN 主入口是 Flow 源码，rolldown 无法解析，
 * 测试环境整体替换为本桩（需要其他 RN API 时在此补充）
 */
export const Platform = {
  OS: 'ios',
  select: <T>(spec: { ios?: T, android?: T, default?: T }) => {
    return spec.ios ?? spec.default
  },
}

export const NativeModules = {}

export const AppState = {
  currentState: 'active',
  addEventListener: (_event: string, _handler: (...args: unknown[]) => void) => ({ remove: () => {} }),
}
export const NativeEventEmitter = class {
  addListener() {
    return { remove: () => {} }
  }
}
