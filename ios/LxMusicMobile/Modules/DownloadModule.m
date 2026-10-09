#import "DownloadModule.h"
#import "LxDownloadManager.h"

@implementation DownloadModule {
  BOOL _hasListeners;
}

RCT_EXPORT_MODULE()

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (instancetype)init
{
  if (self = [super init]) {
    // 订阅 manager 事件，转成 LxDownloadEvent 发给 JS（§4.9）
    __weak typeof(self) weakSelf = self;
    [[LxDownloadManager shared] addEventHandler:^(LxDownloadEvent *event) {
      __strong typeof(weakSelf) strongSelf = weakSelf;
      if (!strongSelf) return;
      dispatch_async(dispatch_get_main_queue(), ^{
        if (strongSelf->_hasListeners) {
          [strongSelf sendEventWithName:@"LxDownloadEvent" body:@{
            @"type": event.type,
            @"data": event.data ?: @{},
          }];
        }
      });
    }];
  }
  return self;
}

#pragma mark - RCTEventEmitter

- (NSArray<NSString *> *)supportedEvents
{
  return @[ @"LxDownloadEvent" ];
}

- (void)startObserving
{
  _hasListeners = YES;
}

- (void)stopObserving
{
  _hasListeners = NO;
}

#pragma mark - JS 接口（§4.8）

// 占位：P1a 最小集仅实现 start / cancel / removeResumeData /
// getActiveTasks / drainEvents / ack。pause / resume 属 P1b，
// 此处显式拒绝，契约见 engine.ios.ts
RCT_EXPORT_METHOD(configure:(NSDictionary *)opts
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  resolve(nil);
}

RCT_EXPORT_METHOD(start:(NSDictionary *)task
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  NSString *taskId = task[@"taskId"];
  NSString *url = task[@"url"];
  NSString *targetPath = task[@"targetPath"];
  BOOL allowsCellular = [task[@"allowsCellular"] boolValue];
  NSDictionary *headers = task[@"headers"];
  if (!taskId || !url || !targetPath) {
    reject(@"E_INVALID_ARGS", @"taskId / url / targetPath are required", nil);
    return;
  }
  [[LxDownloadManager shared] startTaskId:taskId url:url targetPath:targetPath
                           allowsCellular:allowsCellular headers:headers];
  resolve(nil);
}

RCT_EXPORT_METHOD(pause:(NSString *)taskId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  [[LxDownloadManager shared] pauseTaskId:taskId];
  resolve(@{ @"hasResumeData": @YES });
}

RCT_EXPORT_METHOD(resume:(NSString *)taskId
                  allowsCellular:(BOOL)allowsCellular
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  [[LxDownloadManager shared] resumeTaskId:taskId allowsCellular:allowsCellular];
  resolve(@YES);
}

RCT_EXPORT_METHOD(cancel:(NSString *)taskId
                  removeResumeData:(BOOL)removeResumeData
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  [[LxDownloadManager shared] cancelTaskId:taskId removeResumeData:removeResumeData];
  resolve(nil);
}

RCT_EXPORT_METHOD(removeResumeData:(NSString *)taskId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  [[LxDownloadManager shared] removeResumeDataForTaskId:taskId];
  resolve(nil);
}

RCT_EXPORT_METHOD(getActiveTasks:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  [[LxDownloadManager shared] getActiveTasksWithCompletion:^(NSArray<NSDictionary *> *tasks) {
    resolve(tasks);
  }];
}

RCT_EXPORT_METHOD(drainEvents:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  [[LxDownloadManager shared] drainEventsWithCompletion:^(NSArray<NSDictionary *> *events) {
    resolve(events);
  }];
}

RCT_EXPORT_METHOD(ack:(NSInteger)lastSeq
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  [[LxDownloadManager shared] ackEventsUpToSeq:lastSeq];
  resolve(nil);
}

@end
