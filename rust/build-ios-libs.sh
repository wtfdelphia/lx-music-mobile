#!/usr/bin/env bash
# 构建 lxcore-crypto iOS staticlib 并放置到 ios/rust-libs/（任务 3.1）。
# CI（GH Actions macos runner）与 macOS 本地自编译共用。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

rustup target add aarch64-apple-ios >/dev/null 2>&1 || true

cd "$ROOT/rust/lxcore"
cargo build --locked --release --target aarch64-apple-ios -p lxcore-crypto

mkdir -p "$ROOT/ios/rust-libs"
cp target/aarch64-apple-ios/release/liblxcore_crypto.a "$ROOT/ios/rust-libs/"
echo "liblxcore_crypto.a -> ios/rust-libs/"
