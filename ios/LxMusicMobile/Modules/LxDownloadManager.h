#import <Foundation/Foundation.h>

// 下载传输层（add-ios-download §4）。纯 ObjC 单例：持有固定 identifier 的
// 后台会话并自担 delegate，move 文件、写事件日志，全程不依赖 RN 在场。
// 后台唤醒时 didFinishLaunching 先于 handleEventsForBackgroundURLSession，
// 此时 JS 可能未加载，故传输逻辑必须脱离 bridge 独立可用（§4.1）。
NS_ASSUME_NONNULL_BEGIN

// 引擎事件，与 src/core/download/engine.ios.ts 的 EngineLiveEvent 对齐
@interface LxDownloadEvent : NSObject
@property (nonatomic, copy) NSString *type;   // start / progress / complete / error / bgFinished
@property (nonatomic, strong) NSDictionary *data;
@end

typedef void (^LxDownloadEventHandler)(LxDownloadEvent *event);

@interface LxDownloadManager : NSObject

+ (instancetype)shared;

// 订阅事件（DownloadModule 调用）。返回取消订阅块
- (void)addEventHandler:(LxDownloadEventHandler)handler;

// JS 接口（§4.8）
- (void)startTaskId:(NSString *)taskId
                url:(NSString *)url
         targetPath:(NSString *)targetPath
     allowsCellular:(BOOL)allowsCellular
            headers:(nullable NSDictionary<NSString *, NSString *> *)headers;
- (void)pauseTaskId:(NSString *)taskId;
- (void)resumeTaskId:(NSString *)taskId allowsCellular:(BOOL)allowsCellular;
- (void)cancelTaskId:(NSString *)taskId removeResumeData:(BOOL)removeResumeData;
- (void)removeResumeDataForTaskId:(NSString *)taskId;
- (void)getActiveTasksWithCompletion:(void (^)(NSArray<NSDictionary *> *tasks))completion;
- (void)drainEventsWithCompletion:(void (^)(NSArray<NSDictionary *> *events))completion;
- (void)ackEventsUpToSeq:(NSInteger)seq;

// AppDelegate 后台会话交接（§4.1）
- (void)handleBackgroundSession:(NSString *)identifier
             completionHandler:(void (^)(void))completionHandler;

@end

NS_ASSUME_NONNULL_END
