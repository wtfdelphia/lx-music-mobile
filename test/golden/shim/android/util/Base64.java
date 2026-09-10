package android.util;

/**
 * 仅用于黄金基准生成的 android.util.Base64 JVM shim。
 *
 * 对齐 Android 行为的两点：
 * - decode 宽松：忽略字母表外字符（含换行），缺失填充自动补齐
 * - encode NO_WRAP：标准字母表 + '=' 填充、无换行
 * - encode DEFAULT：每 76 字符换行（CRLF）；末尾换行与 Android 实现可能存在
 *   细微差异，但密钥解码端一律宽松，不影响基准正确性
 */
public class Base64 {
  public static final int DEFAULT = 0;
  public static final int NO_WRAP = 2;

  public static byte[] decode(String str, int flags) {
    return decode(str.getBytes(), flags);
  }

  public static byte[] decode(byte[] input, int flags) {
    StringBuilder sb = new StringBuilder();
    for (byte b : input) {
      char c = (char) (b & 0xff);
      if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')
          || c == '+' || c == '/' || c == '=') {
        sb.append(c);
      }
    }
    String s = sb.toString();
    int mod = s.length() % 4;
    if (mod == 2) s += "==";
    else if (mod == 3) s += "=";
    return java.util.Base64.getDecoder().decode(s);
  }

  public static byte[] encode(byte[] input, int flags) {
    String s = java.util.Base64.getEncoder().encodeToString(input);
    if ((flags & NO_WRAP) == 0) {
      StringBuilder sb = new StringBuilder();
      for (int i = 0; i < s.length(); i += 76) {
        sb.append(s, i, Math.min(i + 76, s.length()));
        if (i + 76 < s.length()) sb.append("\r\n");
      }
      s = sb.toString();
    }
    try {
      return s.getBytes("UTF-8");
    } catch (java.io.UnsupportedEncodingException e) {
      return s.getBytes();
    }
  }
}
