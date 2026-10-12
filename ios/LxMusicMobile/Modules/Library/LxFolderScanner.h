#import <Foundation/Foundation.h>

@class LxFolderScanner;

// 扫描进度与完成回调（add-ios-local-library §5.3）。
// 进度节流由模块层做（300ms）；此处按文件粒度回调。
@protocol LxFolderScannerDelegate <NSObject>
- (void)scanner:(LxFolderScanner *)scanner sourceId:(NSString *)sourceId
       phase:(NSString *)phase scanned:(NSInteger)scanned total:(NSInteger)total imported:(NSInteger)imported;
- (void)scanner:(LxFolderScanner *)scanner sourceId:(NSString *)sourceId finishedWithReport:(NSDictionary *)report;
@end

// 文件夹扫描（§5.3）：
// - NSFileManager enumerator + NSFileCoordinator 一致视图（失败回退普通枚举）
// - 白名单（AVPlayer 可播放格式）；iCloud 未下载文件识别
// - 增量：size + mtime 不变跳过元数据读取
// - 删除保护：读不到的子目录记录到 unreadable，finishSync 不清理
// - 并发 4 读元数据；支持取消
@interface LxFolderScanner : NSObject

@property (nonatomic, weak) id<LxFolderScannerDelegate> delegate;
@property (nonatomic, assign, readonly) BOOL scanning;

// 扫描。sourceURL 为来源根，recursive 是否递归
- (void)scanSourceId:(NSString *)sourceId rootURL:(NSURL *)sourceURL recursive:(BOOL)recursive;
- (void)cancel;

@end
