package com.softracker.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** after the phone starts (or the app was updated): connect again for alerts, when paired */
public class BootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c, Intent i) { AlertService.start(c); }
}
