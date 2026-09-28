package dev.anyai.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** API keys are encrypted at rest with a non-exportable Android Keystore key. */
@CapacitorPlugin(name = "WickrunSecrets")
public class WickrunSecretsPlugin extends Plugin {
    private static final String ALIAS = "wickrun.api-secrets.v1";
    private SharedPreferences store() {
        return getContext().getSharedPreferences("wickrun_secure_secrets", Context.MODE_PRIVATE);
    }
    private synchronized SecretKey encryptionKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (!keyStore.containsAlias(ALIAS)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            generator.generateKey();
        }
        return (SecretKey) keyStore.getKey(ALIAS, null);
    }
    private String entryKey(PluginCall call) {
        String key = call.getString("key");
        if (key == null || key.isEmpty() || key.length() > 512) {
            call.reject("Invalid secret identifier");
            return null;
        }
        return key;
    }
    @PluginMethod
    public void get(PluginCall call) {
        String key = entryKey(call);
        if (key == null) return;
        try {
            String encrypted = store().getString(key, null);
            JSObject result = new JSObject();
            if (encrypted == null) {
                result.put("value", org.json.JSONObject.NULL);
            } else {
                String[] parts = encrypted.split(":", -1);
                if (parts.length != 2) throw new IllegalStateException();
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.DECRYPT_MODE, encryptionKey(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
                cipher.updateAAD(key.getBytes(StandardCharsets.UTF_8));
                result.put("value", new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8));
            }
            call.resolve(result);
        } catch (Exception error) { call.reject("Cannot read secure storage. Re-enter this API key."); }
    }
    @PluginMethod
    public void set(PluginCall call) {
        String key = entryKey(call);
        String value = call.getString("value");
        if (key == null) return;
        if (value == null || value.getBytes(StandardCharsets.UTF_8).length > 65536) {
            call.reject("A credential value of at most 64 KB is required"); return;
        }
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, encryptionKey());
            cipher.updateAAD(key.getBytes(StandardCharsets.UTF_8));
            String encrypted = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" +
                Base64.encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
            if (!store().edit().putString(key, encrypted).commit()) throw new IllegalStateException();
            call.resolve();
        } catch (Exception error) { call.reject("Cannot write secure storage"); }
    }
    @PluginMethod
    public void remove(PluginCall call) {
        String key = entryKey(call);
        if (key == null) return;
        if (store().edit().remove(key).commit()) call.resolve();
        else call.reject("Cannot remove secure storage entry");
    }
}
