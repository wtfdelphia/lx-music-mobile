#import "LxLibraryStore.h"
#import <sqlite3.h>

// 曲库索引存储实现（add-ios-local-library §5.1）：
// - WAL + foreign_keys=ON，目录排除 iCloud 备份
// - user_version 迁移（当前 v1）
// - upsert 即打 seen 标记，finishSync 只删未见行（§5.1 修正）
// - 结构化查询，limit 上限 200；CJK 关键词退化为 LIKE（FTS5 unicode61 不切中文）

static NSString * const kDatabaseFileName = @"library.sqlite3";
static const NSInteger kQueryLimitMax = 200;

static BOOL LxIsAllCJK(NSString *s)
{
  if (s.length == 0) return NO;
  for (NSUInteger i = 0; i < s.length; ) {
    unichar c = [s characterAtIndex:i];
    if (CFStringIsSurrogateHighCharacter(c)) { i += 2; continue; }
    BOOL cjk = (c >= 0x4E00 && c <= 0x9FFF) ||
               (c >= 0x3400 && c <= 0x4DBF) ||
               (c >= 0x3000 && c <= 0x303F) ||
               (c >= 0xFF00 && c <= 0xFFEF) ||
               (c >= 0x3040 && c <= 0x30FF);
    if (!cjk) return NO;
    i++;
  }
  return YES;
}

static NSString *LxEscapeLike(NSString *s)
{
  NSMutableString *out = [NSMutableString stringWithCapacity:s.length];
  for (NSUInteger i = 0; i < s.length; i++) {
    unichar c = [s characterAtIndex:i];
    if (c == '%' || c == '_' || c == '\\') [out appendString:@"\\"];
    [out appendFormat:@"%C", c];
  }
  return out;
}

@implementation LxLibraryStore {
  sqlite3 *_db;
  dispatch_queue_t _ioQueue;
  BOOL _opened;
}

+ (instancetype)shared
{
  static LxLibraryStore *instance = nil;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    instance = [[LxLibraryStore alloc] init];
  });
  return instance;
}

- (instancetype)init
{
  if (self = [super init]) {
    _ioQueue = dispatch_queue_create("lx.library.io", DISPATCH_QUEUE_SERIAL);
    _db = NULL;
    _opened = NO;
  }
  return self;
}

#pragma mark - 打开与迁移

- (NSString *)databasePath
{
  NSString *appSupport = [NSSearchPathForDirectoriesInDomains(NSApplicationSupportDirectory, NSUserDomainMask, YES) firstObject];
  NSString *dir = [appSupport stringByAppendingPathComponent:@"lx-library"];
  return [dir stringByAppendingPathComponent:kDatabaseFileName];
}

- (BOOL)open
{
  __block BOOL ok = NO;
  dispatch_sync(_ioQueue, ^{
    ok = [self _openOnQueue];
  });
  return ok;
}

- (BOOL)_openOnQueue
{
  if (_opened) return YES;
  NSString *dir = [[self databasePath] stringByDeletingLastPathComponent];
  NSError *dirError = nil;
  [[NSFileManager defaultManager] createDirectoryAtPath:dir
                            withIntermediateDirectories:YES
                                             attributes:@{NSURLIsExcludedFromBackupKey: @YES}
                                                  error:&dirError];
  if (dirError) return NO;

  if (sqlite3_open([self databasePath].UTF8String, &_db) != SQLITE_OK) {
    sqlite3_close(_db);
    _db = NULL;
    return NO;
  }
  sqlite3_exec(_db, "PRAGMA journal_mode=WAL;", NULL, NULL, NULL);
  sqlite3_exec(_db, "PRAGMA foreign_keys=ON;", NULL, NULL, NULL);

  [self _migrateOnQueue];
  _opened = YES;
  return YES;
}

- (int)userVersion
{
  int version = 0;
  sqlite3_stmt *stmt = NULL;
  if (sqlite3_prepare_v2(_db, "PRAGMA user_version;", -1, &stmt, NULL) == SQLITE_OK) {
    if (sqlite3_step(stmt) == SQLITE_ROW) version = sqlite3_column_int(stmt, 0);
  }
  sqlite3_finalize(stmt);
  return version;
}

- (void)_migrateOnQueue
{
  if ([self userVersion] >= 1) return;
  const char *schema =
    "CREATE TABLE IF NOT EXISTS source ("
    "  id TEXT PRIMARY KEY, type TEXT NOT NULL,"
    "  name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,"
    "  config TEXT NOT NULL,"
    "  state TEXT NOT NULL DEFAULT 'ok',"
    "  last_scan_at INTEGER, last_scan_report TEXT,"
    "  created_at INTEGER NOT NULL"
    ");"
    "CREATE TABLE IF NOT EXISTS track ("
    "  locator TEXT PRIMARY KEY,"
    "  source_id TEXT NOT NULL REFERENCES source(id) ON DELETE CASCADE,"
    "  item_key TEXT NOT NULL,"
    "  title TEXT NOT NULL, title_sort TEXT NOT NULL,"
    "  artist TEXT, album TEXT, album_artist TEXT,"
    "  album_key TEXT NOT NULL, artist_key TEXT NOT NULL,"
    "  track_no INTEGER, disc_no INTEGER, year INTEGER, genre TEXT,"
    "  duration_ms INTEGER NOT NULL DEFAULT 0,"
    "  bitrate INTEGER, ext TEXT, size INTEGER, mtime INTEGER,"
    "  artwork TEXT,"
    "  has_embedded_lyric INTEGER NOT NULL DEFAULT 0, sidecar_lrc TEXT,"
    "  remote_starred INTEGER, offline_path TEXT,"
    "  added_at INTEGER NOT NULL,"
    "  play_count INTEGER NOT NULL DEFAULT 0, last_played_at INTEGER,"
    "  seen INTEGER NOT NULL DEFAULT 0"
    ");"
    "CREATE INDEX IF NOT EXISTS idx_track_source ON track(source_id);"
    "CREATE INDEX IF NOT EXISTS idx_track_album ON track(album_key, disc_no, track_no);"
    "CREATE INDEX IF NOT EXISTS idx_track_artist ON track(artist_key);"
    "CREATE INDEX IF NOT EXISTS idx_track_title ON track(title_sort);"
    "CREATE VIRTUAL TABLE IF NOT EXISTS track_fts USING fts5("
    "  title, artist, album, content='track', content_rowid='rowid',"
    "  tokenize='unicode61 remove_diacritics 2'"
    ");"
    "CREATE TRIGGER IF NOT EXISTS track_ai AFTER INSERT ON track BEGIN"
    "  INSERT INTO track_fts(rowid, title, artist, album)"
    "  VALUES (new.rowid, new.title, COALESCE(new.artist,''), COALESCE(new.album,''));"
    "END;"
    "CREATE TRIGGER IF NOT EXISTS track_ad AFTER DELETE ON track BEGIN"
    "  INSERT INTO track_fts(track_fts, rowid, title, artist, album)"
    "  VALUES ('delete', old.rowid, old.title, COALESCE(old.artist,''), COALESCE(old.album,''));"
    "END;"
    "CREATE TRIGGER IF NOT EXISTS track_au AFTER UPDATE ON track BEGIN"
    "  INSERT INTO track_fts(track_fts, rowid, title, artist, album)"
    "  VALUES ('delete', old.rowid, old.title, COALESCE(old.artist,''), COALESCE(old.album,''));"
    "  INSERT INTO track_fts(rowid, title, artist, album)"
    "  VALUES (new.rowid, new.title, COALESCE(new.artist,''), COALESCE(new.album,''));"
    "END;";
  char *errMsg = NULL;
  if (sqlite3_exec(_db, schema, NULL, NULL, &errMsg) != SQLITE_OK) {
    NSLog(@"[LxLibraryStore] migrate failed: %s", errMsg ? errMsg : "?");
    sqlite3_free(errMsg);
    return;
  }
  sqlite3_exec(_db, "PRAGMA user_version=1;", NULL, NULL, NULL);
}

#pragma mark - 工具

- (NSDictionary *)rowToDict:(sqlite3_stmt *)stmt withType:(NSString *)sourceType
{
  const unsigned char *locator = sqlite3_column_text(stmt, 0);
  const unsigned char *sourceId = sqlite3_column_text(stmt, 1);
  const unsigned char *itemKey = sqlite3_column_text(stmt, 2);
  const unsigned char *title = sqlite3_column_text(stmt, 3);
  const unsigned char *artist = sqlite3_column_text(stmt, 4);
  const unsigned char *album = sqlite3_column_text(stmt, 5);
  const unsigned char *albumArtist = sqlite3_column_text(stmt, 6);
  const unsigned char *ext = sqlite3_column_text(stmt, 7);
  const unsigned char *artwork = sqlite3_column_text(stmt, 8);
  NSMutableDictionary *row = [NSMutableDictionary dictionary];
  row[@"locator"] = locator ? [NSString stringWithUTF8String:(const char *)locator] : @"";
  row[@"sourceId"] = sourceId ? [NSString stringWithUTF8String:(const char *)sourceId] : @"";
  row[@"sourceType"] = sourceType ?: @"local";
  row[@"itemKey"] = itemKey ? [NSString stringWithUTF8String:(const char *)itemKey] : @"";
  row[@"title"] = title ? [NSString stringWithUTF8String:(const char *)title] : @"";
  row[@"artist"] = artist ? [NSString stringWithUTF8String:(const char *)artist] : [NSNull null];
  row[@"album"] = album ? [NSString stringWithUTF8String:(const char *)album] : [NSNull null];
  row[@"albumArtist"] = albumArtist ? [NSString stringWithUTF8String:(const char *)albumArtist] : [NSNull null];
  row[@"durationMs"] = @(sqlite3_column_int64(stmt, 9));
  row[@"ext"] = ext ? [NSString stringWithUTF8String:(const char *)ext] : [NSNull null];
  row[@"artwork"] = artwork ? [NSString stringWithUTF8String:(const char *)artwork] : [NSNull null];
  const unsigned char *offline = sqlite3_column_text(stmt, 10);
  row[@"offlinePath"] = offline ? [NSString stringWithUTF8String:(const char *)offline] : [NSNull null];
  return row;
}

// 曲目查询的列序必须与 rowToDict 一致
static NSString * const kTrackColumns =
  @"locator, source_id, item_key, title, artist, album, album_artist, ext, artwork, duration_ms, offline_path";

#pragma mark - 来源

- (NSArray<NSDictionary *> *)getSources
{
  __block NSMutableArray *out = [NSMutableArray array];
  dispatch_sync(_ioQueue, ^{
    if (![self _openOnQueue]) return;
    sqlite3_stmt *stmt = NULL;
    const char *sql = "SELECT id, type, name, enabled, config, state, last_scan_at, last_scan_report, created_at FROM source ORDER BY created_at";
    if (sqlite3_prepare_v2(self->_db, sql, -1, &stmt, NULL) != SQLITE_OK) return;
    while (sqlite3_step(stmt) == SQLITE_ROW) {
      NSMutableDictionary *row = [NSMutableDictionary dictionary];
      row[@"id"] = [NSString stringWithUTF8String:(const char *)sqlite3_column_text(stmt, 0)];
      row[@"type"] = [NSString stringWithUTF8String:(const char *)sqlite3_column_text(stmt, 1)];
      row[@"name"] = [NSString stringWithUTF8String:(const char *)sqlite3_column_text(stmt, 2)];
      row[@"enabled"] = @(sqlite3_column_int(stmt, 3) != 0);
      row[@"config"] = [NSString stringWithUTF8String:(const char *)sqlite3_column_text(stmt, 4)];
      row[@"state"] = [NSString stringWithUTF8String:(const char *)sqlite3_column_text(stmt, 5)];
      row[@"lastScanAt"] = sqlite3_column_type(stmt, 6) == SQLITE_NULL ? [NSNull null] : @(sqlite3_column_int64(stmt, 6));
      row[@"lastScanReport"] = sqlite3_column_type(stmt, 7) == SQLITE_NULL ? [NSNull null] : [NSString stringWithUTF8String:(const char *)sqlite3_column_text(stmt, 7)];
      row[@"createdAt"] = @(sqlite3_column_int64(stmt, 8));
      [out addObject:row];
    }
    sqlite3_finalize(stmt);
  });
  return out;
}

- (BOOL)saveSource:(NSDictionary *)source
{
  NSString *sourceId = source[@"id"];
  if (!sourceId.length) return NO;
  __block BOOL ok = NO;
  dispatch_sync(_ioQueue, ^{
    if (![self _openOnQueue]) return;
    sqlite3_stmt *stmt = NULL;
    const char *sql =
      "INSERT INTO source(id, type, name, enabled, config, state, last_scan_at, last_scan_report, created_at) "
      "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) "
      "ON CONFLICT(id) DO UPDATE SET type=?2, name=?3, enabled=?4, config=?5, state=?6, last_scan_at=?7, last_scan_report=?8";
    if (sqlite3_prepare_v2(self->_db, sql, -1, &stmt, NULL) != SQLITE_OK) return;
    sqlite3_bind_text(stmt, 1, sourceId.UTF8String, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 2, [source[@"type"] ?: @"local" UTF8String], -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 3, [source[@"name"] ?: @"" UTF8String], -1, SQLITE_TRANSIENT);
    sqlite3_bind_int(stmt, 4, [source[@"enabled"] boolValue] ? 1 : 0);
    sqlite3_bind_text(stmt, 5, [source[@"config"] ?: @"{}" UTF8String], -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 6, [source[@"state"] ?: @"ok" UTF8String], -1, SQLITE_TRANSIENT);
    id lastScanAt = source[@"lastScanAt"];
    if (!lastScanAt || lastScanAt == [NSNull null]) sqlite3_bind_null(stmt, 7);
    else sqlite3_bind_int64(stmt, 7, [lastScanAt longLongValue]);
    id report = source[@"lastScanReport"];
    if (!report || report == [NSNull null]) sqlite3_bind_null(stmt, 8);
    else sqlite3_bind_text(stmt, 8, [report UTF8String], -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(stmt, 9, [source[@"createdAt"] ?: @((long long)([[NSDate date] timeIntervalSince1970] * 1000)) longLongValue]);
    ok = sqlite3_step(stmt) == SQLITE_DONE;
    sqlite3_finalize(stmt);
  });
  return ok;
}

- (BOOL)deleteSource:(NSString *)sourceId
{
  if (!sourceId.length) return NO;
  __block BOOL ok = NO;
  dispatch_sync(_ioQueue, ^{
    if (![self _openOnQueue]) return;
    sqlite3_stmt *stmt = NULL;
    // 曲目由 ON DELETE CASCADE 级联
    if (sqlite3_prepare_v2(self->_db, "DELETE FROM source WHERE id = ?1", -1, &stmt, NULL) != SQLITE_OK) return;
    sqlite3_bind_text(stmt, 1, sourceId.UTF8String, -1, SQLITE_TRANSIENT);
    ok = sqlite3_step(stmt) == SQLITE_DONE;
    sqlite3_finalize(stmt);
  });
  return ok;
}

#pragma mark - 曲目写入

- (BOOL)upsertTracks:(NSString *)sourceId rows:(NSArray<NSDictionary *> *)rows
{
  if (!sourceId.length || !rows.count) return NO;
  __block BOOL ok = YES;
  dispatch_sync(_ioQueue, ^{
    if (![self _openOnQueue]) { ok = NO; return; }
    sqlite3_exec(self->_db, "BEGIN IMMEDIATE;", NULL, NULL, NULL);
    sqlite3_stmt *stmt = NULL;
    const char *sql =
      "INSERT INTO track(locator, source_id, item_key, title, title_sort, artist, album, album_artist, "
      "album_key, artist_key, track_no, disc_no, year, genre, duration_ms, bitrate, ext, size, mtime, "
      "artwork, has_embedded_lyric, sidecar_lrc, added_at, seen) "
      "VALUES (?1, ?2, ?3, ?4, lower(?4), ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, 1) "
      "ON CONFLICT(locator) DO UPDATE SET title=?4, title_sort=lower(?4), artist=?5, album=?6, album_artist=?7, "
      "album_key=?8, artist_key=?9, track_no=?10, disc_no=?11, year=?12, genre=?13, duration_ms=?14, bitrate=?15, "
      "ext=?16, size=?17, mtime=?18, artwork=?19, has_embedded_lyric=?20, sidecar_lrc=?21, seen=1";
    if (sqlite3_prepare_v2(self->_db, sql, -1, &stmt, NULL) != SQLITE_OK) {
      sqlite3_exec(self->_db, "ROLLBACK;", NULL, NULL, NULL);
      ok = NO;
      return;
    }
    long long now = (long long)([[NSDate date] timeIntervalSince1970] * 1000);
    for (NSDictionary *row in rows) {
      NSString *locator = row[@"locator"];
      NSString *itemKey = row[@"item_key"];
      NSString *title = row[@"title"] ?: itemKey;
      NSString *artist = row[@"artist"];
      NSString *album = row[@"album"];
      NSString *albumArtist = row[@"album_artist"];
      NSString *artistKey = [((albumArtist.length ? albumArtist : (artist ?: @"")) ?: @"") lowercaseString];
      // album_key = artist_key + '\001' + album（\u 转义不允许控制字符，用八进制）
      NSString *albumKey = [NSString stringWithFormat:@"%@\001%@", artistKey, [((album ?: @"")) lowercaseString]];
      sqlite3_reset(stmt);
      sqlite3_clear_bindings(stmt);
      sqlite3_bind_text(stmt, 1, locator.UTF8String, -1, SQLITE_TRANSIENT);
      sqlite3_bind_text(stmt, 2, sourceId.UTF8String, -1, SQLITE_TRANSIENT);
      sqlite3_bind_text(stmt, 3, (itemKey ?: @"").UTF8String, -1, SQLITE_TRANSIENT);
      sqlite3_bind_text(stmt, 4, title.UTF8String, -1, SQLITE_TRANSIENT);
      if (artist && artist != (id)[NSNull null]) sqlite3_bind_text(stmt, 5, [artist UTF8String], -1, SQLITE_TRANSIENT); else sqlite3_bind_null(stmt, 5);
      if (album && album != (id)[NSNull null]) sqlite3_bind_text(stmt, 6, [album UTF8String], -1, SQLITE_TRANSIENT); else sqlite3_bind_null(stmt, 6);
      if (albumArtist && albumArtist != (id)[NSNull null]) sqlite3_bind_text(stmt, 7, [albumArtist UTF8String], -1, SQLITE_TRANSIENT); else sqlite3_bind_null(stmt, 7);
      sqlite3_bind_text(stmt, 8, albumKey.UTF8String, -1, SQLITE_TRANSIENT);
      sqlite3_bind_text(stmt, 9, artistKey.UTF8String, -1, SQLITE_TRANSIENT);
      [self bindNumber:row[@"track_no"] toStatement:stmt index:10];
      [self bindNumber:row[@"disc_no"] toStatement:stmt index:11];
      [self bindNumber:row[@"year"] toStatement:stmt index:12];
      id genre = row[@"genre"];
      if (genre && genre != [NSNull null]) sqlite3_bind_text(stmt, 13, [genre UTF8String], -1, SQLITE_TRANSIENT); else sqlite3_bind_null(stmt, 13);
      sqlite3_bind_int64(stmt, 14, [row[@"duration_ms"] ?: @0 longLongValue]);
      [self bindNumber:row[@"bitrate"] toStatement:stmt index:15];
      id ext = row[@"ext"];
      if (ext && ext != [NSNull null]) sqlite3_bind_text(stmt, 16, [ext UTF8String], -1, SQLITE_TRANSIENT); else sqlite3_bind_null(stmt, 16);
      [self bindNumber:row[@"size"] toStatement:stmt index:17];
      [self bindNumber:row[@"mtime"] toStatement:stmt index:18];
      id artwork = row[@"artwork"];
      if (artwork && artwork != [NSNull null]) sqlite3_bind_text(stmt, 19, [artwork UTF8String], -1, SQLITE_TRANSIENT); else sqlite3_bind_null(stmt, 19);
      sqlite3_bind_int(stmt, 20, [row[@"has_embedded_lyric"] boolValue] ? 1 : 0);
      id sidecar = row[@"sidecar_lrc"];
      if (sidecar && sidecar != [NSNull null]) sqlite3_bind_text(stmt, 21, [sidecar UTF8String], -1, SQLITE_TRANSIENT); else sqlite3_bind_null(stmt, 21);
      sqlite3_bind_int64(stmt, 22, now);
      if (sqlite3_step(stmt) != SQLITE_DONE) {
        NSLog(@"[LxLibraryStore] upsert failed for %@: %s", locator, sqlite3_errmsg(self->_db));
        ok = NO;
        break;
      }
    }
    sqlite3_finalize(stmt);
    sqlite3_exec(self->_db, ok ? "COMMIT;" : "ROLLBACK;", NULL, NULL, NULL);
  });
  return ok;
}

- (void)bindNumber:(id)value toStatement:(sqlite3_stmt *)stmt index:(int)index
{
  if (value && value != [NSNull null]) sqlite3_bind_int64(stmt, index, [value longLongValue]);
  else sqlite3_bind_null(stmt, index);
}

- (NSInteger)finishSync:(NSString *)sourceId
{
  if (!sourceId.length) return 0;
  __block NSInteger removed = 0;
  dispatch_sync(_ioQueue, ^{
    if (![self _openOnQueue]) return;
    sqlite3_exec(self->_db, "BEGIN IMMEDIATE;", NULL, NULL, NULL);
    // 删除保护：子目录读取失败时该子目录下的曲目不被清理（§5.3），
    // 由扫描侧传入 unreadable 前缀；这里按 seen 标记执行
    sqlite3_stmt *stmt = NULL;
    const char *sql = "DELETE FROM track WHERE source_id = ?1 AND seen = 0";
    if (sqlite3_prepare_v2(self->_db, sql, -1, &stmt, NULL) == SQLITE_OK) {
      sqlite3_bind_text(stmt, 1, sourceId.UTF8String, -1, SQLITE_TRANSIENT);
      if (sqlite3_step(stmt) == SQLITE_DONE) removed = sqlite3_changes(self->_db);
      sqlite3_finalize(stmt);
    }
    // 重置 seen，为下一轮扫描做准备
    sqlite3_stmt *reset = NULL;
    if (sqlite3_prepare_v2(self->_db, "UPDATE track SET seen = 0 WHERE source_id = ?1", -1, &reset, NULL) == SQLITE_OK) {
      sqlite3_bind_text(reset, 1, sourceId.UTF8String, -1, SQLITE_TRANSIENT);
      sqlite3_step(reset);
      sqlite3_finalize(reset);
    }
    sqlite3_exec(self->_db, "COMMIT;", NULL, NULL, NULL);
  });
  return removed;
}

- (NSDictionary *)getTrack:(NSString *)locator
{
  if (!locator.length) return nil;
  __block NSDictionary *out = nil;
  dispatch_sync(_ioQueue, ^{
    if (![self _openOnQueue]) return;
    NSString *sql = [NSString stringWithFormat:@"SELECT %@, s.type FROM track t JOIN source s ON t.source_id = s.id WHERE t.locator = ?1", kTrackColumns];
    sqlite3_stmt *stmt = NULL;
    if (sqlite3_prepare_v2(self->_db, sql.UTF8String, -1, &stmt, NULL) != SQLITE_OK) return;
    sqlite3_bind_text(stmt, 1, locator.UTF8String, -1, SQLITE_TRANSIENT);
    if (sqlite3_step(stmt) == SQLITE_ROW) {
      const unsigned char *type = sqlite3_column_text(stmt, 11);
      out = [self rowToDict:stmt withType:type ? [NSString stringWithUTF8String:(const char *)type] : @"local"];
    }
    sqlite3_finalize(stmt);
  });
  return out;
}

- (BOOL)deleteTrack:(NSString *)locator
{
  if (!locator.length) return NO;
  __block BOOL ok = NO;
  dispatch_sync(_ioQueue, ^{
    if (![self _openOnQueue]) return;
    sqlite3_stmt *stmt = NULL;
    if (sqlite3_prepare_v2(self->_db, "DELETE FROM track WHERE locator = ?1", -1, &stmt, NULL) != SQLITE_OK) return;
    sqlite3_bind_text(stmt, 1, locator.UTF8String, -1, SQLITE_TRANSIENT);
    ok = sqlite3_step(stmt) == SQLITE_DONE;
    sqlite3_finalize(stmt);
  });
  return ok;
}

- (BOOL)setOffline:(NSString *)locator relPath:(NSString *)relPath
{
  if (!locator.length) return NO;
  __block BOOL ok = NO;
  dispatch_sync(_ioQueue, ^{
    if (![self _openOnQueue]) return;
    sqlite3_stmt *stmt = NULL;
    if (sqlite3_prepare_v2(self->_db, "UPDATE track SET offline_path = ?2 WHERE locator = ?1", -1, &stmt, NULL) != SQLITE_OK) return;
    sqlite3_bind_text(stmt, 1, locator.UTF8String, -1, SQLITE_TRANSIENT);
    if (relPath.length) sqlite3_bind_text(stmt, 2, relPath.UTF8String, -1, SQLITE_TRANSIENT);
    else sqlite3_bind_null(stmt, 2);
    ok = sqlite3_step(stmt) == SQLITE_DONE;
    sqlite3_finalize(stmt);
  });
  return ok;
}

- (BOOL)bumpPlay:(NSString *)locator
{
  if (!locator.length) return NO;
  __block BOOL ok = NO;
  dispatch_sync(_ioQueue, ^{
    if (![self _openOnQueue]) return;
    sqlite3_stmt *stmt = NULL;
    long long now = (long long)([[NSDate date] timeIntervalSince1970] * 1000);
    if (sqlite3_prepare_v2(self->_db, "UPDATE track SET play_count = play_count + 1, last_played_at = ?2 WHERE locator = ?1", -1, &stmt, NULL) != SQLITE_OK) return;
    sqlite3_bind_text(stmt, 1, locator.UTF8String, -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(stmt, 2, now);
    ok = sqlite3_step(stmt) == SQLITE_DONE;
    sqlite3_finalize(stmt);
  });
  return ok;
}

#pragma mark - 结构化查询

- (NSDictionary *)query:(NSDictionary *)spec
{
  NSString *kind = spec[@"kind"] ?: @"tracks";
  __block NSMutableArray *rows = [NSMutableArray array];
  __block NSInteger total = 0;
  dispatch_sync(_ioQueue, ^{
    if (![self _openOnQueue]) return;
    NSInteger offset = [spec[@"offset"] ?: @0 integerValue];
    NSInteger limit = [spec[@"limit"] ?: @(kQueryLimitMax) integerValue];
    if (limit <= 0 || limit > kQueryLimitMax) limit = kQueryLimitMax;
    if (offset < 0) offset = 0;
    NSString *keyword = spec[@"keyword"];
    NSArray *sourceIds = spec[@"sourceIds"];
    NSString *albumKey = spec[@"albumKey"];
    NSString *artistKey = spec[@"artistKey"];

    if ([kind isEqualToString:@"albums"]) {
      [self _queryAlbumsRows:rows total:&total sourceIds:sourceIds keyword:keyword offset:offset limit:limit];
      return;
    }
    if ([kind isEqualToString:@"artists"]) {
      [self _queryArtistsRows:rows total:&total sourceIds:sourceIds keyword:keyword offset:offset limit:limit];
      return;
    }
    if ([kind isEqualToString:@"albumTracks"]) {
      [self _queryKeyedTracksRows:rows total:&total sourceIds:sourceIds keyColumn:@"album_key" key:albumKey offset:offset limit:limit];
      return;
    }
    if ([kind isEqualToString:@"artistTracks"]) {
      [self _queryKeyedTracksRows:rows total:&total sourceIds:sourceIds keyColumn:@"artist_key" key:artistKey offset:offset limit:limit];
      return;
    }
    [self _queryTracksRows:rows total:&total sourceIds:sourceIds keyword:keyword sort:spec[@"sort"] offset:offset limit:limit];
  });
  return @{ @"rows": rows, @"total": @(total) };
}

- (void)appendSourceFilter:(NSMutableString *)sql bindings:(NSMutableArray *)bindings sourceIds:(NSArray *)sourceIds
{
  if (!sourceIds.count) return;
  NSMutableArray *placeholders = [NSMutableArray array];
  for (id sid in sourceIds) [placeholders addObject:@"?"];
  [sql appendFormat:@" AND t.source_id IN (%@)", [placeholders componentsJoinedByString:@","]];
  [bindings addObjectsFromArray:sourceIds];
}

- (void)appendKeywordFilter:(NSMutableString *)sql bindings:(NSMutableArray *)bindings keyword:(NSString *)keyword
{
  if (!keyword.length) return;
  if (LxIsAllCJK(keyword)) {
    // FTS5 unicode61 不切分 CJK：退回 LIKE（§5.1）
    NSString *esc = LxEscapeLike(keyword);
    [sql appendFormat:@" AND (t.title LIKE '%%%@%%' ESCAPE '\\' OR t.artist LIKE '%%%@%%' ESCAPE '\\' OR t.album LIKE '%%%@%%' ESCAPE '\\')", esc, esc, esc];
  } else {
    // FTS 前缀查询：rowid join
    NSString *ftsTerm = [NSString stringWithFormat:@"%@*", keyword];
    [sql appendFormat:@" AND t.rowid IN (SELECT rowid FROM track_fts WHERE track_fts MATCH ?%lu)", (unsigned long)(bindings.count + 1)];
    [bindings addObject:ftsTerm];
  }
}

- (void)_queryTracksRows:(NSMutableArray *)rows total:(NSInteger *)totalOut
               sourceIds:(NSArray *)sourceIds keyword:(NSString *)keyword
                    sort:(NSString *)sort offset:(NSInteger)offset limit:(NSInteger)limit
{
  NSMutableString *where = [NSMutableString stringWithString:@"WHERE 1=1"];
  NSMutableArray *bindings = [NSMutableArray array];
  [self appendSourceFilter:where bindings:bindings sourceIds:sourceIds];
  [self appendKeywordFilter:where bindings:bindings keyword:keyword];

  NSString *orderBy = @"t.title_sort";
  if ([sort isEqualToString:@"artist"]) orderBy = @"t.artist_key, t.title_sort";
  else if ([sort isEqualToString:@"album"]) orderBy = @"t.album_key, t.disc_no, t.track_no";
  else if ([sort isEqualToString:@"added"]) orderBy = @"t.added_at DESC";

  NSString *sql = [NSString stringWithFormat:@"SELECT %@, s.type FROM track t JOIN source s ON t.source_id = s.id %@ ORDER BY %@ LIMIT %ld OFFSET %ld",
                   kTrackColumns, where, orderBy, (long)limit, (long)offset];
  sqlite3_stmt *stmt = NULL;
  if (sqlite3_prepare_v2(_db, sql.UTF8String, -1, &stmt, NULL) != SQLITE_OK) return;
  [self bindStrings:bindings toStatement:stmt];
  while (sqlite3_step(stmt) == SQLITE_ROW) {
    const unsigned char *type = sqlite3_column_text(stmt, 11);
    [rows addObject:[self rowToDict:stmt withType:type ? [NSString stringWithUTF8String:(const char *)type] : @"local"]];
  }
  sqlite3_finalize(stmt);

  NSString *countSql = [NSString stringWithFormat:@"SELECT COUNT(*) FROM track t %@", where];
  sqlite3_stmt *cstmt = NULL;
  if (sqlite3_prepare_v2(_db, countSql.UTF8String, -1, &cstmt, NULL) == SQLITE_OK) {
    [self bindStrings:bindings toStatement:cstmt];
    if (sqlite3_step(cstmt) == SQLITE_ROW) *totalOut = sqlite3_column_int64(cstmt, 0);
    sqlite3_finalize(cstmt);
  }
}

- (void)bindStrings:(NSArray *)bindings toStatement:(sqlite3_stmt *)stmt
{
  int index = 1;
  for (NSString *value in bindings) {
    sqlite3_bind_text(stmt, index, [value UTF8String], -1, SQLITE_TRANSIENT);
    index++;
  }
}

- (void)_queryAlbumsRows:(NSMutableArray *)rows total:(NSInteger *)totalOut
               sourceIds:(NSArray *)sourceIds keyword:(NSString *)keyword
                  offset:(NSInteger)offset limit:(NSInteger)limit
{
  NSMutableString *where = [NSMutableString stringWithString:@"WHERE 1=1"];
  NSMutableArray *bindings = [NSMutableArray array];
  [self appendSourceFilter:where bindings:bindings sourceIds:sourceIds];
  [self appendKeywordFilter:where bindings:bindings keyword:keyword];

  // 专辑行：合成定位符用 album_key；title=专辑，artist=专辑艺人（§5.1 键）
  NSString *sql = [NSString stringWithFormat:
    @"SELECT t.album_key AS locator, MIN(t.source_id) AS source_id, t.album_key AS item_key, "
    @"COALESCE(NULLIF(t.album, ''), '(null)') AS title, MIN(t.artist) AS artist, MIN(t.album) AS album, "
    @"MIN(t.album_artist) AS album_artist, NULL AS ext, MIN(t.artwork) AS artwork, 0 AS duration_ms, NULL AS offline_path, MIN(s.type) AS type "
    @"FROM track t JOIN source s ON t.source_id = s.id %@ "
    @"GROUP BY t.album_key ORDER BY t.album_key LIMIT %ld OFFSET %ld",
    where, (long)limit, (long)offset];
  sqlite3_stmt *stmt = NULL;
  if (sqlite3_prepare_v2(_db, sql.UTF8String, -1, &stmt, NULL) != SQLITE_OK) return;
  [self bindStrings:bindings toStatement:stmt];
  while (sqlite3_step(stmt) == SQLITE_ROW) {
    const unsigned char *type = sqlite3_column_text(stmt, 11);
    [rows addObject:[self rowToDict:stmt withType:type ? [NSString stringWithUTF8String:(const char *)type] : @"local"]];
  }
  sqlite3_finalize(stmt);

  NSString *countSql = [NSString stringWithFormat:@"SELECT COUNT(DISTINCT t.album_key) FROM track t %@", where];
  sqlite3_stmt *cstmt = NULL;
  if (sqlite3_prepare_v2(_db, countSql.UTF8String, -1, &cstmt, NULL) == SQLITE_OK) {
    [self bindStrings:bindings toStatement:cstmt];
    if (sqlite3_step(cstmt) == SQLITE_ROW) *totalOut = sqlite3_column_int64(cstmt, 0);
    sqlite3_finalize(cstmt);
  }
}

- (void)_queryArtistsRows:(NSMutableArray *)rows total:(NSInteger *)totalOut
                sourceIds:(NSArray *)sourceIds keyword:(NSString *)keyword
                   offset:(NSInteger)offset limit:(NSInteger)limit
{
  NSMutableString *where = [NSMutableString stringWithString:@"WHERE 1=1"];
  NSMutableArray *bindings = [NSMutableArray array];
  [self appendSourceFilter:where bindings:bindings sourceIds:sourceIds];
  [self appendKeywordFilter:where bindings:bindings keyword:keyword];

  NSString *sql = [NSString stringWithFormat:
    @"SELECT t.artist_key AS locator, MIN(t.source_id) AS source_id, t.artist_key AS item_key, "
    @"COALESCE(NULLIF(t.artist, ''), '(null)') AS title, NULL AS artist, NULL AS album, "
    @"NULL AS album_artist, NULL AS ext, MIN(t.artwork) AS artwork, 0 AS duration_ms, NULL AS offline_path, MIN(s.type) AS type "
    @"FROM track t JOIN source s ON t.source_id = s.id %@ "
    @"GROUP BY t.artist_key ORDER BY t.artist_key LIMIT %ld OFFSET %ld",
    where, (long)limit, (long)offset];
  sqlite3_stmt *stmt = NULL;
  if (sqlite3_prepare_v2(_db, sql.UTF8String, -1, &stmt, NULL) != SQLITE_OK) return;
  [self bindStrings:bindings toStatement:stmt];
  while (sqlite3_step(stmt) == SQLITE_ROW) {
    const unsigned char *type = sqlite3_column_text(stmt, 11);
    [rows addObject:[self rowToDict:stmt withType:type ? [NSString stringWithUTF8String:(const char *)type] : @"local"]];
  }
  sqlite3_finalize(stmt);

  NSString *countSql = [NSString stringWithFormat:@"SELECT COUNT(DISTINCT t.artist_key) FROM track t %@", where];
  sqlite3_stmt *cstmt = NULL;
  if (sqlite3_prepare_v2(_db, countSql.UTF8String, -1, &cstmt, NULL) == SQLITE_OK) {
    [self bindStrings:bindings toStatement:cstmt];
    if (sqlite3_step(cstmt) == SQLITE_ROW) *totalOut = sqlite3_column_int64(cstmt, 0);
    sqlite3_finalize(cstmt);
  }
}

- (void)_queryKeyedTracksRows:(NSMutableArray *)rows total:(NSInteger *)totalOut
                    sourceIds:(NSArray *)sourceIds keyColumn:(NSString *)keyColumn key:(NSString *)key
                       offset:(NSInteger)offset limit:(NSInteger)limit
{
  if (!key.length) return;
  NSMutableString *where = [NSMutableString stringWithFormat:@"WHERE t.%@ = ?", keyColumn];
  NSMutableArray *bindings = [NSMutableArray arrayWithObject:key];
  [self appendSourceFilter:where bindings:bindings sourceIds:sourceIds];

  NSString *sql = [NSString stringWithFormat:
    @"SELECT %@, s.type FROM track t JOIN source s ON t.source_id = s.id %@ ORDER BY t.disc_no, t.track_no, t.title_sort LIMIT %ld OFFSET %ld",
    kTrackColumns, where, (long)limit, (long)offset];
  sqlite3_stmt *stmt = NULL;
  if (sqlite3_prepare_v2(_db, sql.UTF8String, -1, &stmt, NULL) != SQLITE_OK) return;
  [self bindStrings:bindings toStatement:stmt];
  while (sqlite3_step(stmt) == SQLITE_ROW) {
    const unsigned char *type = sqlite3_column_text(stmt, 11);
    [rows addObject:[self rowToDict:stmt withType:type ? [NSString stringWithUTF8String:(const char *)type] : @"local"]];
  }
  sqlite3_finalize(stmt);

  NSString *countSql = [NSString stringWithFormat:@"SELECT COUNT(*) FROM track t %@", where];
  sqlite3_stmt *cstmt = NULL;
  if (sqlite3_prepare_v2(_db, countSql.UTF8String, -1, &cstmt, NULL) == SQLITE_OK) {
    [self bindStrings:bindings toStatement:cstmt];
    if (sqlite3_step(cstmt) == SQLITE_ROW) *totalOut = sqlite3_column_int64(cstmt, 0);
    sqlite3_finalize(cstmt);
  }
}

@end
