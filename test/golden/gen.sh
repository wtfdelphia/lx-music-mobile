#!/usr/bin/env bash
# 加密黄金基准生成（JDK 引导版）
# 依赖：JDK 8+、curl。首次运行自动下载 BouncyCastle（SunJCE 不认 PKCS7Padding 名称）。
# 产物：test/crypto-golden-vectors.json
# 注意：发布前必须用 Android 真机产出的基准替换本引导基准（见 evidence/bridge-plan.md 停止条件 3）。
set -euo pipefail
cd "$(dirname "$0")/../.."

BC_JAR=test/golden/lib/bcprov-jdk15on-1.70.jar
if [ ! -f "$BC_JAR" ]; then
  mkdir -p test/golden/lib
  echo "下载 BouncyCastle..."
  curl -fsSL -o "$BC_JAR" https://repo1.maven.org/maven2/org/bouncycastle/bcprov-jdk15on/1.70/bcprov-jdk15on-1.70.jar
fi

OUT=${1:-test/crypto-golden-vectors.json}
BUILD=$(mktemp -d)
trap 'rm -rf "$BUILD"' EXIT

javac -encoding UTF-8 -cp "$BC_JAR" -d "$BUILD" \
  test/golden/shim/android/util/Base64.java \
  android/app/src/main/java/cn/toside/music/mobile/crypto/AES.java \
  android/app/src/main/java/cn/toside/music/mobile/crypto/RSA.java \
  test/golden/GenVectors.java

java -Dfile.encoding=UTF-8 -cp "$BUILD:$BC_JAR" GenVectors "$OUT"
