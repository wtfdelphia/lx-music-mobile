#import "UserApiModule.h"
#import <UIKit/UIKit.h>
#import <JavaScriptCore/JavaScriptCore.h>
#import <CommonCrypto/CommonDigest.h>
#include <stddef.h>
#include <string.h>

// lxcore-crypto C ABI（与 CryptoModule 同一实现，保证沙箱内加密字节级一致）
extern char *lx_aes_encrypt(const char *data, const char *key, const char *iv, const char *mode, size_t *out_len);
extern char *lx_rsa_encrypt(const char *data, const char *key, const char *padding, size_t *out_len);
extern void lx_free_string(char *ptr, size_t len);

static NSString *LxUserApiTakeString(char *ptr, size_t len)
{
  if (ptr == NULL) return @"";
  NSString *result = [[NSString alloc] initWithBytes:ptr length:len encoding:NSUTF8StringEncoding];
  lx_free_string(ptr, len);
  return result != nil ? result : @"";
}

// 与 Android JsHandler.sendInitFailedEvent 的固定负载一致
static NSString *const kInitFailedData = @"{ \"info\": null, \"status\": false, \"errorMessage\": \"Create JavaScript Env Failed\" }";

@implementation UserApiModule {
  dispatch_queue_t _jsQueue;
  JSContext *_context;
  NSString *_key;
  BOOL _hasListeners;
  BOOL _inited;
  NSUInteger _generation;
}

RCT_EXPORT_MODULE()

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (instancetype)init
{
  if (self = [super init]) {
    _jsQueue = dispatch_queue_create("cn.toside.music.lx.userapi.js", DISPATCH_QUEUE_SERIAL);
  }
  return self;
}

#pragma mark - RCTEventEmitter

- (NSArray<NSString *> *)supportedEvents
{
  return @[ @"api-action" ];
}

- (void)startObserving
{
  _hasListeners = YES;
}

- (void)stopObserving
{
  _hasListeners = NO;
}

RCT_EXPORT_METHOD(addListener:(NSString *)eventName) {}
RCT_EXPORT_METHOD(removeListeners:(NSInteger)count) {}

#pragma mark - 事件

- (void)emitAction:(NSDictionary *)payload
{
  if (_hasListeners) [self sendEventWithName:@"api-action" body:payload];
}

- (void)emitLog:(NSString *)type text:(NSString *)text
{
  [self emitAction:@{ @"action": @"log", @"type": type ?: @"log", @"log": text ?: @"" }];
}

- (void)sendInitFailed:(NSString *)errorMessage
{
  [self emitAction:@{
    @"action": @"init",
    @"errorMessage": errorMessage ?: @"",
    @"data": kInitFailedData,
  }];
  [self emitLog:@"error" text:errorMessage ?: @""];
}

#pragma mark - JS 执行（仅在 _jsQueue 上）

- (JSValue *)evaluate:(NSString *)script inContext:(JSContext *)ctx error:(NSString **)errOut
{
  __block JSValue *caught = nil;
  ctx.exceptionHandler = ^(JSContext *c, JSValue *exception) {
    caught = exception;
    c.exception = nil;
  };
  JSValue *result = [ctx evaluateScript:script];
  if (caught != nil) {
    if (errOut != NULL) *errOut = [caught toString] ?: @"unknown error";
    return nil;
  }
  return result;
}

- (void)callJS:(NSString *)action withArg:(JSValue *)arg
{
  JSContext *ctx = _context;
  if (ctx == nil) return;
  JSValue *fn = ctx[@"__lx_native__"];
  if (fn == nil || fn.isUndefined || fn.isNull) return;
  NSMutableArray *params = [NSMutableArray arrayWithObjects:_key, action, nil];
  if (arg != nil) [params addObject:arg];
  __block JSValue *caught = nil;
  ctx.exceptionHandler = ^(JSContext *c, JSValue *exception) {
    caught = exception;
    c.exception = nil;
  };
  [fn callWithArguments:params];
  if (caught != nil) {
    NSString *msg = [caught toString] ?: @"unknown error";
    if (msg.length > 1024) msg = [[msg substringToIndex:1024] stringByAppendingString:@"..."];
    [self emitLog:@"error" text:[NSString stringWithFormat:@"Call script error: %@", msg]];
    if (!_inited) {
      _inited = YES;
      [self sendInitFailed:msg];
    }
  }
}

- (void)injectEnvInto:(JSContext *)ctx
{
  __weak UserApiModule *weakSelf = self;

  ctx[@"__lx_native_call__"] = ^(NSString *callKey, NSString *action, NSString *callData) {
    UserApiModule *self_ = weakSelf;
    if (self_ == nil || ![callKey isEqualToString:self_->_key]) return;
    if ([action isEqualToString:@"init"] && !self_->_inited) self_->_inited = YES;
    [self_ emitAction:@{ @"action": action ?: @"", @"data": callData ?: @"" }];
  };

  ctx[@"__lx_native_call__utils_str2b64"] = ^NSString *(NSString *input) {
    NSData *data = [(input ?: @"") dataUsingEncoding:NSUTF8StringEncoding];
    return [data base64EncodedStringWithOptions:0];
  };

  // 与 Java (int)byte 一致：有符号 -128..127
  ctx[@"__lx_native_call__utils_b642buf"] = ^NSString *(NSString *input) {
    NSData *data = [[NSData alloc] initWithBase64EncodedString:(input ?: @"")
                                                       options:NSDataBase64DecodingIgnoreUnknownCharacters];
    if (data == nil) return @"";
    const int8_t *bytes = (const int8_t *)data.bytes;
    NSMutableString *out = [NSMutableString stringWithString:@"["];
    for (NSUInteger i = 0; i < data.length; i++) {
      if (i > 0) [out appendString:@","];
      [out appendFormat:@"%d", (int)bytes[i]];
    }
    [out appendString:@"]"];
    return out;
  };

  // 对齐 Java URLDecoder.decode(s, "UTF-8")：'+' → 空格，%XX → UTF-8；非法输入返回空串
  ctx[@"__lx_native_call__utils_str2md5"] = ^NSString *(NSString *input) {
    NSString *prepared = [(input ?: @"") stringByReplacingOccurrencesOfString:@"+" withString:@" "];
    NSString *decoded = [prepared stringByRemovingPercentEncoding];
    if (decoded == nil) return @"";
    const char *cstr = [decoded UTF8String];
    if (cstr == NULL) return @"";
    unsigned char digest[CC_MD5_DIGEST_LENGTH];
    CC_MD5(cstr, (CC_LONG)strlen(cstr), digest);
    NSMutableString *hex = [NSMutableString stringWithCapacity:CC_MD5_DIGEST_LENGTH * 2];
    for (int i = 0; i < CC_MD5_DIGEST_LENGTH; i++) [hex appendFormat:@"%02x", digest[i]];
    return hex;
  };

  ctx[@"__lx_native_call__utils_aes_encrypt"] = ^NSString *(NSString *data, NSString *key, NSString *iv, NSString *mode) {
    size_t len = 0;
    char *ptr = lx_aes_encrypt([data UTF8String], [key UTF8String], [iv UTF8String], [mode UTF8String], &len);
    return LxUserApiTakeString(ptr, len);
  };

  ctx[@"__lx_native_call__utils_rsa_encrypt"] = ^NSString *(NSString *data, NSString *key, NSString *padding) {
    size_t len = 0;
    char *ptr = lx_rsa_encrypt([data UTF8String], [key UTF8String], [padding UTF8String], &len);
    return LxUserApiTakeString(ptr, len);
  };

  ctx[@"__lx_native_call__set_timeout"] = ^(JSValue *fnId, JSValue *delay) {
    UserApiModule *self_ = weakSelf;
    if (self_ == nil) return;
    NSTimeInterval ms = [delay toNumber].doubleValue;
    if (ms < 0) ms = 0;
    NSUInteger gen = self_->_generation;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(ms * NSEC_PER_MSEC)), self_->_jsQueue, ^{
      UserApiModule *self2 = weakSelf;
      if (self2 == nil || gen != self2->_generation || self2->_context == nil) return;
      [self2 callJS:@"__set_timeout__" withArg:fnId];
    });
  };

  ctx[@"__lx_native_log__"] = ^(NSString *type, NSString *text) {
    UserApiModule *self_ = weakSelf;
    if (self_ == nil) return;
    [self_ emitLog:type text:text];
  };
  static NSString *const consoleShim =
    @"(function(){"
    @"var fmt=function(a){try{return typeof a==='object'?JSON.stringify(a):String(a);}catch(e){return String(a);}};"
    @"var mk=function(t){return function(){var p=[];for(var i=0;i<arguments.length;i++)p.push(fmt(arguments[i]));__lx_native_log__(t,p.join(' '));};};"
    @"globalThis.console={log:mk('log'),info:mk('info'),warn:mk('warn'),error:mk('error'),debug:mk('log')};"
    @"})();";
  [ctx evaluateScript:consoleShim];
}

- (void)setupContextWithInfo:(NSDictionary *)info
{
  _inited = NO;
  _key = [NSUUID UUID].UUIDString;

  JSContext *ctx = [[JSContext alloc] init];
  _context = ctx;

  NSString *preloadPath = [[NSBundle mainBundle] pathForResource:@"user-api-preload" ofType:@"js"];
  NSString *preload = preloadPath != nil
    ? [NSString stringWithContentsOfFile:preloadPath encoding:NSUTF8StringEncoding error:nil]
    : nil;
  if (preload == nil) {
    [self sendInitFailed:@"preload script not found"];
    return;
  }

  [self injectEnvInto:ctx];

  NSString *err = nil;
  [self evaluate:preload inContext:ctx error:&err];
  if (err != nil) {
    [self sendInitFailed:err];
    return;
  }

  JSValue *lxSetup = ctx[@"lx_setup"];
  [lxSetup callWithArguments:@[
    _key,
    info[@"id"] ?: @"",
    info[@"name"] ?: @"Unknown",
    info[@"description"] ?: @"",
    info[@"version"] ?: @"",
    info[@"author"] ?: @"",
    info[@"homepage"] ?: @"",
    info[@"script"] ?: @"",
  ]];

  NSString *scriptErr = nil;
  [self evaluate:(info[@"script"] ?: @"") inContext:ctx error:&scriptErr];
  if (scriptErr != nil) {
    [self callJS:@"__run_error__" withArg:nil];
    if (!_inited) {
      _inited = YES;
      [self sendInitFailed:scriptErr];
    }
  }
}

#pragma mark - 导出方法

RCT_EXPORT_METHOD(loadScript:(NSDictionary *)data)
{
  _generation += 1;
  dispatch_async(_jsQueue, ^{
    self->_context = nil;
    [self setupContextWithInfo:data ?: @{}];
  });
}

RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(sendAction:(NSString *)action info:(NSString *)info)
{
  if (_context == nil) return @NO;
  NSUInteger gen = _generation;
  NSString *key = _key;
  dispatch_async(_jsQueue, ^{
    UserApiModule *self_ = self;
    if (gen != self_->_generation || self_->_context == nil) return;
    JSContext *ctx = self_->_context;
    JSValue *fn = ctx[@"__lx_native__"];
    if (fn == nil || fn.isUndefined || fn.isNull) return;
    __block JSValue *caught = nil;
    ctx.exceptionHandler = ^(JSContext *c, JSValue *exception) {
      caught = exception;
      c.exception = nil;
    };
    [fn callWithArguments:@[ key, action ?: @"", info ?: @"" ]];
    if (caught != nil) {
      NSString *msg = [caught toString] ?: @"unknown error";
      if (msg.length > 1024) msg = [[msg substringToIndex:1024] stringByAppendingString:@"..."];
      [self_ emitLog:@"error" text:[NSString stringWithFormat:@"Call script error: %@", msg]];
      if (!self_->_inited) {
        self_->_inited = YES;
        [self_ sendInitFailed:msg];
      }
    }
  });
  return @YES;
}

RCT_EXPORT_METHOD(destroy)
{
  _generation += 1;
  dispatch_async(_jsQueue, ^{
    self->_context = nil;
  });
}

@end
