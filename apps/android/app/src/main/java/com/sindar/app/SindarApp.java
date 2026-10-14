package com.sindar.app;

import android.app.Application;
import android.webkit.WebView;

public class SindarApp extends Application {
  @Override
  public void onCreate() {
    super.onCreate();
    if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true);
  }
}
