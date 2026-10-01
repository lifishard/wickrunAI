package dev.anyai.app;

import android.Manifest;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.os.Build;
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

/** Explicit consent gate for local Android context. No captured text crosses this bridge until drain(). */
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
        try {
            for (int i = 0; i < input.length(); i++) {
                String name = input.getString(i);
                if (name == null || !name.matches("[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)+")) {
                    call.reject("Invalid app package."); return;
                }
                if (!name.equals(getContext().getPackageName())) names.add(name);
            }
        } catch (Exception error) { call.reject("Invalid app list."); return; }
        if (names.size() > 20) { call.reject("Too many apps selected."); return; }
        WickrunContextStore.setPackages(getContext(), names);
        if (names.isEmpty()) WickrunContextStore.setEnabled(getContext(), false);
        WickrunContextService.refresh(getContext());
        call.resolve(status());
    }

    @PluginMethod
    public void setEnabled(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled"));
        if (enabled) {
            if (WickrunContextStore.packages(getContext()).isEmpty()) { call.reject("Choose an app first."); return; }
            if (!serviceGranted()) { call.reject("Enable the Android accessibility service first."); return; }
            if (!notificationGranted()) { call.reject("Allow notifications so capture remains visible."); return; }
        }
        WickrunContextStore.setEnabled(getContext(), enabled);
        WickrunContextService.refresh(getContext());
        call.resolve(status());
    }

    @PluginMethod
    public void drain(PluginCall call) {
        JSObject result = new JSObject();
        result.put("items", WickrunContextStore.drain());
        call.resolve(result);
    }
}
