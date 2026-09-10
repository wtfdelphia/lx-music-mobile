#import "CacheModule.h"
#import <Foundation/Foundation.h>

@implementation CacheModule

RCT_EXPORT_MODULE()

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (NSString *)cacheDir
{
  return [NSSearchPathForDirectoriesInDomains(NSCachesDirectory, NSUserDomainMask, YES) firstObject];
}

- (unsigned long long)dirSizeAtPath:(NSString *)path
{
  NSFileManager *fileManager = [NSFileManager defaultManager];
  NSDirectoryEnumerator *enumerator = [fileManager enumeratorAtPath:path];
  unsigned long long total = 0;
  for (NSString *name in enumerator) {
    NSNumber *size = [enumerator fileAttributes][NSFileSize];
    total += size.unsignedLongLongValue;
  }
  return total;
}

RCT_EXPORT_METHOD(getAppCacheSize:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  unsigned long long size = [self dirSizeAtPath:[self cacheDir]];
  resolve([NSString stringWithFormat:@"%llu", size]);
}

RCT_EXPORT_METHOD(clearAppCache:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  NSString *cacheDir = [self cacheDir];
  NSFileManager *fileManager = [NSFileManager defaultManager];
  NSArray<NSString *> *items = [fileManager contentsOfDirectoryAtPath:cacheDir error:nil];
  for (NSString *item in items) {
    [fileManager removeItemAtPath:[cacheDir stringByAppendingPathComponent:item] error:nil];
  }
  resolve(nil);
}

@end
