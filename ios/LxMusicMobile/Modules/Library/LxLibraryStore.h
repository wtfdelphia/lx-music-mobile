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
// 全量 itemKey（自动关联差量对账用，避免 limit 200 截断）
- (NSArray<NSString *> *)listItemKeysForSourceId:(NSString *)sourceId;
// 排除表：从曲库移除（不删文件），重扫 / 对账不再入库（§16）
- (BOOL)excludeTrack:(NSString *)sourceId itemKey:(NSString *)itemKey;
- (BOOL)restoreExcluded:(NSString *)sourceId;
- (NSArray<NSString *> *)listExcludedItemKeysForSourceId:(NSString *)sourceId;
- (BOOL)isExcluded:(NSString *)sourceId itemKey:(NSString *)itemKey;
// 来源曲目数（来源管理列表显示用）
- (NSInteger)countTracksForSourceId:(NSString *)sourceId;

// ---- 测试钩子（仅自测标记门控，正式包无副作用） ----
// 关闭并删除数据库文件，重置打开标记
- (void)closeAndDrop;
// 来源配置与类型（授权懒加载用，F1）
- (NSDictionary * _Nullable)configForSourceId:(NSString *)sourceId;
// 扫描结束时间 / 报告落库（低危项修复）
- (BOOL)updateScanState:(NSString *)sourceId lastScanAt:(long long)at report:(NSString * _Nullable)report;
- (BOOL)setOffline:(NSString *)locator relPath:(NSString * _Nullable)relPath;
- (BOOL)bumpPlay:(NSString *)locator;

#pragma mark - 结构化查询
// spec: { kind, sourceIds?, keyword?, sort?, albumKey?, artistKey?, offset, limit }
- (NSDictionary *)query:(NSDictionary *)spec;

@end
