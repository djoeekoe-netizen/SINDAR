package com.sindar.app;

import android.annotation.SuppressLint;
import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.URLUtil;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import androidx.activity.OnBackPressedCallback;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

/**
 * SINDAR for Android = a full-screen WebView showing the gateway's web UI (served by the brain
 * running in Termux on this phone, or on another machine) plus a little native glue:
 *   • first-connect page + deep link `sindar://connect?url=…&token=…` from `sindar app connect`
 *   • offline page with a "start the brain" button (Termux RUN_COMMAND) when the brain is down
 *   • share-to-SINDAR → prefills the composer (`?draft=` / `sindar:draft` event)
 */
public class MainActivity extends AppCompatActivity {
  private static final String CONNECT_PAGE = "file:///android_asset/connect.html";
  private static final int BRAIN_WAIT_MS = 45_000;

  private WebView web;
  private final Handler ui = new Handler(Looper.getMainLooper());
  private String pendingDraft;
  private boolean homeLoaded;
  private boolean waitingForBrain;
  private volatile int brainWaitGeneration;

  @SuppressLint("SetJavaScriptEnabled")
  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    web = new WebView(this);
    web.setBackgroundColor(Color.parseColor("#0B1020"));
    web.setLayoutParams(
        new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    setContentView(web);

    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);
    s.setDatabaseEnabled(true);
    s.setMediaPlaybackRequiresUserGesture(false);
    s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
    s.setSupportZoom(false);
    s.setBuiltInZoomControls(false);
    s.setLoadWithOverviewMode(true);
    s.setUseWideViewPort(true);
    s.setCacheMode(WebSettings.LOAD_DEFAULT);
    s.setUserAgentString(s.getUserAgentString() + " SINDARApp/" + BuildConfig.VERSION_NAME);
    CookieManager.getInstance().setAcceptCookie(true);

    web.addJavascriptInterface(new Bridge(this), "SindarNative");
    web.setWebViewClient(new Client());
    web.setDownloadListener(new Downloads());

    getOnBackPressedDispatcher()
        .addCallback(
            this,
            new OnBackPressedCallback(true) {
              @Override
              public void handleOnBackPressed() {
                if (web != null && web.canGoBack() && isGatewayUrl(web.getUrl())) {
                  web.goBack();
                } else {
                  moveTaskToBack(true);
                }
              }
            });

    boolean handled = handleIntent(getIntent());
    if (!handled) openHome();
  }

  @Override
  protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    handleIntent(intent);
  }

  /** Deep links and shares. Returns true when it already navigated somewhere. */
  private boolean handleIntent(Intent intent) {
    if (intent == null) return false;
    String action = intent.getAction();
    if (Intent.ACTION_VIEW.equals(action) && intent.getData() != null) {
      Uri u = intent.getData();
      if ("sindar".equals(u.getScheme())) {
        intent.setData(null); // don't replay on config changes
        if ("connect".equals(u.getHost())) {
          Connection c = Connection.save(this, u.getQueryParameter("url"), u.getQueryParameter("token"));
          if (c == null) {
            toast(R.string.toast_bad_link);
            showConnect();
          } else {
            toast(R.string.toast_connected);
            openHome();
          }
          return true;
        }
        if ("draft".equals(u.getHost())) {
          deliverDraft(u.getQueryParameter("text"));
          return true;
        }
      }
      return false;
    }
    if (Intent.ACTION_SEND.equals(action) && "text/plain".equals(intent.getType())) {
      String text = intent.getStringExtra(Intent.EXTRA_TEXT);
      String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
      StringBuilder b = new StringBuilder();
      if (subject != null && !subject.trim().isEmpty()) b.append(subject.trim()).append('\n');
      if (text != null) b.append(text.trim());
      intent.removeExtra(Intent.EXTRA_TEXT);
      if (b.length() > 0) deliverDraft(b.toString());
      return b.length() > 0;
    }
    return false;
  }

  /** Put text into the composer: live via a DOM event when the UI is up, else through `?draft=`. */
  private void deliverDraft(String text) {
    if (text == null || text.isEmpty()) return;
    if (homeLoaded && web != null && isGatewayUrl(web.getUrl())) {
      String js =
          "window.dispatchEvent(new CustomEvent('sindar:draft',{detail:"
              + JSONObject.quote(text)
              + "}))";
      web.evaluateJavascript(js, null);
    } else {
      pendingDraft = text;
      openHome();
    }
  }

  // ---- navigation ---------------------------------------------------------

  /** Load the dashboard if we know where the brain is, otherwise the connect page. */
  void openHome() {
    Connection c = Connection.load(this);
    if (c == null) {
      showConnect();
      return;
    }
    String url = c.home();
    if (pendingDraft != null) {
      url += "&draft=" + Uri.encode(pendingDraft);
      pendingDraft = null;
    }
    homeLoaded = false;
    web.loadUrl(url);
  }

  void showConnect() {
    homeLoaded = false;
    web.loadUrl(CONNECT_PAGE + "#connect");
  }

  void showOffline() {
    homeLoaded = false;
    web.loadUrl(CONNECT_PAGE + "#offline");
  }

  private boolean isGatewayUrl(String url) {
    if (url == null) return false;
    Connection c = Connection.load(this);
    return c != null && url.startsWith(c.url);
  }

  // ---- the brain (Termux) -------------------------------------------------

  /** Called by the offline page / web UI: start `sindar gateway run` inside Termux and wait for /health. */
  void startBrain() {
    if (!Termux.installed(this)) {
      toast(R.string.toast_termux_missing);
      notifyBrain("missing");
      Termux.openInstallPage(this);
      return;
    }
    if (!Termux.hasPermission(this)) {
      notifyBrain("permission");
      Termux.requestPermission(this);
      return;
    }
    boolean sent = Termux.startBrain(this);
    if (!sent) {
      openTermux();
      return;
    }
    notifyBrain("starting");
    waitForBrain();
  }

  void openTermux() {
    if (!Termux.installed(this)) {
      toast(R.string.toast_termux_missing);
      Termux.openInstallPage(this);
      return;
    }
    if (Termux.open(this)) toast(R.string.toast_termux_opened);
  }

  @Override
  public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] results) {
    super.onRequestPermissionsResult(requestCode, permissions, results);
    if (requestCode != Termux.REQ_PERMISSION) return;
    boolean granted = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
    if (granted) {
      startBrain();
    } else {
      toast(R.string.toast_permission);
      notifyBrain("denied");
    }
  }

  /** Poll /health off the UI thread until the brain answers (or we give up). */
  private void waitForBrain() {
    Connection c = Connection.load(this);
    final String health = (c == null ? Connection.LOCAL_URL : c.url) + "/health";
    final int gen = ++brainWaitGeneration;
    waitingForBrain = true;
    new Thread(
            () -> {
              long deadline = System.currentTimeMillis() + BRAIN_WAIT_MS;
              int tick = 0;
              while (System.currentTimeMillis() < deadline && gen == brainWaitGeneration) {
                if (healthOk(health)) {
                  ui.post(
                      () -> {
                        if (gen != brainWaitGeneration) return;
                        waitingForBrain = false;
                        notifyBrain("up");
                        openHome();
                      });
                  return;
                }
                final int secs = ++tick;
                ui.post(() -> notifyBrain("waiting:" + secs));
                try {
                  Thread.sleep(1000);
                } catch (InterruptedException e) {
                  return;
                }
              }
              ui.post(
                  () -> {
                    if (gen != brainWaitGeneration) return;
                    waitingForBrain = false;
                    notifyBrain("timeout");
                  });
            },
            "sindar-health")
        .start();
  }

  /** One quiet background health check (the offline page calls this every few seconds). */
  void pingBrain() {
    if (waitingForBrain) return;
    Connection c = Connection.load(this);
    if (c == null) return;
    final String health = c.health();
    new Thread(
            () -> {
              if (healthOk(health)) ui.post(() -> {
                if (!homeLoaded && !waitingForBrain) openHome();
              });
            },
            "sindar-ping")
        .start();
  }

  static boolean healthOk(String url) {
    HttpURLConnection conn = null;
    try {
      conn = (HttpURLConnection) new URL(url).openConnection();
      conn.setConnectTimeout(1200);
      conn.setReadTimeout(1500);
      conn.setRequestProperty("Accept", "application/json");
      if (conn.getResponseCode() != 200) return false;
      try (InputStream in = conn.getInputStream()) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[2048];
        int n;
        while ((n = in.read(buf)) > 0 && out.size() < 65_536) out.write(buf, 0, n);
        String body = new String(out.toByteArray(), StandardCharsets.UTF_8);
        return body.contains("\"sindar\"");
      }
    } catch (Exception e) {
      return false;
    } finally {
      if (conn != null) conn.disconnect();
    }
  }

  /** Tell whichever page is showing (connect.html or the web UI) what the brain is doing. */
  private void notifyBrain(String status) {
    if (web == null) return;
    String js =
        "window.dispatchEvent(new CustomEvent('sindar:brain',{detail:" + JSONObject.quote(status) + "}))";
    web.evaluateJavascript(js, null);
  }

  // ---- misc ---------------------------------------------------------------

  void toast(int res) {
    Toast.makeText(this, res, Toast.LENGTH_LONG).show();
  }

  @Override
  protected void onResume() {
    super.onResume();
    if (web != null) web.onResume();
    // Coming back from Termux (or anywhere) while the offline page shows: re-check quietly.
    if (web != null && !homeLoaded && Connection.load(this) != null && !waitingForBrain) {
      String url = web.getUrl();
      if (url != null && url.startsWith(CONNECT_PAGE) && url.endsWith("#offline")) {
        new Thread(
                () -> {
                  Connection c = Connection.load(this);
                  if (c != null && healthOk(c.health())) ui.post(this::openHome);
                },
                "sindar-resume")
            .start();
      }
    }
  }

  @Override
  protected void onPause() {
    if (web != null) web.onPause();
    super.onPause();
  }

  @Override
  protected void onDestroy() {
    brainWaitGeneration++;
    if (web != null) {
      web.destroy();
      web = null;
    }
    super.onDestroy();
  }

  // ---- WebView plumbing ---------------------------------------------------

  private final class Client extends WebViewClient {
    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
      Uri u = request.getUrl();
      String url = u.toString();
      if (url.startsWith(CONNECT_PAGE) || isGatewayUrl(url)) return false;
      String scheme = u.getScheme();
      if ("http".equals(scheme) || "https".equals(scheme) || "mailto".equals(scheme) || "tel".equals(scheme)) {
        try {
          startActivity(new Intent(Intent.ACTION_VIEW, u));
        } catch (Exception ignored) {
          // nothing can open it — stay here
        }
        return true;
      }
      return true;
    }

    @Override
    public void onPageFinished(WebView view, String url) {
      super.onPageFinished(view, url);
      if (isGatewayUrl(url)) homeLoaded = true;
    }

    @Override
    public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
      super.onReceivedError(view, request, error);
      if (!request.isForMainFrame()) return;
      String failing = request.getUrl().toString();
      if (!isGatewayUrl(failing)) return;
      // The brain is down (or unreachable) → our own offline page with the start button.
      showOffline();
    }
  }

  private final class Downloads implements DownloadListener {
    @Override
    public void onDownloadStart(
        String url, String userAgent, String contentDisposition, String mimeType, long contentLength) {
      try {
        DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
        String name = URLUtil.guessFileName(url, contentDisposition, mimeType);
        req.setMimeType(mimeType);
        req.setTitle(name);
        req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
        req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
        String cookies = CookieManager.getInstance().getCookie(url);
        if (cookies != null) req.addRequestHeader("Cookie", cookies);
        req.addRequestHeader("User-Agent", userAgent);
        DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
        if (dm != null) {
          dm.enqueue(req);
          toast(R.string.toast_downloading);
        }
      } catch (Exception e) {
        try {
          startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (Exception ignored) {
          // give up quietly
        }
      }
    }
  }
}
