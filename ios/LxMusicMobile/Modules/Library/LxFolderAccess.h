#import <Foundation/Foundation.h>

// 文件夹授权（add-ios-local-library §5.2）。
// security-scoped bookmark + 按来源引用计数持有；
// 沙箱内目录走相对路径分支，不生成 bookmark。
@interface LxFolderAccess : NSObject

+ (instancetype)shared;

// 记录一个来源的授权：沙箱内存相对路径，外部存 bookmark
- (BOOL)saveGrantForSourceId:(NSString *)sourceId config:(NSDictionary *)config;

// 引用计数持有：首次解析 bookmark 并开始访问；
// 失败返回错误码（E_REAUTH / E_NOT_FOUND）
- (BOOL)acquire:(NSString *)sourceId error:(NSError * _Nullable * _Nullable)error;
- (void)release:(NSString *)sourceId;

// 重新关联：只替换授权，不改变定位符（§5.2）
- (BOOL)relink:(NSString *)sourceId bookmark:(NSString *)bookmark label:(NSString *)label;

// 删除来源时强制释放并移除授权记录（§5.2）
- (void)forceReleaseForDelete:(NSString *)sourceId;

// 把来源根下的相对路径解析为绝对路径；越界返回 nil（§16 路径安全）
- (NSURL * _Nullable)resolveSourceId:(NSString *)sourceId relativePath:(NSString *)relPath;

// 来源根目录（扫描用）
- (NSURL * _Nullable)rootURLForSourceId:(NSString *)sourceId;

- (BOOL)isSandboxSource:(NSString *)sourceId;

@end
