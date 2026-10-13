#import <Foundation/Foundation.h>

// 封面缓存（add-ios-local-library §5.5）。
// 存于 Library/Caches/lx-library/artwork/，可被系统清理，丢失后按需重建。
// 文件名为原始字节的 SHA-1；同一专辑多首歌的封面相同自然去重。
@interface LxArtworkCache : NSObject

+ (instancetype)shared;

// 按内容哈希取缓存路径；未命中返回 nil
- (NSString * _Nullable)cachedPathForArtwork:(NSData *)artworkData;

// 写入缩放后的封面（原始字节做 SHA-1 命名）；返回缓存文件绝对路径
- (NSString * _Nullable)storeArtwork:(NSData *)scaledJPEG;

// 按定位符查缓存（由 Store 里存的缓存文件名）
- (NSString * _Nullable)pathForCachedName:(NSString *)cachedName;

// 封面缓存文件名 → file:// URL（专辑 / 艺人聚合行的封面展示用）。
// 未命中返回空串
- (NSString *)fileUrlForCachedName:(NSString *)cachedName;

- (NSString *)cacheDirectory;

@end
