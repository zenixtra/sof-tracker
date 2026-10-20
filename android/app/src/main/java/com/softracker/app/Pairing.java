package com.softracker.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * What the phone knows about its PC, from the pairing QR code on the PC (Settings → Phone app):
 * sofapp://pair?d=BASE64URL({ v: 1, name, lan: ["http://192.168.1.5:7777"], key, app, ntfy: { server, topic }, repo })
 *  - lan + key: the tracker on your home Wi-Fi (live view, synced with the PC)
 *  - app: the token that lets this app change things like the PC itself (settings, watchlist, …); older codes have none
 *  - ntfy: the private relay topic the PC sends its alerts to (notifications anywhere)
 *  - repo: the GitHub repository with the app's releases (update check)
 */
final class Pairing {
    final String name, key, app, ntfyServer, topic, repo;
    final List<String> lan;

    private Pairing(String name, List<String> lan, String key, String app, String ntfyServer, String topic, String repo) {
        this.name = name; this.lan = lan; this.key = key; this.app = app; this.ntfyServer = ntfyServer; this.topic = topic; this.repo = repo;
    }

    /** from the pairing link or the code under the QR code; throws with a readable message */
    static Pairing parse(String text) throws Exception {
        String s = text.trim();
        if (s.startsWith("sofapp:")) s = Uri.parse(s).getQueryParameter("d");
        if (s == null || s.isEmpty()) throw new Exception("No pairing code found");
        JSONObject o = new JSONObject(new String(Base64.decode(s, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING), StandardCharsets.UTF_8));
        if (o.optInt("v") != 1) throw new Exception("This pairing code is from a newer tracker: update the app");
        JSONObject n = o.optJSONObject("ntfy");
        String server = n != null ? n.optString("server", "https://ntfy.sh") : "https://ntfy.sh", topic = n != null ? n.optString("topic", "") : "";
        if (!server.startsWith("https://")) throw new Exception("The relay must use https");
        if (!topic.matches("[A-Za-z0-9_-]{16,64}")) throw new Exception("The pairing code has no valid alert topic");
        List<String> lan = new ArrayList<>();
        JSONArray a = o.optJSONArray("lan");
        if (a != null) for (int i = 0; i < a.length(); i++) { String u = a.optString(i); if (u.matches("http://[0-9.]+:\\d+")) lan.add(u); }
        String key = o.optString("key", ""), app = o.optString("app", "");
        return new Pairing(o.optString("name", "PC"), lan, key.matches("[A-Za-z0-9_-]{16,64}") ? key : "", app.matches("[A-Za-z0-9_-]{16,64}") ? app : "", server, topic, o.optString("repo", ""));
    }

    private static SharedPreferences prefs(Context c) { return c.getSharedPreferences("pairing", Context.MODE_PRIVATE); }

    static Pairing load(Context c) {
        SharedPreferences p = prefs(c);
        String raw = p.getString("raw", null);
        if (raw == null) return null;
        try { return parse(raw); } catch (Exception e) { return null; }
    }

    static void save(Context c, String raw) { prefs(c).edit().putString("raw", raw.trim()).remove("lastId").apply(); }
    static void clear(Context c) { prefs(c).edit().clear().apply(); }

    /** the id of the last alert shown, so a reconnect only fetches what was missed */
    static String lastId(Context c) { return prefs(c).getString("lastId", null); }
    static void lastId(Context c, String id) { prefs(c).edit().putString("lastId", id).apply(); }
}
