#import "LxArtworkCache.h"
#import <CommonCrypto/CommonDigest.h>

@implementation LxArtworkCache

+ (instancetype)shared
{
  static LxArtworkCache *instance = nil;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    instance = [[LxArtworkCache alloc] init];
  });
  return instance;
}

- (NSString *)cacheDirectory
{
  NSString *caches = [NSSearchPathForDirectoriesInDomains(NSCachesDirectory, NSUserDomainMask, YES) firstObject];
  NSString *dir = [caches stringByAppendingPathComponent:@"lx-library/artwork"];
  [NSFileManager.defaultManager createDirectoryAtPath:dir withIntermediateDirectories:YES attributes:nil error:nil];
  return dir;
}

- (NSString *)sha1Hex:(NSData *)data
{
  unsigned char digest[CC_SHA1_DIGEST_LENGTH];
  CC_SHA1(data.bytes, (CC_LONG)data.length, digest);
  NSMutableString *hex = [NSMutableString stringWithCapacity:CC_SHA1_DIGEST_LENGTH * 2];
  for (int i = 0; i < CC_SHA1_DIGEST_LENGTH; i++) [hex appendFormat:@"%02x", digest[i]];
  return hex;
}

- (NSString *)cachedPathForArtwork:(NSData *)artworkData
{
  if (!artworkData.length) return nil;
  NSString *name = [self sha1Hex:artworkData];
  NSString *path = [[self cacheDirectory] stringByAppendingPathComponent:name];
  return [NSFileManager.defaultManager fileExistsAtPath:path] ? path : nil;
}

- (NSString *)storeArtwork:(NSData *)scaledJPEG
{
  if (!scaledJPEG.length) return nil;
  NSString *name = [self sha1Hex:scaledJPEG];
  NSString *path = [[self cacheDirectory] stringByAppendingPathComponent:name];
  if (![NSFileManager.defaultManager fileExistsAtPath:path]) {
    [scaledJPEG writeToFile:path atomically:YES];
  }
  return path;
}

- (NSString *)pathForCachedName:(NSString *)cachedName
{
  if (!cachedName.length) return nil;
  NSString *path = [[self cacheDirectory] stringByAppendingPathComponent:cachedName];
  return [NSFileManager.defaultManager fileExistsAtPath:path] ? path : nil;
}

@end
