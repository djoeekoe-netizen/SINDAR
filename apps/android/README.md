# SINDAR for Android (`apps/android`)

A thin native shell around the SINDAR web UI. The brain (`sindar gateway`) keeps running inside
Termux on the same phone (or on another machine); the app just shows the dashboard full-screen
and adds the few things a browser cannot do:

| Feature                  | How                                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------------------- |
| First connect            | `sindar app connect` in Termux opens `sindar://connect?url=…&token=…` → the app saves it             |
| Brain is off             | Bundled `connect.html#offline` page with **Start the brain** (Termux `RUN_COMMAND` → `sindar gateway run`) |
| Share to SINDAR          | `ACTION_SEND text/plain` → `?draft=` on first load / `sindar:draft` DOM event while running           |
| Downloads (PDFs, files)  | `DownloadListener` → Android `DownloadManager`                                                       |
| JS bridge                | `window.SindarNative` (`startBrain`, `openTermux`, `retry`, `ping`, `saveConnection`, …)             |

The UI itself is **not** bundled: it is served by the gateway, so `sindar update` updates the app's
screens too. Only the native shell needs a new APK.

## Build

Phones cannot build APKs, so GitHub Actions does it (`.github/workflows/android.yml`):
every push touching `apps/android/**` produces `SINDAR-dev.apk` on the rolling `dev` pre-release:

```
https://github.com/djoeekoe-netizen/SINDAR/releases/download/dev/SINDAR-dev.apk
```

Locally (JDK 17 + Android SDK 35 + Gradle 8.11):

```bash
gradle -p apps/android assembleRelease
# → apps/android/app/build/outputs/apk/release/app-release.apk
```

## Signing

Dev builds are signed with the **public** key in `keystore/sindar-dev.p12` (password `sindar-dev`,
alias `sindar`). That key is intentionally public: anyone can rebuild an APK that upgrades the dev
build in place. Before 1.0 (M9) CI switches to a private key through repository secrets
`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`
(a different key means uninstall + reinstall once).

## Requirements on the phone

- Android 8.0+ (`minSdk 26`), Termux from F-Droid with SINDAR installed (`scripts/install.sh`).
- For the **Start the brain** button: `allow-external-apps = true` in `~/.termux/termux.properties`
  (`sindar app connect` sets it) and the one-time Android permission dialog
  "Allow SINDAR to run commands in Termux".
