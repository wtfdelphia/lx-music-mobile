#import <Foundation/Foundation.h>

@class LxFolderScanner;

// 扫描进度与完成回调（add-ios-local-library §5.3）。
// 进度节流由模块层做（300ms）；此处按文件粒度回调。
@protocol LxFolderScannerDelegate <NSObject>
- (void)scanner:(LxFolderScanner *)scanner sourceId:(NSString *)sourceId
       phase:(NSString *)phase scanned:(NSInteger)scanned total:(NSInteger)total imported:(NSInteger)imported;
// 完成：rows 为探测成功的曲目行（供模块层批量 upsert），
// report 为扫描报告（不支持 / 未下载 / 失败 / 不可读目录）
- (void)scanner:(LxFolderScanner *)scanner sourceId:(NSString *)sourceId
  finishedWithRows:(NSArray<NSDictionary *> *)rows report:(NSDictionary *)report;
@end

// 文件夹扫描（§5.3）：
// - NSFileManager enumerator + NSFileCoordinator 一致视图（失败回退普通枚举）
// - 白名单（AVPlayer 可播放格式）；iCloud 未下载文件识别
// - 元数据并发 4：逐文件 dispatch + 信号量，探测完成即释放（F2 修复：
//   不再攒批派发，避免第 5 个文件起永久阻塞）
// - 探测结果组装为曲目行交给模块层入库（F3 修复：不再丢弃）
// - 支持取消
@interface LxFolderScanner : NSObject

@property (nonatomic, weak) id<LxFolderScannerDelegate> delegate;
@property (nonatomic, assign, readonly) BOOL scanning;

// 扫描。返回 NO 表示扫描器忙（E_SCAN_BUSY）。recursive 是否递归
- (BOOL)scanSourceId:(NSString *)sourceId rootURL:(NSURL *)sourceURL recursive:(BOOL)recursive;
- (void)cancel;

@end
