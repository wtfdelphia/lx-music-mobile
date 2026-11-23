#import <Foundation/Foundation.h>

// 曲库凭据存储（add-ios-local-library §5.7）。Keychain
// `kSecClassGenericPassword`，AfterFirstUnlock + ThisDeviceOnly，
// 锁屏后台连播时仍可取到服务端 token。
@interface LxCredentialStore : NSObject

+ (instancetype)shared;

- (BOOL)setSecret:(NSString *)secret forSourceId:(NSString *)sourceId;
- (NSString * _Nullable)getSecretForSourceId:(NSString *)sourceId;
- (BOOL)deleteSecretForSourceId:(NSString *)sourceId;

@end
