#import <React/RCTEventEmitter.h>

// 本地曲库原生模块（add-ios-local-library §5）。
// 聚合 Store / FolderAccess / FolderScanner / MediaProbe / ArtworkCache /
// CredentialStore，对外暴露与 `src/core/library/native.ios.ts` 对齐的接口。
// 网络协议、调度与 UI 都在 JS 层（§3 原则 3）。
@interface LxLibraryModule : RCTEventEmitter <RCTBridgeModule>
@end
