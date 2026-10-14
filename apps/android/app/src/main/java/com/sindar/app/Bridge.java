package com.sindar.app;

import android.webkit.JavascriptInterface;
import org.json.JSONObject;

/**
 * `window.SindarNative` inside the WebView — used by the bundled connect/offline page and by
 * the web UI itself (e.g. the "start the brain" button in its disconnected banner).
 * Methods run on a background thread; anything touching the WebView hops to the UI thread.
 */
public final class Bridge {
  private final MainActivity activity;

  Bridge(MainActivity activity) {
    this.activity = activity;
  }

  @JavascriptInterface
  public String version() {
    return BuildConfig.VERSION_NAME;
  }

  @JavascriptInterface
  public String lang() {
    return java.util.Locale.getDefault().getLanguage();
  }

  /** {"url": "...", "token": "..."} or null when nothing is saved. */
  @JavascriptInterface
  public String getConnection() {
    Connection c = Connection.load(activity);
    if (c == null) return null;
    try {
      return new JSONObject().put("url", c.url).put("token", c.token).put("local", c.isLocal()).toString();
    } catch (Exception e) {
      return null;
    }
  }

  @JavascriptInterface
  public boolean saveConnection(String url, String token) {
    Connection c = Connection.save(activity, url, token);
    if (c == null) return false;
    activity.runOnUiThread(activity::openHome);
    return true;
  }

  @JavascriptInterface
  public void forget() {
    Connection.clear(activity);
    activity.runOnUiThread(activity::showConnect);
  }

  /** Try to start the brain in Termux; the page learns the outcome through onBrainStatus(). */
  @JavascriptInterface
  public void startBrain() {
    activity.runOnUiThread(activity::startBrain);
  }

  @JavascriptInterface
  public void openTermux() {
    activity.runOnUiThread(activity::openTermux);
  }

  @JavascriptInterface
  public void retry() {
    activity.runOnUiThread(activity::openHome);
  }

  /** Quiet health check; navigates home by itself when the brain answers. */
  @JavascriptInterface
  public void ping() {
    activity.runOnUiThread(activity::pingBrain);
  }

  @JavascriptInterface
  public boolean termuxInstalled() {
    return Termux.installed(activity);
  }

  @JavascriptInterface
  public String localUrl() {
    return Connection.LOCAL_URL;
  }
}
