#import <Foundation/Foundation.h>

// 桥值清洗（add-ios-local-library）：JS 的 null 经 RN 桥到达 ObjC 后是
// NSNull 而不是 nil，对 NSNull 发 NSString / NSNumber 消息会直接抛
// `unrecognized selector` 崩掉 App。所有从桥字典取值的读取点必须经过
// 这两个函数，不允许裸取后直接发消息。
static inline NSString * _Nullable LxStr(id _Nullable value) {
  return [value isKindOfClass:[NSString class]] ? (NSString *)value : nil;
}

static inline NSNumber * _Nullable LxNum(id _Nullable value) {
  return [value isKindOfClass:[NSNumber class]] ? (NSNumber *)value : nil;
}

static inline BOOL LxBool(id _Nullable value) {
  return [LxNum(value) boolValue];
}

static inline long long LxLong(id _Nullable value) {
  return [LxNum(value) longLongValue];
}
