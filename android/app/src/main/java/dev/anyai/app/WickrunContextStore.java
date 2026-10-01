package dev.anyai.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayDeque;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;

/** Local, bounded inbox. Captured text is never written to disk or sent over a network here. */
final class WickrunContextStore {
    private static final String PREFS = "wickrun_context_consent";
    private static final String ENABLED = "enabled";
    private static final String PACKAGES = "packages";
    private static final int MAX_ITEMS = 24;
    private static final ArrayDeque<JSONObject> inbox = new ArrayDeque<>();
    private WickrunContextStore() {}

    static boolean enabled(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(ENABLED, false);
    }
    static void setEnabled(Context context, boolean value) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(ENABLED, value).apply();
        if (!value) synchronized (inbox) { inbox.clear(); }
    }
    static Set<String> packages(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        return new HashSet<>(prefs.getStringSet(PACKAGES, Collections.emptySet()));
    }
    static void setPackages(Context context, Set<String> names) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putStringSet(PACKAGES, new HashSet<>(names)).apply();
        synchronized (inbox) { inbox.clear(); }
    }
    static void add(JSONObject item) {
        synchronized (inbox) {
            try { item.put("id", UUID.randomUUID().toString()); } catch (Exception ignored) { return; }
            while (inbox.size() >= MAX_ITEMS) inbox.removeFirst();
            inbox.addLast(item);
        }
    }
    static JSONArray poll() {
        JSONArray result = new JSONArray();
        synchronized (inbox) { for (JSONObject item : inbox) result.put(item); }
        return result;
    }
    static void acknowledge(Set<String> ids) {
        synchronized (inbox) { inbox.removeIf(item -> ids.contains(item.optString("id"))); }
    }
    static void acceptShare(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction()) || !"text/plain".equals(intent.getType())) return;
        CharSequence value = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        if (value == null) return;
        String text = value.toString().trim();
        if (text.isEmpty()) return;
        if (text.length() > 6000) text = text.substring(0, 6000);
        JSONObject item = new JSONObject();
        try {
            item.put("kind", "share");
            item.put("text", text);
            item.put("packageName", JSONObject.NULL);
            item.put("capturedAt", System.currentTimeMillis());
            add(item);
        } catch (Exception ignored) { /* No durable fallback for potentially private text. */ }
    }
}
