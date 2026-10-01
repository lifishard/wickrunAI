package dev.anyai.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import org.json.JSONArray;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Bounded, encrypted local inbox. No plaintext persistence or network fallback. */
final class WickrunContextStore {
    private static final String PREFS = "wickrun_context_consent";
    private static final String ENABLED = "enabled";
    private static final String PACKAGES = "packages";
    private static final String DENIED = "denied";
    private static final String QUEUE = "queue_v1";
    private static final String POLICY = "privacy_v1";
    private static final String KEY_ALIAS = "wickrun.context.v1";
    private static final int MAX_ITEMS = 24;
    private static final Object lock = new Object();
    private static volatile boolean forcedOff;
    private WickrunContextStore() {}

    private static SharedPreferences prefs(Context context) { return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }
    static boolean enabled(Context context) { return !forcedOff && prefs(context).getBoolean(ENABLED, false); }
    static void setEnabled(Context context, boolean value) {
        if (!value) forcedOff = true;
        if (!prefs(context).edit().putBoolean(ENABLED, value).commit()) throw new IllegalStateException("Consent could not be saved.");
        if (value) forcedOff = false;
    }
    static void revoke(Context context) { synchronized (lock) { setEnabled(context, false); clear(context); } }
    static Set<String> packages(Context context) { return new HashSet<>(prefs(context).getStringSet(PACKAGES, Collections.emptySet())); }
    static Set<String> denied(Context context) { return new HashSet<>(prefs(context).getStringSet(DENIED, Collections.emptySet())); }
    static boolean allowed(Context context, String packageName) {
        return packageName != null && packages(context).contains(packageName) && !denied(context).contains(packageName);
    }
    static void setPackages(Context context, Set<String> allowed, Set<String> denied) throws Exception {
        synchronized (lock) {
            if (!prefs(context).edit().putStringSet(PACKAGES, new HashSet<>(allowed)).putStringSet(DENIED, new HashSet<>(denied)).commit())
                throw new IllegalStateException("App choices could not be saved.");
            eraseKind(context, "accessibility");
        }
    }

    private static SecretKey key() throws Exception {
        KeyStore keys = KeyStore.getInstance("AndroidKeyStore");keys.load(null);
        if (!keys.containsAlias(KEY_ALIAS)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            generator.generateKey();
        }
        return (SecretKey) keys.getKey(KEY_ALIAS, null);
    }
    private static String encrypt(String field, String plain) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE, key());
        cipher.updateAAD(field.getBytes(StandardCharsets.UTF_8));
        return Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" +
                Base64.encodeToString(cipher.doFinal(plain.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
    }
    private static String decrypt(String field, String stored) throws Exception {
        String[] parts = stored.split(":", -1);
        if (parts.length != 2) throw new IllegalStateException("Encrypted context is invalid.");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
        cipher.updateAAD(field.getBytes(StandardCharsets.UTF_8));
        return new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
    }
    private static JSONArray queue(Context context) throws Exception {
        String stored = prefs(context).getString(QUEUE, null);
        return stored == null ? new JSONArray() : new JSONArray(decrypt(QUEUE, stored));
    }
    private static void save(Context context, JSONArray items) throws Exception {
        if (!prefs(context).edit().putString(QUEUE, encrypt(QUEUE, items.toString())).commit())
            throw new IllegalStateException("Encrypted context could not be saved.");
    }
    private static void clear(Context context) {
        if (!prefs(context).edit().remove(QUEUE).commit()) throw new IllegalStateException("Context could not be erased.");
    }
    static WickrunContextPrivacy privacy(Context context) throws Exception {
        synchronized (lock) {
            String stored = prefs(context).getString(POLICY, null);
            return stored == null ? WickrunContextPrivacy.defaults() : WickrunContextPrivacy.from(new JSONObject(decrypt(POLICY, stored)));
        }
    }
    static void setPrivacy(Context context, JSONObject input) throws Exception {
        WickrunContextPrivacy policy = WickrunContextPrivacy.from(input);
        synchronized (lock) {
            if (!prefs(context).edit().putString(POLICY, encrypt(POLICY, policy.json().toString())).commit())
                throw new IllegalStateException("Privacy settings could not be saved.");
            clear(context); // Old records may have followed a less restrictive policy.
        }
    }
    static boolean add(Context context, JSONObject item) {
        synchronized (lock) {
            try {
                WickrunContextPrivacy.Filtered filtered = privacy(context).apply(item.optString("text", ""));
                JSONArray current = queue(context);
                for (int mode = 0; mode < 2; mode++) {
                    String text = mode == 0 ? filtered.publicText : filtered.encryptedOnlyText;
                    if (text.length() < 3) continue;
                    JSONObject stored = new JSONObject(item.toString());
                    stored.put("id", UUID.randomUUID().toString());
                    stored.put("text", text.length() > 6000 ? text.substring(0, 6000) : text);
                    stored.put("encryptedOnly", mode == 1);
                    current.put(stored);
                }
                JSONArray bounded = new JSONArray();
                for (int i = Math.max(0, current.length() - MAX_ITEMS); i < current.length(); i++) bounded.put(current.get(i));
                save(context, bounded);
                return true;
            } catch (Exception failure) { return false; } // Never keep a plaintext fallback.
        }
    }
    static JSONArray poll(Context context) throws Exception {
        synchronized (lock) {
            JSONArray result = new JSONArray(), current = queue(context);
            for (int i = 0; i < current.length(); i++) {
                JSONObject item = current.getJSONObject(i);
                if (!item.optBoolean("encryptedOnly")) result.put(item);
            }
            return result;
        }
    }
    static int privateCount(Context context) throws Exception {
        synchronized (lock) {
            int count = 0;JSONArray current = queue(context);
            for (int i = 0; i < current.length(); i++) if (current.getJSONObject(i).optBoolean("encryptedOnly")) count++;
            return count;
        }
    }
    static void acknowledge(Context context, Set<String> ids) throws Exception {
        synchronized (lock) {
            JSONArray current = queue(context), kept = new JSONArray();
            for (int i = 0; i < current.length(); i++) {
                JSONObject item = current.getJSONObject(i);
                if (!ids.contains(item.optString("id"))) kept.put(item);
            }
            save(context, kept);
        }
    }
    static void eraseKind(Context context, String kind) throws Exception {
        synchronized (lock) {
            JSONArray current = queue(context), kept = new JSONArray();
            for (int i = 0; i < current.length(); i++) {
                JSONObject item = current.getJSONObject(i);
                if (!kind.equals(item.optString("kind"))) kept.put(item);
            }
            save(context, kept);
        }
    }
    static void acceptShare(Context context, Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction()) || !"text/plain".equals(intent.getType())) return;
        CharSequence value = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        if (value == null) return;
        String text = value.toString().trim();
        if (text.isEmpty()) return;
        JSONObject item = new JSONObject();
        try {
            item.put("kind", "share");item.put("text", text.length() > 6000 ? text.substring(0, 6000) : text);
            item.put("packageName", JSONObject.NULL);item.put("capturedAt", System.currentTimeMillis());
            add(context, item);
        } catch (Exception ignored) { /* No plaintext fallback for private text. */ }
    }
}
