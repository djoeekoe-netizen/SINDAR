package com.sindar.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;

/** Where the brain lives (gateway URL + access token), persisted in app-private preferences. */
public final class Connection {
  private static final String PREFS = "sindar";
  private static final String KEY_URL = "url";
  private static final String KEY_TOKEN = "token";
  public static final String LOCAL_URL = "http://127.0.0.1:18789";

  public final String url;
  public final String token;

  private Connection(String url, String token) {
    this.url = url;
    this.token = token;
  }

  public static Connection load(Context ctx) {
    SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    String url = p.getString(KEY_URL, null);
    String token = p.getString(KEY_TOKEN, null);
    if (url == null || token == null || url.isEmpty() || token.isEmpty()) return null;
    return new Connection(url, token);
  }

  public static Connection save(Context ctx, String url, String token) {
    String clean = normalize(url);
    if (clean == null || token == null || token.trim().isEmpty()) return null;
    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit()
        .putString(KEY_URL, clean)
        .putString(KEY_TOKEN, token.trim())
        .apply();
    return new Connection(clean, token.trim());
  }

  public static void clear(Context ctx) {
    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply();
  }

  /** Accepts "127.0.0.1:18789", "http://host:port/", "https://x.y" → "http(s)://host[:port]" (no trailing slash). */
  public static String normalize(String raw) {
    if (raw == null) return null;
    String s = raw.trim();
    if (s.isEmpty()) return null;
    if (!s.startsWith("http://") && !s.startsWith("https://")) s = "http://" + s;
    Uri u = Uri.parse(s);
    if (u.getHost() == null || u.getHost().isEmpty()) return null;
    StringBuilder b = new StringBuilder();
    b.append(u.getScheme()).append("://").append(u.getHost());
    if (u.getPort() > 0) b.append(':').append(u.getPort());
    return b.toString();
  }

  /** The dashboard URL with the token (the web UI stores it and strips it from its address). */
  public String home() {
    return url + "/?token=" + Uri.encode(token);
  }

  public String health() {
    return url + "/health";
  }

  public boolean isLocal() {
    return url.startsWith("http://127.0.0.1") || url.startsWith("http://localhost");
  }
}
