#import <Foundation/Foundation.h>

// 曲库索引存储（add-ios-local-library §5.1）。sqlite3，WAL，FTS5。
// 所有查询走结构化参数，不接受 SQL 字符串（防注入）。
// 迁移用 PRAGMA user_version 控制。
@interface LxLibraryStore : NSObject

+ (instancetype)shared;

// 打开（幂等）。失败时返回 NO，后续方法返回空结果
- (BOOL)open;

#pragma mark - 来源
- (NSArray<NSDictionary *> *)getSources;
- (BOOL)saveSource:(NSDictionary *)source;
- (BOOL)deleteSource:(NSString *)sourceId;

#pragma mark - 曲目
// 批量 upsert，每条记录顺带打 seen 标记（§5.1，避免全量定位符过桥）
- (BOOL)upsertTracks:(NSString *)sourceId rows:(NSArray<NSDictionary *> *)rows;
// 删除本次同步未见、且不在保护列表里的曲目
- (NSInteger)finishSync:(NSString *)sourceId;
- (NSDictionary * _Nullable)getTrack:(NSString *)locator;
- (BOOL)deleteTrack:(NSString *)locator;
- (BOOL)setOffline:(NSString *)locator relPath:(NSString * _Nullable)relPath;
- (BOOL)bumpPlay:(NSString *)locator;

#pragma mark - 结构化查询
// spec: { kind, sourceIds?, keyword?, sort?, albumKey?, artistKey?, offset, limit }
- (NSDictionary *)query:(NSDictionary *)spec;

@end
