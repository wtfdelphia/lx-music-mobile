#import "LxCredentialStore.h"
#import <Security/Security.h>

static NSString * const kService = @"cn.toside.music.mobile.library";

@implementation LxCredentialStore

+ (instancetype)shared
{
  static LxCredentialStore *instance = nil;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    instance = [[LxCredentialStore alloc] init];
  });
  return instance;
}

- (NSMutableDictionary *)baseQueryForSourceId:(NSString *)sourceId
{
  return [@{
    (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
    (__bridge id)kSecAttrService: kService,
    (__bridge id)kSecAttrAccount: sourceId,
  } mutableCopy];
}

- (BOOL)setSecret:(NSString *)secret forSourceId:(NSString *)sourceId
{
  if (!secret.length || !sourceId.length) return NO;
  NSDictionary *query = [self baseQueryForSourceId:sourceId];
  NSData *data = [secret dataUsingEncoding:NSUTF8StringEncoding];
  NSDictionary *attributes = @{
    (__bridge id)kSecValueData: data,
    (__bridge id)kSecAttrAccessible: (__bridge id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
  };
  OSStatus status = SecItemUpdate((__bridge CFDictionaryRef)query, (__bridge CFDictionaryRef)attributes);
  if (status == errSecItemNotFound) {
    NSMutableDictionary *add = [query mutableCopy];
    [add addEntriesFromDictionary:attributes];
    status = SecItemAdd((__bridge CFDictionaryRef)add, NULL);
  }
  return status == errSecSuccess;
}

- (NSString *)getSecretForSourceId:(NSString *)sourceId
{
  if (!sourceId.length) return nil;
  NSMutableDictionary *query = [self baseQueryForSourceId:sourceId];
  query[(__bridge id)kSecReturnData] = @YES;
  query[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
  CFTypeRef result = NULL;
  OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
  if (status != errSecSuccess || !result) return nil;
  NSData *data = (__bridge_transfer NSData *)result;
  return [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
}

- (BOOL)deleteSecretForSourceId:(NSString *)sourceId
{
  if (!sourceId.length) return NO;
  NSDictionary *query = [self baseQueryForSourceId:sourceId];
  OSStatus status = SecItemDelete((__bridge CFDictionaryRef)query);
  return status == errSecSuccess || status == errSecItemNotFound;
}

@end
