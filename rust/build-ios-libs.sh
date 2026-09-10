#!/usr/bin/env bash
# 构建 lxcore-crypto iOS staticlib 并放置到 ios/rust-libs/（任务 3.1）。
# CI（GH Actions macos runner）与 macOS 本地自编译共用。
# 产物按 Xcode PLATFORM_NAME 分目录：
#   ios/rust-libs/iphoneos/liblxcore_crypto.a        （真机：arm64）
#   ios/rust-libs/iphonesimulator/liblxcore_crypto.a （模拟器：arm64 + x86_64 通用库）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

TARGET_DEVICE=aarch64-apple-ios
TARGET_SIM_ARM64=aarch64-apple-ios-sim
TARGET_SIM_X64=x86_64-apple-ios

rustup target add "$TARGET_DEVICE" "$TARGET_SIM_ARM64" "$TARGET_SIM_X64" >/dev/null 2>&1 || true

cd "$ROOT/rust/lxcore"
cargo build --locked --release -p lxcore-crypto \
  --target "$TARGET_DEVICE" --target "$TARGET_SIM_ARM64" --target "$TARGET_SIM_X64"

mkdir -p "$ROOT/ios/rust-libs/iphoneos" "$ROOT/ios/rust-libs/iphonesimulator"
cp "target/$TARGET_DEVICE/release/liblxcore_crypto.a" "$ROOT/ios/rust-libs/iphoneos/"
# arm64 设备片与 arm64 模拟器片平台不同不能共处一个 fat 库，故按目录拆分；
# 模拟器目录内合并 arm64/x86_64 两种宿主架构
lipo -create \
  "target/$TARGET_SIM_ARM64/release/liblxcore_crypto.a" \
  "target/$TARGET_SIM_X64/release/liblxcore_crypto.a" \
  -output "$ROOT/ios/rust-libs/iphonesimulator/liblxcore_crypto.a"
echo "liblxcore_crypto.a -> ios/rust-libs/{iphoneos,iphonesimulator}/"
