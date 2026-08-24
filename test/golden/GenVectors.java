import android.util.Base64;
import cn.toside.music.mobile.crypto.AES;
import cn.toside.music.mobile.crypto.RSA;

import java.io.FileOutputStream;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.security.Security;
import java.security.KeyPair;
import java.util.ArrayList;
import java.util.List;

/**
 * 加密黄金基准生成器（JDK 引导版）。
 *
 * 直接编译项目真实的 AES.java / RSA.java，保证基准与 Android 端实现同源。
 * 产出 test/crypto-golden-vectors.json，供 lxcore-crypto 的 cargo test 与
 * 未来的 iOS 桥接复跑使用。
 *
 * 用法：
 *   javac -encoding UTF-8 -d build/golden-classes \
 *     test/golden/shim/android/util/Base64.java \
 *     android/app/src/main/java/cn/toside/music/mobile/crypto/AES.java \
 *     android/app/src/main/java/cn/toside/music/mobile/crypto/RSA.java \
 *     test/golden/GenVectors.java
 *   java -Dfile.encoding=UTF-8 -cp build/golden-classes GenVectors test/crypto-golden-vectors.json
 */
public class GenVectors {

  static {
    // SunJCE 不认 "PKCS7Padding" 名称（Android 的 provider 认）。
    // BC 追加为最低优先级：仅补 PKCS7 名称，"AES" 默认补全等其余行为仍走 SunJCE，
    // 与文档中 JDK 实测的 provider 路径保持一致。
    try {
      Class<?> bc = Class.forName("org.bouncycastle.jce.provider.BouncyCastleProvider");
      Security.addProvider((java.security.Provider) bc.newInstance());
    } catch (Throwable t) {
      System.err.println("警告: BouncyCastle 未挂载，AES/CBC/PKCS7Padding 用例将失败: " + t);
    }
  }

  static String b64(byte[] in) {
    return new String(Base64.encode(in, Base64.NO_WRAP), StandardCharsets.UTF_8);
  }

  static String esc(String s) {
    StringBuilder sb = new StringBuilder();
    for (char c : s.toCharArray()) {
      switch (c) {
        case '"': sb.append("\\\""); break;
        case '\\': sb.append("\\\\"); break;
        case '\n': sb.append("\\n"); break;
        case '\r': sb.append("\\r"); break;
        case '\t': sb.append("\\t"); break;
        default:
          if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
          else sb.append(c);
      }
    }
    return sb.toString();
  }

  static void check(boolean ok, String what) {
    if (!ok) throw new IllegalStateException("自检失败: " + what);
  }

  public static void main(String[] args) throws Exception {
    if (args.length < 1) throw new IllegalArgumentException("用法: GenVectors <output.json>");

    byte[] key16 = "0123456789abcdef".getBytes(StandardCharsets.UTF_8);
    byte[] iv16 = "abcdef9876543210".getBytes(StandardCharsets.UTF_8);
    byte[] iv8 = "shortiv8".getBytes(StandardCharsets.UTF_8);
    byte[] iv24 = "abcdefgh24bytes-ivxxxxxx".getBytes(StandardCharsets.UTF_8);
    check(key16.length == 16 && iv16.length == 16 && iv8.length == 8 && iv24.length == 24, "测试向量长度");

    String[] plains = {
        "hello",
        "1234567890123456",
        "洛雪音乐助手跨端加密基准",
        "{\"musicName\":\"test\",\"singer\":\"lx\",\"interval\":123,\"list\":[1,2,3,4,5,6,7,8,9,10]}"
    };
    String[] plainNames = { "p1_5b", "p2_16b_aligned", "p3_utf8_zh", "p4_json_120b" };

    List<String> aesCases = new ArrayList<>();
    // CBC + 完整 IV / ECB + 空 IV：四种明文全矩阵
    for (int i = 0; i < plains.length; i++) {
      aesCases.add(aesCase("cbc_iv16_" + plainNames[i], plains[i], key16, iv16, "AES/CBC/PKCS7Padding"));
      aesCases.add(aesCase("ecb_noiv_" + plainNames[i], plains[i], key16, iv16, "AES"));
    }
    // IV 零填充 / 截断
    aesCases.add(aesCase("cbc_iv8_zeropad_p1", plains[0], key16, iv8, "AES/CBC/PKCS7Padding"));
    aesCases.add(aesCase("cbc_iv24_truncate_p1", plains[0], key16, iv24, "AES/CBC/PKCS7Padding"));

    // RSA
    KeyPair kp = RSA.getKeyPair();
    String pubKey = new String(Base64.encode(kp.getPublic().getEncoded(), Base64.DEFAULT), StandardCharsets.UTF_8);
    String privKey = new String(Base64.encode(kp.getPrivate().getEncoded(), Base64.DEFAULT), StandardCharsets.UTF_8);
    check(pubKey.contains("\r\n"), "generateRsaKey 公钥应带换行（DEFAULT flag）");

    List<String> rsaCases = new ArrayList<>();
    // OAEP-SHA1：密文随机，只固化 (密文样本, 明文) 供解密方向比对
    rsaCases.add(rsaCase("oaep_hello", "RSA/ECB/OAEPWithSHA1AndMGF1Padding",
        "hello".getBytes(StandardCharsets.UTF_8), pubKey, privKey, true));
    rsaCases.add(rsaCase("oaep_utf8_zh", "RSA/ECB/OAEPWithSHA1AndMGF1Padding",
        "同步密钥交换测试".getBytes(StandardCharsets.UTF_8), pubKey, privKey, true));
    // NoPadding（raw）：密文确定，加密方向也可字节级比对
    byte[] raw32 = new byte[32];
    for (int i = 0; i < 32; i++) raw32[i] = (byte) i;
    rsaCases.add(rsaCase("nopad_raw32", "RSA/ECB/NoPadding", raw32, pubKey, privKey, false));

    StringBuilder sb = new StringBuilder();
    sb.append("{\n");
    sb.append("  \"meta\": {\n");
    sb.append("    \"source\": \"jdk8-bootstrap\",\n");
    sb.append("    \"note\": \"JDK 8 引导基准：由项目真实 AES.java/RSA.java 编译产出。发布前必须用 Android 真机基准替换（见 openspec 桥计划停止条件 3）\",\n");
    sb.append("    \"java\": \"").append(esc(System.getProperty("java.version"))).append("\",\n");
    sb.append("    \"generatedAt\": \"").append(java.time.OffsetDateTime.now().toString()).append("\"\n");
    sb.append("  },\n");
    sb.append("  \"aes\": [\n").append(String.join(",\n", aesCases)).append("\n  ],\n");
    sb.append("  \"rsa\": {\n");
    sb.append("    \"publicKeyB64\": \"").append(esc(pubKey)).append("\",\n");
    sb.append("    \"privateKeyB64\": \"").append(esc(privKey)).append("\",\n");
    sb.append("    \"cases\": [\n").append(String.join(",\n", rsaCases)).append("\n    ]\n");
    sb.append("  }\n");
    sb.append("}\n");

    Writer w = new OutputStreamWriter(new FileOutputStream(args[0]), StandardCharsets.UTF_8);
    w.write(sb.toString());
    w.close();
    System.out.println("written: " + args[0] + " (aes=" + aesCases.size() + ", rsa=" + rsaCases.size() + ")");
  }

  static String aesCase(String name, String plain, byte[] key, byte[] iv, String mode) {
    String dataB64 = b64(plain.getBytes(StandardCharsets.UTF_8));
    String keyB64 = b64(key);
    String ivB64 = b64(iv);
    String cipher = AES.encrypt(dataB64, keyB64, "".equals(mode) ? ivB64 : (mode.equals("AES") ? "" : ivB64), mode);
    check(!cipher.isEmpty(), name + " 加密输出为空");
    // ECB（mode="AES"）走空 IV 重载，与生产用法一致（kw/util.js:198, plugins/sync/utils.ts:9）
    String back = AES.decrypt(cipher, keyB64, mode.equals("AES") ? "" : ivB64, mode);
    check(plain.equals(back), name + " 往返不一致");
    return "    { \"name\": \"" + name + "\", \"mode\": \"" + mode + "\", \"dataB64\": \"" + dataB64
        + "\", \"keyB64\": \"" + keyB64 + "\", \"ivB64\": \"" + (mode.equals("AES") ? "" : ivB64)
        + "\", \"expectCipherB64\": \"" + cipher + "\", \"expectPlainUtf8\": \"" + esc(plain) + "\" }";
  }

  static String rsaCase(String name, String padding, byte[] data, String pub, String priv, boolean utf8Check) {
    String dataB64 = b64(data);
    String cipher = RSA.encryptRSAToString(dataB64, pub, padding);
    check(!cipher.isEmpty(), name + " RSA 加密输出为空");
    String back = RSA.decryptRSAToString(cipher, priv, padding);
    if (utf8Check) {
      check(new String(data, StandardCharsets.UTF_8).equals(back), name + " OAEP 往返不一致");
    } else {
      // raw 模式返回整个模长块：前导零 + 原文
      byte[] backBytes = back.getBytes(StandardCharsets.UTF_8);
      check(backBytes.length == 256, name + " raw 解密块应为 256 字节，实际 " + backBytes.length);
      for (int i = 0; i < data.length; i++) {
        check(backBytes[256 - data.length + i] == data[i], name + " raw 块尾部与原文不一致");
      }
    }
    byte[] expectPlain = data;
    if (!utf8Check) {
      expectPlain = new byte[256];
      System.arraycopy(data, 0, expectPlain, 256 - data.length, data.length);
    }
    return "      { \"name\": \"" + name + "\", \"padding\": \"" + padding + "\", \"dataB64\": \"" + dataB64
        + "\", \"cipherB64\": \"" + cipher + "\", \"plainB64\": \"" + b64(expectPlain) + "\" }";
  }
}
