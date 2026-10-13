#import "LxMediaProbe.h"
#import <AVFoundation/AVFoundation.h>
#import <ImageIO/ImageIO.h>
#import <MobileCoreServices/MobileCoreServices.h>
#import <UIKit/UIKit.h>

// 媒体元数据探测实现（§5.4）：
// - 按 AVMetadataIdentifier 精确匹配，优先级链见 design 表格
// - loadValuesAsynchronouslyForKeys 兼容 13.4（异步加载），信号量做 8s 超时
// - 封面：ImageIO 缩放至最长边 600，JPEG 0.85（§5.5）

static const NSTimeInterval kProbeTimeout = 8.0;
static const CGFloat kArtworkMaxSide = 600.0;

@implementation LxMediaProbe

+ (instancetype)shared
{
  static LxMediaProbe *instance = nil;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    instance = [[LxMediaProbe alloc] init];
  });
  return instance;
}

#pragma mark - 文本清洗

- (NSString *)cleanText:(NSString *)text
{
  if (!text.length) return nil;
  NSString *trimmed = [text stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  // 去掉 NUL（§5.4）
  trimmed = [trimmed stringByReplacingOccurrencesOfString:@"\0" withString:@""];
  return trimmed.length ? trimmed : nil;
}

- (NSDictionary *)fallbackMetadataForFile:(NSURL *)fileURL
{
  NSString *name = fileURL.lastPathComponent.stringByDeletingPathExtension;
  return @{
    @"title": name ?: @"",
    @"artist": [NSNull null],
    @"album": [NSNull null],
    @"albumArtist": [NSNull null],
    @"trackNo": [NSNull null],
    @"discNo": [NSNull null],
    @"year": [NSNull null],
    @"genre": [NSNull null],
    @"durationMs": @0,
    @"bitrate": [NSNull null],
    @"ext": fileURL.pathExtension.lowercaseString ?: @"",
    @"size": @(0),
    @"artworkData": [NSNull null],
    @"hasEmbeddedLyric": @NO,
  };
}

#pragma mark - 探测

- (NSDictionary *)probeFile:(NSURL *)fileURL
{
  if (!fileURL) return @{};
  AVURLAsset *asset = [AVURLAsset URLAssetWithURL:fileURL options:@{AVURLAssetPreferPreciseDurationAndTimingKey: @NO}];

  dispatch_semaphore_t sem = dispatch_semaphore_create(0);
  NSArray *keys = @[@"metadata", @"commonMetadata", @"duration", @"tracks"];
  __block BOOL loaded = NO;
  [asset loadValuesAsynchronouslyForKeys:keys completionHandler:^{
    loaded = YES;
    dispatch_semaphore_signal(sem);
  }];
  dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kProbeTimeout * NSEC_PER_SEC)));
  if (!loaded) {
    // 超时：返回文件名降级（§5.4），文件仍入库
    NSMutableDictionary *fallback = [[self fallbackMetadataForFile:fileURL] mutableCopy];
    fallback[@"timeout"] = @YES;
    return fallback;
  }

  NSMutableDictionary *result = [[self fallbackMetadataForFile:fileURL] mutableCopy];

  // 时长
  CMTime duration = asset.duration;
  if (CMTIME_IS_VALID(duration)) {
    double seconds = CMTimeGetSeconds(duration);
    if (isfinite(seconds) && seconds > 0) result[@"durationMs"] = @((long long)(seconds * 1000));
  }

  // 通用字段按 commonKey 匹配。commonMetadata 条目的 `identifier` 保留
  // 格式原始标识（如 id3/TIT2、iTunes/©nam），通用映射只在 `commonKey`
  // 上；用 identifier 比较 `AVMetadataCommonIdentifier*` 对相当一部分
  // 文件不命中，艺人和专辑读不出来。标题还要主动覆盖文件名占位。
  BOOL titleFromTag = NO;
  for (AVMetadataItem *item in asset.commonMetadata) {
    AVMetadataKey ck = item.commonKey;
    if (!ck) continue;
    NSString *stringValue = [self cleanText:item.stringValue];

    if ([ck isEqualToString:AVMetadataCommonKeyTitle]) {
      if (stringValue && !titleFromTag) { result[@"title"] = stringValue; titleFromTag = YES; }
    } else if ([ck isEqualToString:AVMetadataCommonKeyArtist]) {
      if (stringValue && result[@"artist"] == [NSNull null]) result[@"artist"] = stringValue;
    } else if ([ck isEqualToString:AVMetadataCommonKeyAlbumName]) {
      if (stringValue && result[@"album"] == [NSNull null]) result[@"album"] = stringValue;
    } else if ([ck isEqualToString:AVMetadataCommonKeyArtwork]) {
      NSData *data = item.dataValue;
      if (data.length && result[@"artworkData"] == [NSNull null]) result[@"artworkData"] = data;
    } else if ([ck isEqualToString:AVMetadataCommonKeyType]) {
      if (stringValue && result[@"genre"] == [NSNull null]) result[@"genre"] = stringValue;
    } else if ([ck isEqualToString:AVMetadataCommonKeyCreationDate]) {
      if (result[@"year"] == [NSNull null]) {
        NSInteger year = [self parseYear:stringValue];
        if (year > 0) result[@"year"] = @(year);
      }
    }
  }

  // 格式专属字段：遍历 asset.metadata（commonMetadata 不含曲序、碟号、
  // 专辑艺人、年份的其他形式、歌词），沿用原始 `identifier` 分支。
  for (AVMetadataItem *item in asset.metadata) {
    AVMetadataIdentifier identifier = item.identifier;
    if (!identifier) continue;
    id value = item.value;
    NSString *stringValue = item.stringValue;

    if ([identifier isEqualToString:AVMetadataIdentifierID3MetadataRecordingTime] ||
        [identifier isEqualToString:AVMetadataIdentifierID3MetadataYear] ||
        [identifier isEqualToString:AVMetadataIdentifieriTunesMetadataReleaseDate]) {
      if (result[@"year"] == [NSNull null]) {
        NSString *t = [self cleanText:stringValue];
        NSInteger year = [self parseYear:t];
        if (year > 0) result[@"year"] = @(year);
      }
    } else if ([identifier isEqualToString:AVMetadataIdentifierID3MetadataContentType] ||
               [identifier isEqualToString:AVMetadataIdentifieriTunesMetadataUserGenre]) {
      NSString *t = [self cleanText:stringValue];
      if (t && result[@"genre"] == [NSNull null]) result[@"genre"] = t;
    } else if ([identifier isEqualToString:AVMetadataIdentifierID3MetadataUnsynchronizedLyric] ||
               [identifier isEqualToString:AVMetadataIdentifieriTunesMetadataLyrics]) {
      if (stringValue.length) result[@"hasEmbeddedLyric"] = @YES;
    } else if ([identifier isEqualToString:AVMetadataIdentifierID3MetadataTrackNumber] ||
               [identifier isEqualToString:AVMetadataIdentifierID3MetadataPartOfASet]) {
      NSString *t = stringValue;
      if (t.length) {
        NSArray *parts = [t componentsSeparatedByString:@"/"];
        NSInteger num = [parts.firstObject integerValue];
        BOOL isTrack = [identifier isEqualToString:AVMetadataIdentifierID3MetadataTrackNumber];
        if (num > 0) result[isTrack ? @"trackNo" : @"discNo"] = @(num);
      }
    } else if ([identifier isEqualToString:AVMetadataIdentifieriTunesMetadataTrackNumber] ||
               [identifier isEqualToString:AVMetadataIdentifieriTunesMetadataDiscNumber]) {
      // iTunes trkn/disk：8 字节结构，第 3、4 字节大端
      if ([value isKindOfClass:[NSData class]]) {
        NSData *data = value;
        if (data.length >= 4) {
          const uint8_t *bytes = data.bytes;
          NSInteger num = (bytes[2] << 8) | bytes[3];
          BOOL isTrack = [identifier isEqualToString:AVMetadataIdentifieriTunesMetadataTrackNumber];
          if (num > 0) result[isTrack ? @"trackNo" : @"discNo"] = @(num);
        }
      }
    } else if ([identifier isEqualToString:AVMetadataIdentifierID3MetadataBand] ||
               [identifier isEqualToString:AVMetadataIdentifieriTunesMetadataAlbumArtist]) {
      NSString *t = [self cleanText:stringValue];
      if (t && result[@"albumArtist"] == [NSNull null]) result[@"albumArtist"] = t;
    } else if ([identifier isEqualToString:AVMetadataIdentifierID3MetadataLeadPerformer] ||
               [identifier isEqualToString:AVMetadataIdentifieriTunesMetadataArtist]) {
      NSString *t = [self cleanText:stringValue];
      if (t && result[@"artist"] == [NSNull null]) result[@"artist"] = t;
    }
  }

  // 码率：取第一条音轨的 estimatedDataRate
  for (AVAssetTrack *track in asset.tracks) {
    if ([track.mediaType isEqualToString:AVMediaTypeAudio]) {
      float rate = track.estimatedDataRate;
      if (isfinite(rate) && rate > 0) result[@"bitrate"] = @((long long)rate);
      break;
    }
  }

  // 文件大小
  NSError *sizeError = nil;
  NSDictionary *attrs = [NSFileManager.defaultManager attributesOfItemAtPath:fileURL.path error:&sizeError];
  if (!sizeError) result[@"size"] = attrs[NSFileSize] ?: @0;

  return result;
}

- (NSInteger)parseYear:(NSString *)text
{
  if (!text.length) return 0;
  // 取前 4 位数字
  NSMutableString *digits = [NSMutableString string];
  for (NSUInteger i = 0; i < text.length && digits.length < 4; i++) {
    unichar c = [text characterAtIndex:i];
    if (c >= '0' && c <= '9') [digits appendFormat:@"%C", c];
  }
  return digits.length >= 4 ? [digits integerValue] : 0;
}

#pragma mark - 封面

- (NSData *)extractArtwork:(NSData *)artworkData
{
  if (!artworkData.length) return nil;
  CGImageSourceRef source = CGImageSourceCreateWithData((__bridge CFDataRef)artworkData, NULL);
  if (!source) return nil;

  // 缩放到最长边 600（§5.5）
  NSDictionary *options = @{
    (NSString *)kCGImageSourceCreateThumbnailFromImageAlways: @YES,
    (NSString *)kCGImageSourceThumbnailMaxPixelSize: @(kArtworkMaxSide),
    (NSString *)kCGImageSourceCreateThumbnailWithTransform: @YES,
  };
  CGImageRef thumb = CGImageSourceCreateThumbnailAtIndex(source, 0, (__bridge CFDictionaryRef)options);
  CFRelease(source);
  if (!thumb) return nil;

  UIImage *image = [UIImage imageWithCGImage:thumb];
  CGImageRelease(thumb);
  NSData *jpeg = UIImageJPEGRepresentation(image, 0.85);
  return jpeg;
}

#pragma mark - 内嵌歌词

- (NSString *)readEmbeddedLyric:(NSURL *)fileURL
{
  if (!fileURL) return nil;
  AVURLAsset *asset = [AVURLAsset URLAssetWithURL:fileURL options:nil];
  dispatch_semaphore_t sem = dispatch_semaphore_create(0);
  __block BOOL loaded = NO;
  // 歌词只在格式专属的 metadata 里，不在 commonMetadata
  [asset loadValuesAsynchronouslyForKeys:@[@"metadata"] completionHandler:^{
    loaded = YES;
    dispatch_semaphore_signal(sem);
  }];
  dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kProbeTimeout * NSEC_PER_SEC)));
  if (!loaded) return nil;

  for (AVMetadataItem *item in asset.metadata) {
    if ([item.identifier isEqualToString:AVMetadataIdentifierID3MetadataUnsynchronizedLyric] ||
        [item.identifier isEqualToString:AVMetadataIdentifieriTunesMetadataLyrics]) {
      NSString *text = item.stringValue;
      if (text.length) return text;
    }
  }
  return nil;
}

@end
