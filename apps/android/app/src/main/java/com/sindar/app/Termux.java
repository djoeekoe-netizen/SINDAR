package com.sindar.app;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

/**
 * Talks to the Termux app on the same phone: starts the brain through Termux's RUN_COMMAND
 * service (needs `allow-external-apps=true` in ~/.termux/termux.properties — `sindar app connect`
 * sets it) or simply brings Termux to the front as a fallback.
 */
public final class Termux {
  public static final String PACKAGE = "com.termux";
  public static final String PERMISSION = "com.termux.permission.RUN_COMMAND";
  public static final int REQ_PERMISSION = 7001;
  private static final String PREFIX = "/data/data/com.termux/files/usr";
  private static final String HOME = "/data/data/com.termux/files/home";

  private Termux() {}

  public static boolean installed(Activity a) {
    try {
      a.getPackageManager().getPackageInfo(PACKAGE, 0);
      return true;
    } catch (PackageManager.NameNotFoundException e) {
      return false;
    }
  }

  public static boolean hasPermission(Activity a) {
    return ContextCompat.checkSelfPermission(a, PERMISSION) == PackageManager.PERMISSION_GRANTED;
  }

  public static void requestPermission(Activity a) {
    ActivityCompat.requestPermissions(a, new String[] {PERMISSION}, REQ_PERMISSION);
  }

  /** Ask Termux to run `sindar gateway run` as a background task (keeps Termux's service alive). */
  public static boolean startBrain(Activity a) {
    Intent i = new Intent();
    i.setClassName(PACKAGE, "com.termux.app.RunCommandService");
    i.setAction("com.termux.RUN_COMMAND");
    i.putExtra("com.termux.RUN_COMMAND_PATH", PREFIX + "/bin/bash");
    i.putExtra(
        "com.termux.RUN_COMMAND_ARGUMENTS",
        new String[] {"-lc", "exec node \"$(command -v sindar)\" gateway run"});
    i.putExtra("com.termux.RUN_COMMAND_WORKDIR", HOME);
    i.putExtra("com.termux.RUN_COMMAND_BACKGROUND", true);
    i.putExtra("com.termux.RUN_COMMAND_SESSION_ACTION", "0");
    i.putExtra("com.termux.RUN_COMMAND_COMMAND_LABEL", "SINDAR brain");
    try {
      ContextCompat.startForegroundService(a, i);
      return true;
    } catch (Exception e) {
      return false;
    }
  }

  /** Bring Termux to the front (the user types the command). */
  public static boolean open(Activity a) {
    Intent launch = a.getPackageManager().getLaunchIntentForPackage(PACKAGE);
    if (launch == null) return false;
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    try {
      a.startActivity(launch);
      return true;
    } catch (Exception e) {
      return false;
    }
  }

  public static void openInstallPage(Activity a) {
    try {
      a.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://f-droid.org/packages/com.termux/")));
    } catch (Exception ignored) {
      // no browser — nothing else to do
    }
  }
}
