#import "GzipModule.h"
#import <Foundation/Foundation.h>
#import <zlib.h>
#include <string.h>

static NSData *LxGzipCompress(NSData *data)
{
  z_stream strm;
  memset(&strm, 0, sizeof(strm));
  // windowBits = 31：gzip 容器（等价 Java GZIPOutputStream）
  if (deflateInit2(&strm, Z_DEFAULT_COMPRESSION, Z_DEFLATED, 31, 8, Z_DEFAULT_STRATEGY) != Z_OK) return nil;
  NSMutableData *out = [NSMutableData data];
  unsigned char buf[16384];
  strm.next_in = (Bytef *)data.bytes;
  strm.avail_in = (uInt)data.length;
  int status;
  do {
    strm.next_out = buf;
    strm.avail_out = sizeof(buf);
    status = deflate(&strm, Z_FINISH);
    if (status == Z_STREAM_ERROR) {
      deflateEnd(&strm);
      return nil;
    }
    [out appendBytes:buf length:sizeof(buf) - strm.avail_out];
  } while (status != Z_STREAM_END);
  deflateEnd(&strm);
  return out;
}

static NSData *LxGzipDecompress(NSData *data)
{
  z_stream strm;
  memset(&strm, 0, sizeof(strm));
  if (inflateInit2(&strm, 31) != Z_OK) return nil;
  NSMutableData *out = [NSMutableData data];
  unsigned char buf[16384];
  strm.next_in = (Bytef *)data.bytes;
  strm.avail_in = (uInt)data.length;
  int status;
  do {
    strm.next_out = buf;
    strm.avail_out = sizeof(buf);
    status = inflate(&strm, Z_NO_FLUSH);
    if (status == Z_STREAM_ERROR || status == Z_DATA_ERROR || status == Z_MEM_ERROR) {
      inflateEnd(&strm);
      return nil;
    }
    [out appendBytes:buf length:sizeof(buf) - strm.avail_out];
  } while (status != Z_STREAM_END && strm.avail_in > 0);
  inflateEnd(&strm);
  return status == Z_STREAM_END ? out : nil;
}

@implementation GzipModule

RCT_EXPORT_MODULE()

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

RCT_EXPORT_METHOD(gzipFile:(NSString *)fromPath
                  toPath:(NSString *)toPath
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  NSData *input = [NSData dataWithContentsOfFile:fromPath];
  if (input == nil) {
    reject(@"read_failed", @"Cannot read source file", nil);
    return;
  }
  NSData *output = LxGzipCompress(input);
  if (output == nil || ![output writeToFile:toPath atomically:YES]) {
    reject(@"gzip_failed", @"gzip file failed", nil);
    return;
  }
  resolve(nil);
}

RCT_EXPORT_METHOD(unGzipFile:(NSString *)fromPath
                  toPath:(NSString *)toPath
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  NSData *input = [NSData dataWithContentsOfFile:fromPath];
  if (input == nil) {
    reject(@"read_failed", @"Cannot read source file", nil);
    return;
  }
  NSData *output = LxGzipDecompress(input);
  if (output == nil || ![output writeToFile:toPath atomically:YES]) {
    reject(@"gunzip_failed", @"gunzip file failed", nil);
    return;
  }
  resolve(nil);
}

// 对齐 Java：输入按 encoding 取字节（base64 解码或 UTF-8），输出恒为 base64
RCT_EXPORT_METHOD(gzipString:(NSString *)data
                  encoding:(NSString *)encoding
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  NSData *input;
  if ([encoding isEqualToString:@"base64"]) {
    input = [[NSData alloc] initWithBase64EncodedString:(data ?: @"") options:NSDataBase64DecodingIgnoreUnknownCharacters];
    if (input == nil) {
      reject(@"decode_failed", @"Invalid base64 input", nil);
      return;
    }
  } else {
    input = [(data ?: @"") dataUsingEncoding:NSUTF8StringEncoding];
  }
  NSData *output = LxGzipCompress(input);
  if (output == nil) {
    reject(@"gzip_failed", @"gzip string failed", nil);
    return;
  }
  resolve([output base64EncodedStringWithOptions:0]);
}

// 对齐 Java：输入恒为 base64；输出按 encoding 返回（base64 或 UTF-8）
RCT_EXPORT_METHOD(unGzipString:(NSString *)data
                  encoding:(NSString *)encoding
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  NSData *input = [[NSData alloc] initWithBase64EncodedString:(data ?: @"") options:NSDataBase64DecodingIgnoreUnknownCharacters];
  if (input == nil) {
    reject(@"decode_failed", @"Invalid base64 input", nil);
    return;
  }
  NSData *output = LxGzipDecompress(input);
  if (output == nil) {
    reject(@"gunzip_failed", @"gunzip string failed", nil);
    return;
  }
  if ([encoding isEqualToString:@"base64"]) {
    resolve([output base64EncodedStringWithOptions:0]);
  } else {
    NSString *text = [[NSString alloc] initWithData:output encoding:NSUTF8StringEncoding];
    resolve(text != nil ? text : @"");
  }
}

@end
