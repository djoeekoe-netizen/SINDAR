# Keep the JS bridge (reflection from the WebView).
-keepclassmembers class com.sindar.app.Bridge { @android.webkit.JavascriptInterface <methods>; }
