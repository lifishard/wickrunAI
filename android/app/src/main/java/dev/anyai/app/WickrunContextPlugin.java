package dev.anyai.app;

import android.Manifest;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.accessibility.AccessibilityManager;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.HashSet;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Set;

/** Explicit consent gate for local Android context. No captured text crosses this bridge until poll(). */
@CapacitorPlugin(name = "WickrunContext", permissions = {
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
})
public class WickrunContextPlugin extends Plugin {
    private boolean serviceGranted() {
        AccessibilityManager manager = (AccessibilityManager) getContext().getSystemService(Context.ACCESSIBILITY_SERVICE);
        if (manager == null) return false;
        ComponentName ours = new ComponentName(getContext(), WickrunContextService.class);
        for (AccessibilityServiceInfo info : manager.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK)) {
            if (info.getResolveInfo() != null && ours.getClassName().equals(info.getResolveInfo().serviceInfo.name)
                    && ours.getPackageName().equals(info.getResolveInfo().serviceInfo.packageName)) return true;
        }
        return false;
    }
    private boolean notificationGranted() {
        return Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }
    private JSObject status() {
        WickrunContextService.refresh(getContext());
        JSObject value = new JSObject();
        value.put("enabled", WickrunContextStore.enabled(getContext()));
        value.put("serviceGranted", serviceGranted());
        value.put("notificationGranted", notificationGranted());
        value.put("active", WickrunContextService.active());
        value.put("allowedPackages", new JSArray(WickrunContextStore.packages(getContext())));
        value.put("deniedPackages", new JSArray(WickrunContextStore.denied(getContext())));
        JSObject background = new JSObject();
        background.put("supported", Build.VERSION.SDK_INT >= 23);
        PowerManager power = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        background.put("unrestricted", Build.VERSION.SDK_INT < 23 || power != null && power.isIgnoringBatteryOptimizations(getContext().getPackageName()));
        value.put("background", background);
        try {
            value.put("privacy", WickrunContextStore.privacy(getContext()).json());
            value.put("privateCount", WickrunContextStore.privateCount(getContext()));
        } catch (Exception failure) {
            try { WickrunContextStore.setEnabled(getContext(), false); } catch (Exception ignored) { /* In-memory gate is off. */ }
            WickrunContextService.refresh(getContext());
            value.put("storageError", true);
            value.put("privacy", WickrunContextPrivacy.defaults().json());
        }
        return value;
    }
    @PluginMethod
    public void getStatus(PluginCall call) { call.resolve(status()); }

    @PluginMethod
    public void listApps(PluginCall call) {
        PackageManager manager = getContext().getPackageManager();
        Intent launcher = new Intent(Intent.ACTION_MAIN);
        launcher.addCategory(Intent.CATEGORY_LAUNCHER);
        List<ResolveInfo> matches = manager.queryIntentActivities(launcher, 0);
        List<JSObject> apps = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (ResolveInfo match : matches) {
            if (match.activityInfo == null) continue;
            String name = match.activityInfo.packageName;
            if (name.equals(getContext().getPackageName()) || !seen.add(name)) continue;
            JSObject app = new JSObject();
            app.put("packageName", name);
            app.put("label", match.loadLabel(manager).toString());
            apps.add(app);
        }
        apps.sort(Comparator.comparing(app -> app.optString("label", ""), String.CASE_INSENSITIVE_ORDER));
        JSObject result = new JSObject();
        result.put("apps", new JSArray(apps));
        call.resolve(result);
    }

    @PluginMethod
    public void openAccessibilitySettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve(status());
    }

    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
        intent.putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve(status());
    }

    @PluginMethod
    public void openBackgroundSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT < 23) { call.resolve(status()); return; }
        Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                Uri.parse("package:" + getContext().getPackageName()));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try { getContext().startActivity(intent); }
        catch (Exception unavailable) {
            Intent fallback = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
            fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(fallback);
        }
        call.resolve(status());
    }

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || notificationGranted()) { call.resolve(status()); return; }
        requestPermissionForAlias("notifications", call, "notificationPermissionResult");
    }
    @PermissionCallback
    public void notificationPermissionResult(PluginCall call) { call.resolve(status()); }

    @PluginMethod
    public void setAllowedPackages(PluginCall call) {
        JSArray input = call.getArray("packages");
        if (input == null) { call.reject("Select apps explicitly."); return; }
        Set<String> names = new HashSet<>();
        Set<String> denied = new HashSet<>();
        try {
            for (int i = 0; i < input.length(); i++) {
                String name = input.getString(i);
                if (name == null || !name.matches("[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)+")) {
                    call.reject("Invalid app package."); return;
                }
                if (!name.equals(getContext().getPackageName())) names.add(name);
            }
            JSArray exclusions = call.getArray("deniedPackages");
            if (exclusions != null) for (int i = 0; i < exclusions.length(); i++) {
                String name = exclusions.getString(i);
                if (name == null || !name.matches("[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)+")) {
                    call.reject("Invalid excluded app package."); return;
                }
                denied.add(name);
            }
        } catch (Exception error) { call.reject("Invalid app list."); return; }
        if (names.size() > 20 || denied.size() > 40) { call.reject("Too many apps selected."); return; }
        try { WickrunContextStore.setPackages(getContext(), names, denied); }
        catch (Exception failure) { call.reject("App choices could not be saved."); return; }
        if (names.isEmpty() || denied.containsAll(names)) {
            try { WickrunContextStore.setEnabled(getContext(), false); }
            catch (Exception failure) { call.reject("Capture stopped, but consent could not be saved."); return; }
        }
        WickrunContextService.refresh(getContext());
        call.resolve(status());
    }

    @PluginMethod
    public void configurePrivacy(PluginCall call) {
        JSObject policy = call.getObject("policy");
        if (policy == null) { call.reject("Missing privacy policy."); return; }
        try { WickrunContextStore.setPrivacy(getContext(), policy);call.resolve(status()); }
        catch (Exception failure) { call.reject("Privacy settings could not be saved: " + failure.getMessage()); }
    }

    @PluginMethod
    public void setEnabled(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled"));
        if (enabled) {
            Set<String> available = WickrunContextStore.packages(getContext());available.removeAll(WickrunContextStore.denied(getContext()));
            if (available.isEmpty()) { call.reject("Choose an allowed app first."); return; }
            if (!serviceGranted()) { call.reject("Enable the Android accessibility service first."); return; }
            if (!notificationGranted()) { call.reject("Allow notifications so capture remains visible."); return; }
            try { WickrunContextStore.privacy(getContext());WickrunContextStore.poll(getContext()); }
            catch (Exception failure) { call.reject("Encrypted storage is unavailable."); return; }
        }
        try { WickrunContextStore.setEnabled(getContext(), enabled); }
        catch (Exception failure) { call.reject("Capture setting could not be saved."); return; }
        WickrunContextService.refresh(getContext());
        call.resolve(status());
    }

    @PluginMethod
    public void poll(PluginCall call) {
        JSObject result = new JSObject();
        try { result.put("items", WickrunContextStore.poll(getContext()));call.resolve(result); }
        catch (Exception failure) { call.reject("Encrypted context could not be opened."); }
    }

    @PluginMethod
    public void ack(PluginCall call) {
        JSArray input = call.getArray("ids");
        if (input == null) { call.reject("Missing record ids."); return; }
        Set<String> ids = new HashSet<>();
        for (int i = 0; i < input.length(); i++) {
            String id = input.optString(i, "");
            if (!id.isEmpty()) ids.add(id);
        }
        try { WickrunContextStore.acknowledge(getContext(), ids);call.resolve(status()); }
        catch (Exception failure) { call.reject("Encrypted context could not be acknowledged."); }
    }

    @PluginMethod
    public void revoke(PluginCall call) {
        try { WickrunContextStore.revoke(getContext());WickrunContextService.refresh(getContext());call.resolve(status()); }
        catch (Exception failure) { call.reject("Capture stopped, but saved context could not be erased."); }
    }

    @PluginMethod
    public void revokeSource(PluginCall call) {
        String kind = call.getString("kind", "");
        if (!kind.equals("accessibility") && !kind.equals("share")) { call.reject("Unknown source."); return; }
        try {
            if (kind.equals("accessibility")) WickrunContextStore.setEnabled(getContext(), false);
            WickrunContextStore.eraseKind(getContext(), kind);
            WickrunContextService.refresh(getContext());
            call.resolve(status());
        } catch (Exception failure) { call.reject("Source stopped, but saved context could not be erased."); }
    }
}
