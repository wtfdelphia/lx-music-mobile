#import <Foundation/Foundation.h>

// 媒体元数据探测（add-ios-local-library §5.4）。
// 按 AVMetadataIdentifier 精确匹配；缺失时标题降级为文件名。
// 单文件超时 8 秒，超时返回降级元数据（不阻断扫描）。
@interface LxMediaProbe : NSObject

+ (instancetype)shared;

// 读取单个文件的元数据。返回字典，失败时返回文件名降级结果
// 键：title, artist, album, albumArtist, trackNo, discNo, year, genre,
//     durationMs, bitrate, ext, size, artworkData(NSData), hasEmbeddedLyric
- (NSDictionary *)probeFile:(NSURL *)fileURL;

// 封面：从元数据中提取，缩放到最长边 600px 输出 JPEG
- (NSData * _Nullable)extractArtwork:(NSData *)artworkData;

// 歌词：读取内嵌歌词文本（§5.6）
- (NSString * _Nullable)readEmbeddedLyric:(NSURL *)fileURL;

@end
