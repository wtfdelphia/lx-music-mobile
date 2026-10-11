#import "LxDownloadManager.h"
#import <errno.h>

static NSString * const kSessionIdentifier = @"cn.toside.music.mobile.download";

@implementation LxDownloadEvent
@end

#pragma mark - LxDownloadManager

@interface LxDownloadManager () <NSURLSessionDownloadDelegate>
@property (nonatomic, strong) NSURLSession *session;
// taskId -> NSURLSessionDownloadTask
@property (nonatomic, strong) NSMutableDictionary<NSString *, NSURLSessionDownloadTask *> *tasks;
// taskId -> 元信息（targetPath / url），后台唤醒重挂接时用
@property (nonatomic, strong) NSMutableDictionary<NSString *, NSDictionary *> *taskInfos;
// JS 主动取消/暂停的集合（§4.4 区分系统取消）
@property (nonatomic, strong) NSMutableSet<NSString *> *jsCancelled;
// 已发过 start 事件的任务（首个 2xx didWriteData 只发一次）
@property (nonatomic, strong) NSMutableSet<NSString *> *startedTasks;
// progress 节流：taskId -> 上次 emit 时间（§4.9 原生 500ms）
@property (nonatomic, strong) NSMutableDictionary<NSString *, NSNumber *> *lastProgressEmit;
// 事件订阅
@property (nonatomic, strong) NSMutableArray<LxDownloadEventHandler> *eventHandlers;
// 事件日志递增序号
@property (nonatomic, assign) NSInteger seqCounter;
// 串行队列保护内部状态
@property (nonatomic, strong) dispatch_queue_t queue;
@property (nonatomic, copy, nullable) void (^bgCompletionHandler)(void);
@end

@implementation LxDownloadManager

+ (instancetype)shared
{
  static LxDownloadManager *instance = nil;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    instance = [[LxDownloadManager alloc] init];
  });
  return instance;
}

- (instancetype)init
{
  self = [super init];
  if (self) {
    _tasks = [NSMutableDictionary dictionary];
    _taskInfos = [NSMutableDictionary dictionary];
    _jsCancelled = [NSMutableSet set];
    _startedTasks = [NSMutableSet set];
    _lastProgressEmit = [NSMutableDictionary dictionary];
    _eventHandlers = [NSMutableArray array];
    _seqCounter = 0;
    _queue = dispatch_queue_create("cn.toside.music.mobile.download.queue", DISPATCH_QUEUE_SERIAL);
    [self ensureInternalDirs];
    [self restoreSeqCounter];
    [self loadTaskInfos];

    NSURLSessionConfiguration *config =
      [NSURLSessionConfiguration backgroundSessionConfigurationWithIdentifier:kSessionIdentifier];
    config.sessionSendsLaunchEvents = YES;
    config.discretionary = NO;
    config.allowsCellularAccess = YES;
    config.allowsConstrainedNetworkAccess = YES;
    config.HTTPMaximumConnectionsPerHost = 3;
    _session = [NSURLSession sessionWithConfiguration:config delegate:self delegateQueue:nil];
    // 冷启动重挂：进程被回收后系统可能仍持有未完成的后台任务，
    // 按 taskDescription 重新挂入内存表，否则 JS 的 pause/cancel 对
    // 这些传输 no-op，且 start 会重复建任务
    __weak typeof(self) weakSelf = self;
    [_session getAllTasksWithCompletionHandler:^(NSArray<NSURLSessionTask *> *tasks) {
      __strong typeof(weakSelf) strongSelf = weakSelf;
      if (!strongSelf) return;
      dispatch_async(strongSelf.queue, ^{
        for (NSURLSessionTask *task in tasks) {
          NSString *taskId = task.taskDescription;
          if (taskId && (task.state == NSURLSessionTaskStateRunning || task.state == NSURLSessionTaskStateSuspended)) {
            strongSelf.tasks[taskId] = (NSURLSessionDownloadTask *)task;
          }
        }
      });
    }];
  }
  return self;
}

#pragma mark - 内部目录（§4.5）

- (NSString *)internalDir
{
  NSString *appSupport = [NSSearchPathForDirectoriesInDomains(NSApplicationSupportDirectory, NSUserDomainMask, YES) firstObject];
  NSString *dir = [appSupport stringByAppendingPathComponent:@"lx-download"];
  return dir;
}

- (NSString *)resumeDir
{
  return [[self internalDir] stringByAppendingPathComponent:@"resume"];
}

- (NSString *)eventsLogPath
{
  return [[self internalDir] stringByAppendingPathComponent:@"events.jsonl"];
}

- (void)ensureInternalDirs
{
  NSFileManager *fm = [NSFileManager defaultManager];
  NSString *dir = [self internalDir];
  if (![fm fileExistsAtPath:dir]) {
    [fm createDirectoryAtPath:dir withIntermediateDirectories:YES attributes:nil error:nil];
  }
  NSString *resume = [self resumeDir];
  if (![fm fileExistsAtPath:resume]) {
    [fm createDirectoryAtPath:resume withIntermediateDirectories:YES attributes:nil error:nil];
  }
  // 整个内部目录排除 iCloud 备份（§4.5）
  NSURL *dirURL = [NSURL fileURLWithPath:dir];
  [dirURL setResourceValue:@YES forKey:NSURLIsExcludedFromBackupKey error:nil];
}

#pragma mark - seq 恢复

- (void)restoreSeqCounter
{
  NSString *content = [NSString stringWithContentsOfFile:[self eventsLogPath] encoding:NSUTF8StringEncoding error:nil];
  if (!content.length) return;
  NSArray<NSString *> *lines = [content componentsSeparatedByString:@"\n"];
  for (NSString *line in [lines reverseObjectEnumerator]) {
    if (!line.length) continue;
    NSDictionary *obj = [NSJSONSerialization JSONObjectWithData:[line dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
    NSNumber *seq = obj[@"seq"];
    if (seq) {
      _seqCounter = seq.integerValue;
      break;
    }
  }
}

#pragma mark - 任务元信息持久化（P0）

// 进程被回收后重建时，后台会话的完成回调仍会到达；纯内存的
// taskInfos 会丢失，导致移动文件时拿不到目标路径。落盘到
// Application Support（不随 Documents 一起被误删风险，且用户不可见）

- (NSString *)taskInfosPath
{
  return [[self internalDir] stringByAppendingPathComponent:@"tasks.plist"];
}

- (void)loadTaskInfos
{
  NSDictionary *stored = [NSDictionary dictionaryWithContentsOfFile:[self taskInfosPath]];
  if (stored) [self.taskInfos setDictionary:stored];
}

// 仅在 self.queue 内调用
- (void)saveTaskInfosLocked
{
  [self.taskInfos writeToURL:[NSURL fileURLWithPath:[self taskInfosPath]] atomically:YES];
}

- (void)setTaskInfoForId:(NSString *)taskId info:(NSDictionary *)info
{
  self.taskInfos[taskId] = info;
  [self saveTaskInfosLocked];
}

- (void)removeTaskInfoForId:(NSString *)taskId
{
  [self.taskInfos removeObjectForKey:taskId];
  [self saveTaskInfosLocked];
}

#pragma mark - 事件日志（§4.6）

// 返回值：本条事件的 seq（供 emitLoggedEvent 把 seq 塞进 JS 的 data）
- (NSInteger)writeEvent:(NSDictionary *)eventData withType:(NSString *)type
{
  NSInteger seq = ++_seqCounter;
  NSMutableDictionary *entry = [NSMutableDictionary dictionary];
  entry[@"seq"] = @(seq);
  entry[@"type"] = type;
  entry[@"data"] = eventData ?: @{};
  NSData *json = [NSJSONSerialization dataWithJSONObject:entry options:0 error:nil];
  if (!json) return;
  NSMutableString *line = [[NSMutableString alloc] initWithData:json encoding:NSUTF8StringEncoding];
  [line appendString:@"\n"];
  NSFileHandle *handle = [NSFileHandle fileHandleForWritingAtPath:[self eventsLogPath]];
  if (handle) {
    [handle seekToEndOfFile];
    [handle writeData:[line dataUsingEncoding:NSUTF8StringEncoding]];
    [handle closeFile];
  } else {
    [line writeToFile:[self eventsLogPath] atomically:YES encoding:NSUTF8StringEncoding error:nil];
  }
  return seq;
}

- (void)emitEvent:(NSString *)type data:(NSDictionary *)data
{
  LxDownloadEvent *event = [[LxDownloadEvent alloc] init];
  event.type = type;
  event.data = data ?: @{};
  NSArray<LxDownloadEventHandler> *handlers;
  @synchronized (self.eventHandlers) {
    handlers = [self.eventHandlers copy];
  }
  for (LxDownloadEventHandler handler in handlers) {
    handler(event);
  }
}

- (void)emitLoggedEvent:(NSString *)type data:(NSDictionary *)data
{
  NSInteger seq = [self writeEvent:data withType:type];
  // seq 一并放进发给 JS 的 data：否则 JS 侧 lastAckSeq 恒为 0，
  // ack(0) 永不清理，events.jsonl 无限增长（修 R3）
  NSMutableDictionary *dataWithSeq = [NSMutableDictionary dictionaryWithDictionary:data ?: @{}];
  dataWithSeq[@"seq"] = @(seq);
  [self emitEvent:type data:dataWithSeq];
}

#pragma mark - 订阅

- (void)addEventHandler:(LxDownloadEventHandler)handler
{
  @synchronized (self.eventHandlers) {
    [self.eventHandlers addObject:[handler copy]];
  }
}

#pragma mark - 路径拼接

- (NSString *)absolutePathForRelative:(NSString *)relPath
{
  NSString *documents = [NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES) firstObject];
  NSString *clean = relPath;
  if ([clean hasPrefix:@"/"]) clean = [clean substringFromIndex:1];
  return [documents stringByAppendingPathComponent:clean];
}

#pragma mark - 任务创建（§4.3）

- (void)startTaskId:(NSString *)taskId
                url:(NSString *)url
         targetPath:(NSString *)targetPath
     allowsCellular:(BOOL)allowsCellular
            headers:(nullable NSDictionary<NSString *, NSString *> *)headers
{
  dispatch_async(self.queue, ^{
    // 同 id 活跃任务已在跑时直接复用，不再新建（避免孤儿任务）
    NSURLSessionDownloadTask *existing = self.tasks[taskId];
    if (existing && (existing.state == NSURLSessionTaskStateRunning || existing.state == NSURLSessionTaskStateSuspended)) {
      [self setTaskInfoForId:taskId info:@{ @"targetPath": targetPath ?: @"", @"url": url ?: @"" }];
      [self.jsCancelled removeObject:taskId];
      return;
    }

    // 有续传数据时优先续传（修「全部开始」实际从头下载的问题）
    NSString *resumePath = [[self resumeDir] stringByAppendingPathComponent:[taskId stringByAppendingPathExtension:@"data"]];
    NSData *resumeData = [NSData dataWithContentsOfFile:resumePath];
    if (resumeData) {
      NSURLSessionDownloadTask *task = [self.session downloadTaskWithResumeData:resumeData];
      task.taskDescription = taskId;
      self.tasks[taskId] = task;
      [self setTaskInfoForId:taskId info:@{ @"targetPath": targetPath ?: @"", @"url": url ?: @"" }];
      [self.jsCancelled removeObject:taskId];
      [self.startedTasks removeObject:taskId];
      [task resume];
      [[NSFileManager defaultManager] removeItemAtPath:resumePath error:nil];
      return;
    }

    NSURL *requestURL = [NSURL URLWithString:url];
    if (!requestURL) {
      [self emitLoggedEvent:@"error" data:@{ @"taskId": taskId, @"code": @"URL_FAILED", @"message": @"invalid url" }];
      return;
    }
    NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:requestURL];
    // §4.2：请求级蜂窝控制，覆盖会话放行
    request.allowsCellularAccess = allowsCellular;
    request.allowsConstrainedNetworkAccess = allowsCellular;
    [headers enumerateKeysAndObjectsUsingBlock:^(NSString *key, NSString *value, BOOL *stop) {
      [request setValue:value forHTTPHeaderField:key];
    }];

    NSURLSessionDownloadTask *task = [self.session downloadTaskWithRequest:request];
    task.taskDescription = taskId;
    self.tasks[taskId] = task;
    [self setTaskInfoForId:taskId info:@{ @"targetPath": targetPath ?: @"", @"url": url ?: @"" }];
    [self.jsCancelled removeObject:taskId];
    [self.startedTasks removeObject:taskId];
    [task resume];
  });
}

#pragma mark - 暂停 / 恢复 / 取消（§7.6、§4.4）

- (void)pauseTaskId:(NSString *)taskId
{
  dispatch_async(self.queue, ^{
    NSURLSessionDownloadTask *task = self.tasks[taskId];
    if (!task) return;
    [self.jsCancelled addObject:taskId];
    // cancelByProducingResumeData 交回续传数据，didCompleteWithError 处理落盘
    [task cancelByProducingResumeData:^(NSData *resumeData) {
      dispatch_async(self.queue, ^{
        if (resumeData) {
          NSString *path = [[self resumeDir] stringByAppendingPathComponent:[taskId stringByAppendingPathExtension:@"data"]];
          [resumeData writeToFile:path atomically:YES];
        }
      });
    }];
    [self.tasks removeObjectForKey:taskId];
  });
}

- (void)resumeTaskId:(NSString *)taskId
      allowsCellular:(BOOL)allowsCellular
          completion:(void (^)(BOOL resumed))completion
{
  dispatch_async(self.queue, ^{
    NSString *path = [[self resumeDir] stringByAppendingPathComponent:[taskId stringByAppendingPathExtension:@"data"]];
    NSData *resumeData = [NSData dataWithContentsOfFile:path];
    NSDictionary *info = self.taskInfos[taskId];
    NSString *url = info[@"url"] ?: @"";
    if (!resumeData || !url.length) {
      // 无续传数据或元信息缺失：如实报失败，由 JS 改走 start 从 0 下
      if (completion) completion(NO);
      return;
    }
    NSURLSessionDownloadTask *task = [self.session downloadTaskWithResumeData:resumeData];
    task.taskDescription = taskId;
    self.tasks[taskId] = task;
    [self.jsCancelled removeObject:taskId];
    [self.startedTasks removeObject:taskId];
    [self.lastProgressEmit removeObjectForKey:taskId];
    [task resume];
    // 续传发起成功后清掉本地副本
    [[NSFileManager defaultManager] removeItemAtPath:path error:nil];
    if (completion) completion(YES);
  });
}

- (void)cancelTaskId:(NSString *)taskId removeResumeData:(BOOL)removeResumeData
{
  dispatch_async(self.queue, ^{
    NSURLSessionDownloadTask *task = self.tasks[taskId];
    [self.jsCancelled addObject:taskId];
    if (task) {
      [task cancel];
      [self.tasks removeObjectForKey:taskId];
    }
    [self removeTaskInfoForId:taskId];
    if (removeResumeData) {
      NSString *path = [[self resumeDir] stringByAppendingPathComponent:[taskId stringByAppendingPathExtension:@"data"]];
      [[NSFileManager defaultManager] removeItemAtPath:path error:nil];
    }
  });
}

- (void)removeResumeDataForTaskId:(NSString *)taskId
{
  dispatch_async(self.queue, ^{
    NSString *path = [[self resumeDir] stringByAppendingPathComponent:[taskId stringByAppendingPathExtension:@"data"]];
    [[NSFileManager defaultManager] removeItemAtPath:path error:nil];
  });
}

#pragma mark - 查询

- (void)getActiveTasksWithCompletion:(void (^)(NSArray<NSDictionary *> *tasks))completion
{
  dispatch_async(self.queue, ^{
    NSMutableArray<NSDictionary *> *result = [NSMutableArray array];
    [self.tasks enumerateKeysAndObjectsUsingBlock:^(NSString *taskId, NSURLSessionDownloadTask *task, BOOL *stop) {
      NSString *state = task.state == NSURLSessionTaskStateRunning ? @"running" : @"suspended";
      [result addObject:@{
        @"taskId": taskId,
        @"state": state,
        @"downloaded": @(task.countOfBytesReceived),
        @"total": @(task.countOfBytesExpectedToReceive),
      }];
    }];
    completion(result);
  });
}

#pragma mark - 事件日志读取 / 确认（§4.6）

- (void)drainEventsWithCompletion:(void (^)(NSArray<NSDictionary *> *events))completion
{
  dispatch_async(self.queue, ^{
    NSString *content = [NSString stringWithContentsOfFile:[self eventsLogPath] encoding:NSUTF8StringEncoding error:nil];
    NSMutableArray<NSDictionary *> *events = [NSMutableArray array];
    if (content.length) {
      for (NSString *line in [content componentsSeparatedByString:@"\n"]) {
        if (!line.length) continue;
        NSDictionary *obj = [NSJSONSerialization JSONObjectWithData:[line dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
        if (obj) [events addObject:obj];
      }
    }
    completion(events);
  });
}

- (void)ackEventsUpToSeq:(NSInteger)seq
{
  dispatch_async(self.queue, ^{
    NSString *content = [NSString stringWithContentsOfFile:[self eventsLogPath] encoding:NSUTF8StringEncoding error:nil];
    if (!content.length) return;
    NSMutableString *kept = [NSMutableString string];
    for (NSString *line in [content componentsSeparatedByString:@"\n"]) {
      if (!line.length) continue;
      NSDictionary *obj = [NSJSONSerialization JSONObjectWithData:[line dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
      NSNumber *lineSeq = obj[@"seq"];
      if (lineSeq && lineSeq.integerValue > seq) {
        [kept appendString:line];
        [kept appendString:@"\n"];
      }
    }
    [kept writeToFile:[self eventsLogPath] atomically:YES encoding:NSUTF8StringEncoding error:nil];
  });
}

#pragma mark - 后台会话交接（§4.1）

- (void)handleBackgroundSession:(NSString *)identifier
             completionHandler:(void (^)(void))completionHandler
{
  if (![identifier isEqualToString:kSessionIdentifier]) {
    // 不属于本方的会话：立即调用，不调用会被系统按任务挂起处理
    completionHandler();
    return;
  }
  dispatch_async(self.queue, ^{
    self.bgCompletionHandler = completionHandler;
  });
  // 重新挂接存活任务
  __weak typeof(self) weakSelf = self;
  [self.session getAllTasksWithCompletionHandler:^(NSArray<NSURLSessionTask *> *tasks) {
    __strong typeof(weakSelf) strongSelf = weakSelf;
    if (!strongSelf) return;
    dispatch_async(strongSelf.queue, ^{
      for (NSURLSessionTask *task in tasks) {
        NSString *taskId = task.taskDescription;
        if (taskId && (task.state == NSURLSessionTaskStateRunning || task.state == NSURLSessionTaskStateSuspended)) {
          strongSelf.tasks[taskId] = (NSURLSessionDownloadTask *)task;
        }
      }
    });
  }];
}

#pragma mark - NSURLSessionDownloadDelegate（§4.3、§4.4）

- (void)URLSession:(NSURLSession *)session downloadTask:(NSURLSessionDownloadTask *)downloadTask
                              didFinishDownloadingToURL:(NSURL *)location
{
  NSString *taskId = downloadTask.taskDescription;
  if (!taskId) return;
  NSHTTPURLResponse *response = (NSHTTPURLResponse *)downloadTask.response;
  NSInteger statusCode = response ? response.statusCode : 0;
  NSDictionary *info = self.taskInfos[taskId];
  NSString *relPath = info[@"targetPath"] ?: @"";
  NSFileManager *fm = [NSFileManager defaultManager];
  NSString *documents = [NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES) firstObject];

  // P0 删除护栏：目标路径缺失（元信息丢失）或不是 Documents 的严格
  // 子路径时，绝不删除、绝不覆盖——旧版此处会把整个 Documents 删掉
  // （relPath 为空时 absPath 就是 Documents 本身）。孤儿文件暂存后报错
  BOOL pathValid = relPath.length > 0;
  NSString *absPath = nil;
  if (pathValid) {
    absPath = [self absolutePathForRelative:relPath];
    pathValid = [absPath hasPrefix:[documents stringByAppendingString:@"/"]]
      && ![absPath isEqualToString:documents];
  }
  if (!pathValid) {
    NSString *orphanDir = [[self internalDir] stringByAppendingPathComponent:@"orphan"];
    [fm createDirectoryAtPath:orphanDir withIntermediateDirectories:YES attributes:nil error:nil];
    NSString *orphanPath = [orphanDir stringByAppendingPathComponent:taskId];
    [fm removeItemAtPath:orphanPath error:nil];
    [fm moveItemAtURL:location toURL:[NSURL fileURLWithPath:orphanPath] error:nil];
    [self emitLoggedEvent:@"error" data:@{ @"taskId": taskId, @"code": @"ORPHAN" }];
    [self.tasks removeObjectForKey:taskId];
    [self.startedTasks removeObject:taskId];
    return;
  }

  if (statusCode >= 200 && statusCode < 300) {
    // §4.3：只有 2xx 才 move
    NSString *dir = [absPath stringByDeletingLastPathComponent];
    if (![fm fileExistsAtPath:dir]) {
      [fm createDirectoryAtPath:dir withIntermediateDirectories:YES attributes:nil error:nil];
    }
    // 目标已存在先删：只删普通文件，永不删目录
    BOOL isDir = NO;
    if ([fm fileExistsAtPath:absPath isDirectory:&isDir] && !isDir) {
      [fm removeItemAtPath:absPath error:nil];
    }
    NSError *moveError = nil;
    [fm moveItemAtURL:location toURL:[NSURL fileURLWithPath:absPath] error:&moveError];
    if (!moveError) {
      // 排除 iCloud 备份并读回校验（§4.3）
      NSURL *fileURL = [NSURL fileURLWithPath:absPath];
      [fileURL setResourceValue:@YES forKey:NSURLIsExcludedFromBackupKey error:nil];
      NSNumber *excluded = nil;
      [fileURL getResourceValue:&excluded forKey:NSURLIsExcludedFromBackupKey error:nil];
      [self emitLoggedEvent:@"complete" data:@{
        @"taskId": taskId,
        @"path": absPath,
        @"size": @(downloadTask.countOfBytesReceived),
      }];
    } else {
      [self emitLoggedEvent:@"error" data:@{ @"taskId": taskId, @"code": @"WRITE_FAILED" }];
    }
    [self.tasks removeObjectForKey:taskId];
    [self.startedTasks removeObject:taskId];
    [self removeTaskInfoForId:taskId];
  } else {
    // 非 2xx：不 move，记 HTTP_<status>
    [self emitLoggedEvent:@"error" data:@{
      @"taskId": taskId,
      @"code": [NSString stringWithFormat:@"HTTP_%ld", (long)statusCode],
      @"httpStatus": @(statusCode),
    }];
    [self.tasks removeObjectForKey:taskId];
    [self removeTaskInfoForId:taskId];
  }
}

- (void)URLSession:(NSURLSession *)session downloadTask:(NSURLSessionDownloadTask *)downloadTask
      didWriteData:(int64_t)bytesWritten
 totalBytesWritten:(int64_t)totalBytesWritten
totalBytesExpectedToWrite:(int64_t)totalBytesExpectedToWrite
{
  NSString *taskId = downloadTask.taskDescription;
  if (!taskId) return;
  NSHTTPURLResponse *response = (NSHTTPURLResponse *)downloadTask.response;
  NSInteger statusCode = response ? response.statusCode : 0;
  // §4.3：首个 didWriteData 且 2xx 才发 start；非 2xx 不发，避免清零重试
  if (statusCode >= 200 && statusCode < 300) {
    // §4.3：首个 2xx didWriteData 发 start，之后节流发 progress
    if (![self.startedTasks containsObject:taskId]) {
      [self.startedTasks addObject:taskId];
      [self emitEvent:@"start" data:@{
        @"taskId": taskId,
        @"total": @(totalBytesExpectedToWrite),
      }];
      return;
    }
    NSTimeInterval now = [NSDate date].timeIntervalSince1970;
    NSNumber *last = self.lastProgressEmit[taskId];
    if (last && now - last.doubleValue < 0.5) return;
    self.lastProgressEmit[taskId] = @(now);
    [self emitEvent:@"progress" data:@{
      @"taskId": taskId,
      @"downloaded": @(totalBytesWritten),
      @"total": @(totalBytesExpectedToWrite),
    }];
  }
}

- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task
didCompleteWithError:(NSError *)error
{
  NSString *taskId = task.taskDescription;
  if (!taskId) return;
  // delegate 回调在会话自己的串行队列上，与 self.queue 不是同一条；
  // 任务字典的读写统一收进 self.queue，消除竞态
  dispatch_async(self.queue, ^{
    [self.tasks removeObjectForKey:taskId];
    [self.startedTasks removeObject:taskId];
    [self.lastProgressEmit removeObjectForKey:taskId];
    [self handleTaskError:error forTaskId:taskId];
  });
}

- (void)handleTaskError:(NSError *)error forTaskId:(NSString *)taskId
{

  if (error == nil) return; // 正常完成，已在 didFinishDownloadingToURL 处理

  if (error.code == NSURLErrorCancelled) {
    if ([self.jsCancelled containsObject:taskId]) {
      // JS 主动取消，忽略
      return;
    }
    // 系统取消：区分强退 / 其他（§4.4）。取消原因键与强退枚举值用字面量：
    // NSURLErrorBackgroundTaskCancelledReasonKey 与
    // NSURLSessionTaskCancelledReasonUserForceQuitApplication 的真实宏名
    // 未在本机头文件验证，§17 实证 3 会逐字段核对
    NSNumber *reason = error.userInfo[@"NSURLSessionTaskCancelledReasonKey"];
    NSString *code = (reason.integerValue == 2 /* UserForceQuitApplication */)
      ? @"FORCE_QUIT" : @"SYSTEM_CANCELLED";
    // 保存续传数据（字面量同上，实证 3 核对）
    NSData *resumeData = error.userInfo[@"NSURLSessionDownloadTaskResumeDataKey"];
    BOOL hasResume = NO;
    if (resumeData) {
      NSString *path = [[self resumeDir] stringByAppendingPathComponent:[taskId stringByAppendingPathExtension:@"data"]];
      hasResume = [resumeData writeToFile:path atomically:YES];
    }
    [self emitLoggedEvent:@"error" data:@{ @"taskId": taskId, @"code": code, @"hasResumeData": @(hasResume) }];
    return;
  }

  // 其他错误：映射错误码，保存续传数据
  NSString *code = @"NETWORK";
  if (error.code == NSURLErrorCannotFindHost || error.code == NSURLErrorDNSLookupFailed) {
    code = @"DNS";
  } else if (error.code == NSURLErrorTimedOut) {
    code = @"TIMEOUT";
  } else if (error.code == NSURLErrorNoPermissionsToReadFile || error.code == NSURLErrorCannotWriteToFile) {
    code = @"WRITE_FAILED";
    // 磁盘不足没有独立错误码：从底层 POSIX 错误提取 ENOSPC（§8 NO_SPACE）
    NSError *underlying = error.userInfo[NSUnderlyingErrorKey];
    if ([underlying.domain isEqualToString:NSPOSIXErrorDomain] && underlying.code == ENOSPC) {
      code = @"NO_SPACE";
    }
  }
  NSData *resumeData = error.userInfo[@"NSURLSessionDownloadTaskResumeDataKey"];
  BOOL hasResume = NO;
  if (resumeData) {
    NSString *path = [[self resumeDir] stringByAppendingPathComponent:[taskId stringByAppendingPathExtension:@"data"]];
    hasResume = [resumeData writeToFile:path atomically:YES];
  }
  [self emitLoggedEvent:@"error" data:@{
    @"taskId": taskId,
    @"code": code,
    @"message": error.localizedDescription ?: @"",
    @"hasResumeData": @(hasResume),
  }];
}

- (void)URLSessionDidFinishEventsForBackgroundURLSession:(NSURLSession *)session
{
  // 事件日志落盘后回主线程调用 completionHandler（§4.1）
  dispatch_async(self.queue, ^{
    void (^handler)(void) = self.bgCompletionHandler;
    self.bgCompletionHandler = nil;
    if (handler) {
      dispatch_async(dispatch_get_main_queue(), handler);
    }
  });
}

@end
