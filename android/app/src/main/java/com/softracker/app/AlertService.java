package com.softracker.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Stays connected to the private ntfy topic the PC sends its alerts to (a long-lived https stream of one JSON line
 * per message) and shows each alert as an Android notification. Works on any network. Reconnects by itself, and
 * after a reconnect fetches what was missed (ntfy keeps messages 12 hours). Runs as a foreground service, which is
 * how Android lets an app keep such a connection open; its own small notification says so.
 */
public class AlertService extends Service {
    static final String CH_SERVICE = "service", CH_ALERTS = "alerts", CH_DANGER = "danger";
    static volatile String status = "starting";
    private volatile boolean running;
    private Thread worker;
    private HttpURLConnection conn;

    static void start(Context c) {
        if (Pairing.load(c) == null) return;
        Intent i = new Intent(c, AlertService.class);
        if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
    }
    static void stop(Context c) { c.stopService(new Intent(c, AlertService.class)); }

    static void channels(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        NotificationChannel s = new NotificationChannel(CH_SERVICE, "Connection to your PC", NotificationManager.IMPORTANCE_MIN);
        s.setDescription("The small notification that keeps the app connected for alerts");
        NotificationChannel a = new NotificationChannel(CH_ALERTS, "Tracker alerts", NotificationManager.IMPORTANCE_DEFAULT);
        a.setDescription("Bosses, events, potions, goals and the tracker's other alerts");
        NotificationChannel d = new NotificationChannel(CH_DANGER, "Danger and urgent alerts", NotificationManager.IMPORTANCE_HIGH);
        d.setDescription("Enemies near you, deaths, disconnects, whispers, required updates");
        d.enableVibration(true);
        nm.createNotificationChannel(s); nm.createNotificationChannel(a); nm.createNotificationChannel(d);
    }

    private PendingIntent openApp() {
        Intent i = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(this, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private Notification serviceNote(String text) {
        return new Notification.Builder(this, CH_SERVICE).setSmallIcon(R.drawable.ic_stat).setContentTitle("SoF Tracker")
            .setContentText(text).setContentIntent(openApp()).setOngoing(true).setShowWhen(false).build();
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        channels(this);
        Notification n = serviceNote("Waiting for alerts from your PC");
        if (Build.VERSION.SDK_INT >= 34) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING); else startForeground(1, n);
        if (!running) { running = true; worker = new Thread(this::loop, "ntfy"); worker.start(); }
        return START_STICKY; // Android starts it again if it had to stop it
    }

    @Override public void onDestroy() {
        running = false;
        try { if (conn != null) conn.disconnect(); } catch (Exception ignored) { }
        if (worker != null) worker.interrupt();
        status = "stopped";
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    private void loop() {
        long wait = 5000;
        while (running) {
            Pairing p = Pairing.load(this);
            if (p == null) { stopSelf(); return; }
            try {
                String since = Pairing.lastId(this);
                URL u = new URL(p.ntfyServer + "/" + p.topic + "/json?since=" + (since != null ? since : "1h"));
                conn = (HttpURLConnection) u.openConnection();
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(90000); // ntfy sends a keepalive every 45 s: silence for longer means the link is dead
                conn.setRequestProperty("User-Agent", "sof-tracker-android");
                if (conn.getResponseCode() != 200) throw new Exception("relay answered " + conn.getResponseCode());
                status = "connected"; wait = 5000;
                update("Connected: alerts from " + p.name + " arrive here");
                BufferedReader r = new BufferedReader(new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8));
                String line;
                while (running && (line = r.readLine()) != null) {
                    JSONObject m = new JSONObject(line);
                    if (!"message".equals(m.optString("event"))) continue; // open / keepalive
                    show(m);
                    Pairing.lastId(this, m.optString("id"));
                }
            } catch (Exception e) {
                status = "offline: " + e.getMessage();
            } finally {
                try { if (conn != null) conn.disconnect(); } catch (Exception ignored) { }
            }
            if (!running) return;
            update("Reconnecting… (no internet?)");
            try { Thread.sleep(wait); } catch (InterruptedException ie) { return; }
            wait = Math.min(wait * 2, 120000);
        }
    }

    private void update(String text) { getSystemService(NotificationManager.class).notify(1, serviceNote(text)); }

    /** one tracker alert: title, text, priority 4–5 = the urgent channel */
    private void show(JSONObject m) {
        int prio = m.optInt("priority", 3);
        String title = m.optString("title", "SoF Tracker"), body = m.optString("message", "");
        Notification n = new Notification.Builder(this, prio >= 4 ? CH_DANGER : CH_ALERTS).setSmallIcon(R.drawable.ic_stat)
            .setContentTitle(title).setContentText(body).setStyle(new Notification.BigTextStyle().bigText(body))
            .setContentIntent(openApp()).setAutoCancel(true).setWhen(m.optLong("time", System.currentTimeMillis() / 1000) * 1000).setShowWhen(true).build();
        getSystemService(NotificationManager.class).notify(Math.abs(m.optString("id").hashCode()) + 2, n);
    }
}
