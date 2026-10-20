package com.softracker.app;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Not paired: how to pair (scan the QR code under Settings → Phone app on the PC, or paste its code).
 * Paired: the tracker's whole dashboard from your PC, live and synced, to watch and change everything as on the PC, while
 * the phone can reach the PC (home Wi-Fi, or Tailscale away from home); otherwise a note that the alerts still arrive.
 * The compact phone page instead, if you prefer it (⋮ menu). A bar at the top for the connection, battery and app updates.
 */
public class MainActivity extends Activity {
    static final int BG = Color.rgb(14, 15, 19), PANEL = Color.rgb(22, 24, 31), TEXT = Color.rgb(230, 227, 218), MUTED = Color.rgb(141, 138, 128), GOLD = Color.rgb(214, 168, 74);
    private final Handler ui = new Handler(Looper.getMainLooper());
    private WebView web;
    private TextView barText;
    private LinearLayout bar;
    private String liveUrl;
    private ValueCallback<Uri[]> pickFile;
    static final int PICK_FILE = 7;

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().setStatusBarColor(BG);
        AlertService.channels(this);
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, 1);
        handlePairLink(getIntent());
        show();
    }

    @Override protected void onNewIntent(Intent i) { super.onNewIntent(i); handlePairLink(i); show(); }

    @Override protected void onResume() { super.onResume(); if (Pairing.load(this) != null) { AlertService.start(this); checkUpdate(); } }

    @Override public void onBackPressed() { if (web != null && web.canGoBack()) web.goBack(); else super.onBackPressed(); }

    /** sofapp://pair?d=… opened by the camera or a link: pair with that PC */
    private void handlePairLink(Intent i) {
        Uri d = i != null ? i.getData() : null;
        if (d != null && "sofapp".equals(d.getScheme())) pair(d.toString());
    }

    private void pair(String code) {
        try {
            Pairing p = Pairing.parse(code);
            Pairing.save(this, code);
            AlertService.stop(this);
            AlertService.start(this);
            toastDialog("Paired with " + p.name, "Alerts from the tracker on " + p.name + " now come to this phone, also when you are away from home.\n\nOn your home Wi-Fi you also get the whole dashboard here, live, and can change everything as on the PC.");
        } catch (Exception e) {
            toastDialog("That didn't work", e.getMessage() + "\n\nOpen Settings → Phone app in the tracker on your PC and scan the QR code again.");
        }
    }

    private void toastDialog(String title, String msg) { new AlertDialog.Builder(this).setTitle(title).setMessage(msg).setPositiveButton("OK", null).show(); }

    private void show() {
        Pairing p = Pairing.load(this);
        if (p == null) showPairing(); else showLive(p);
    }

    // ---- not paired
    private void showPairing() {
        web = null;
        LinearLayout col = column();
        col.addView(text("SoF Tracker", 26, GOLD, true));
        col.addView(text("Your PC's tracker on your phone: alerts as notifications wherever you are, and the whole dashboard, live and synced with your PC, on your home Wi-Fi. Change settings, your watchlist, notes and alerts here as on the PC.", 15, TEXT, false));
        col.addView(text("Pair with your PC", 18, TEXT, true));
        col.addView(text("1. On the PC, open the tracker's dashboard → Settings → Phone app.\n2. Point this phone's camera at the QR code there and tap the link it shows.\n\nNo camera? Copy the pairing code under the QR code (for example by mail to yourself) and paste it here:", 15, MUTED, false));
        EditText code = new EditText(this);
        code.setHint("pairing code"); code.setTextColor(TEXT); code.setHintTextColor(MUTED); code.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        col.addView(code);
        Button go = button("Pair");
        go.setOnClickListener(v -> pair(code.getText().toString()));
        col.addView(go);
        ScrollView sv = new ScrollView(this); sv.setBackgroundColor(BG); sv.addView(col);
        setContentView(sv);
    }

    // ---- paired: a bar, and the live phone page when the PC can be reached
    private void showLive(Pairing p) {
        FrameLayout root = new FrameLayout(this); root.setBackgroundColor(BG);
        LinearLayout col = new LinearLayout(this); col.setOrientation(LinearLayout.VERTICAL);
        bar = new LinearLayout(this); bar.setOrientation(LinearLayout.HORIZONTAL); bar.setBackgroundColor(PANEL); bar.setPadding(dp(12), dp(8), dp(8), dp(8)); bar.setGravity(Gravity.CENTER_VERTICAL);
        barText = text("Looking for " + p.name + "…", 13, MUTED, false); barText.setPadding(0, 0, 0, 0);
        bar.addView(barText, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        Button more = small("⋮"); more.setOnClickListener(v -> menu(p)); bar.addView(more);
        col.addView(bar);
        web = new WebView(this);
        web.setBackgroundColor(BG);
        WebSettings s = web.getSettings(); s.setJavaScriptEnabled(true); s.setDomStorageEnabled(true); s.setMediaPlaybackRequiresUserGesture(false);
        CookieManager.getInstance().setAcceptCookie(true);
        // confirm() and prompt() dialogs, and picking a file (your own alert sounds, importing a setup)
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (pickFile != null) pickFile.onReceiveValue(null);
                pickFile = cb;
                try { startActivityForResult(params.createIntent(), PICK_FILE); } catch (Exception e) { pickFile = null; return false; }
                return true;
            }
        });
        // downloads (backups, reports, your setup) into Downloads, with the tracker's cookies
        web.setDownloadListener((url, ua, disposition, mime, length) -> download(url, ua, disposition, mime));
        web.setWebViewClient(new WebViewClient() {
            // links away from the PC (GitHub, help pages) open in the browser
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                if (liveUrl != null && r.getUrl().toString().startsWith(liveUrl)) return false;
                startActivity(new Intent(Intent.ACTION_VIEW, r.getUrl())); return true;
            }
            @Override public void onReceivedError(WebView v, int code, String desc, String url) { ui.post(() -> offline(p)); }
        });
        col.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        root.addView(col);
        setContentView(root);
        connect(p);
        if (!batteryOk()) addBarButton("Battery", v -> askBattery());
    }

    /** the first of the PC's addresses that answers (home network first, Tailscale last), then its dashboard (the key and app token set cookies) */
    private void connect(Pairing p) {
        barText.setText("Looking for " + p.name + "…");
        new Thread(() -> {
            String found = null;
            if (!p.key.isEmpty()) for (String u : p.lan) {
                try {
                    HttpURLConnection c = (HttpURLConnection) new URL(u + "/api/client?key=" + p.key).openConnection();
                    c.setConnectTimeout(2500); c.setReadTimeout(2500);
                    if (c.getResponseCode() == 200) { found = u; c.disconnect(); break; }
                    c.disconnect();
                } catch (Exception ignored) { }
            }
            final String u = found;
            ui.post(() -> {
                if (u == null) { offline(p); return; }
                liveUrl = u;
                boolean full = !compact();
                barText.setText("● " + p.name + (p.app.isEmpty() ? "   ·   watching only: pair again to change settings" : "") + "   ·   alerts: " + AlertService.status);
                barText.setTextColor(TEXT);
                web.loadUrl(u + (full ? "/" : "/phone") + "?key=" + p.key + (p.app.isEmpty() ? "" : "&app=" + p.app));
            });
        }).start();
    }

    private void offline(Pairing p) {
        barText.setText("Alerts: " + AlertService.status);
        String why = p.key.isEmpty() || p.lan.isEmpty()
            ? "The live view needs the tracker's phone view switched on (on the PC: Settings → Phone app → \"Let my phone see the tracker on this Wi-Fi\"), then pair again."
            : "You are not on the same Wi-Fi as " + p.name + ", or the tracker there isn't running.\n\nTo use the dashboard away from home too, install Tailscale (free) on the PC and this phone, sign in to both with the same account, then pair again on the PC.";
        String html = "<html><body style='background:#0e0f13;color:#e6e3da;font:16px sans-serif;padding:20px'><h3 style='color:#d6a84a'>Notifications are on</h3>"
            + "<p>Alerts from " + esc(p.name) + " arrive on this phone wherever you are.</p><p style='color:#8d8a80'>" + esc(why) + "</p></body></html>";
        web.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
        addBarButton("Retry", v -> connect(p));
    }

    private void menu(Pairing p) {
        String[] items = { "Reconnect", compact() ? "Show the whole dashboard" : "Show the compact phone page", "Allow running in the background (battery)", "Notification settings", "Unpair this phone" };
        new AlertDialog.Builder(this).setTitle(p.name).setItems(items, (d, w0) -> {
            if (w0 == 1) { getSharedPreferences("app", MODE_PRIVATE).edit().putBoolean("compact", !compact()).apply(); connect(p); return; }
            int w = w0 == 0 ? 0 : w0 - 1;
            if (w == 0) { AlertService.stop(this); AlertService.start(this); connect(p); }
            else if (w == 1) askBattery();
            else if (w == 2) startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName()));
            else new AlertDialog.Builder(this).setMessage("Stop alerts from " + p.name + " and forget it?").setNegativeButton("Cancel", null)
                .setPositiveButton("Unpair", (x, y) -> { AlertService.stop(this); Pairing.clear(this); CookieManager.getInstance().removeAllCookies(null); show(); }).show();
        }).show();
    }

    private boolean compact() { return getSharedPreferences("app", MODE_PRIVATE).getBoolean("compact", false); }

    @Override protected void onActivityResult(int req, int result, Intent data) {
        super.onActivityResult(req, result, data);
        if (req != PICK_FILE || pickFile == null) return;
        pickFile.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
        pickFile = null;
    }

    /** a file from the tracker (a backup, a report): to Downloads, with a notification when it is done */
    private void download(String url, String ua, String disposition, String mime) {
        if (Build.VERSION.SDK_INT < 29 && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] { Manifest.permission.WRITE_EXTERNAL_STORAGE }, 2);
            Toast.makeText(this, "Allow storage, then tap the download again", Toast.LENGTH_LONG).show();
            return;
        }
        try {
            String name = URLUtil.guessFileName(url, disposition, mime);
            DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url));
            r.addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url));
            r.addRequestHeader("User-Agent", ua);
            r.setMimeType(mime); r.setTitle(name);
            r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
            getSystemService(DownloadManager.class).enqueue(r);
            Toast.makeText(this, "Downloading " + name, Toast.LENGTH_SHORT).show();
        } catch (Exception e) { toastDialog("Download failed", String.valueOf(e.getMessage())); }
    }

    // ---- staying connected: Android may stop background apps to save battery
    private boolean batteryOk() { return getSystemService(PowerManager.class).isIgnoringBatteryOptimizations(getPackageName()); }
    private void askBattery() {
        if (batteryOk()) { toastDialog("Battery", "SoF Tracker may already run in the background."); return; }
        try { startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getPackageName()))); }
        catch (Exception e) { startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)); }
    }

    // ---- a newer app on GitHub (the releases next to the PC setup): once a day, a button in the bar
    private void checkUpdate() {
        Pairing p = Pairing.load(this);
        if (p == null || !p.repo.matches("[\\w.-]+/[\\w.-]+")) return;
        long last = getSharedPreferences("app", MODE_PRIVATE).getLong("updateCheck", 0);
        if (System.currentTimeMillis() - last < 20 * 3600000L) { String u = getSharedPreferences("app", MODE_PRIVATE).getString("updateUrl", null); if (u != null) ui.post(() -> offerUpdate(u)); return; }
        new Thread(() -> {
            try {
                HttpURLConnection c = (HttpURLConnection) new URL("https://api.github.com/repos/" + p.repo + "/releases/latest").openConnection();
                c.setRequestProperty("Accept", "application/vnd.github+json"); c.setConnectTimeout(10000); c.setReadTimeout(10000);
                StringBuilder sb = new StringBuilder(); try (BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream()))) { String l; while ((l = r.readLine()) != null) sb.append(l); }
                JSONObject rel = new JSONObject(sb.toString());
                String tag = rel.optString("tag_name", "").replaceFirst("^v", ""), apk = null;
                JSONArray assets = rel.optJSONArray("assets");
                if (assets != null) for (int i = 0; i < assets.length(); i++) { String n = assets.getJSONObject(i).optString("name"); if (n.endsWith(".apk")) apk = assets.getJSONObject(i).optString("browser_download_url"); }
                String cur = getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
                String url = apk != null && newer(tag, cur) ? apk : null;
                getSharedPreferences("app", MODE_PRIVATE).edit().putLong("updateCheck", System.currentTimeMillis()).putString("updateUrl", url).apply();
                if (url != null) ui.post(() -> offerUpdate(url));
            } catch (Exception ignored) { }
        }).start();
    }
    private void offerUpdate(String url) { if (bar != null && bar.findViewWithTag("upd") == null) { Button b = addBarButton("Update app", v -> startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)))); b.setTag("upd"); } }
    static boolean newer(String a, String b) {
        try { String[] x = a.split("\\."), y = b.split("\\."); for (int i = 0; i < 3; i++) { int d = Integer.parseInt(x[i]) - Integer.parseInt(y[i]); if (d != 0) return d > 0; } } catch (Exception ignored) { }
        return false;
    }

    // ---- small view helpers (no layout files: the whole app is a few screens)
    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }
    private LinearLayout column() { LinearLayout l = new LinearLayout(this); l.setOrientation(LinearLayout.VERTICAL); l.setPadding(dp(20), dp(28), dp(20), dp(20)); return l; }
    private TextView text(String s, int sp, int color, boolean bold) {
        TextView t = new TextView(this); t.setText(s); t.setTextSize(sp); t.setTextColor(color); if (bold) t.setTypeface(Typeface.DEFAULT_BOLD); t.setPadding(0, dp(6), 0, dp(6)); return t;
    }
    private Button button(String s) { Button b = new Button(this); b.setText(s); b.setAllCaps(false); b.setTextColor(Color.rgb(26, 20, 8)); b.setBackgroundColor(GOLD); return b; }
    private Button small(String s) { Button b = new Button(this); b.setText(s); b.setAllCaps(false); b.setTextColor(TEXT); b.setBackgroundColor(Color.TRANSPARENT); b.setMinWidth(0); b.setMinimumWidth(0); b.setPadding(dp(10), 0, dp(10), 0); return b; }
    private Button addBarButton(String s, View.OnClickListener l) {
        for (int i = 0; i < bar.getChildCount(); i++) if (bar.getChildAt(i) instanceof Button && s.equals(((Button) bar.getChildAt(i)).getText().toString())) return (Button) bar.getChildAt(i);
        Button b = small(s); b.setTextColor(GOLD); b.setOnClickListener(l); bar.addView(b, bar.getChildCount() - 1); return b;
    }
    private static String esc(String s) { return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"); }
}
