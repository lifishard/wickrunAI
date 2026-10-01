package dev.anyai.app;

import android.Manifest;
import android.accessibilityservice.AccessibilityService;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import androidx.core.content.ContextCompat;
import org.json.JSONObject;
import java.util.ArrayDeque;
import java.util.HashSet;
import java.util.Set;

/** Reads only visible, non-editable text in explicitly selected apps, into an in-memory inbox. */
public class WickrunContextService extends AccessibilityService {
    private static final String CHANNEL = "wickrun_context_capture";
    private static final int NOTICE = 22027;
    private static WickrunContextService instance;
    private static volatile boolean active;
    private long lastCapture;
    private String lastFingerprint = "";

    static boolean active() { return active; }
    static void refresh(Context context) {
        WickrunContextService service = instance;
        if (service != null) service.refreshNotice();
    }
    @Override public void onServiceConnected() {
        super.onServiceConnected();
        instance = this;
        refreshNotice();
    }
    @Override public void onDestroy() {
        active = false;
        WickrunContextStore.setEnabled(this, false);
        clearNotice();
        if (instance == this) instance = null;
        super.onDestroy();
    }
    @Override public void onInterrupt() { /* A later event resumes only if consent is still active. */ }

    private boolean notificationGranted() {
        return Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }
    private void refreshNotice() {
        active = WickrunContextStore.enabled(this) && !WickrunContextStore.packages(this).isEmpty() && notificationGranted();
        if (!active) { clearNotice(); return; }
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager == null) { active = false; return; }
        if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(new NotificationChannel(CHANNEL,
                getString(R.string.context_capture_channel), NotificationManager.IMPORTANCE_LOW));
        Intent open = new Intent(this, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent action = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        PendingIntent stop = PendingIntent.getBroadcast(this, 1, new Intent(this, WickrunContextStopReceiver.class),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        Notification notice = builder.setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(getString(R.string.context_capture_active))
                .setContentText(getString(R.string.context_accessibility_description))
                .setContentIntent(action).addAction(android.R.drawable.ic_media_pause, getString(R.string.context_capture_stop), stop)
                .setOngoing(true).setOnlyAlertOnce(true).build();
        manager.notify(NOTICE, notice);
    }
    private void clearNotice() {
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager != null) manager.cancel(NOTICE);
    }

    @Override public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event == null || !active) return;
        int type = event.getEventType();
        if (type != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED && type != AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED) return;
        if (!WickrunContextStore.enabled(this) || !notificationGranted()) { refreshNotice(); return; }
        CharSequence source = event.getPackageName();
        if (source == null) return;
        String packageName = source.toString();
        if (!WickrunContextStore.packages(this).contains(packageName)) return;
        long now = System.currentTimeMillis();
        if (now - lastCapture < 1200) return;
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null || root.getPackageName() == null || !packageName.equals(root.getPackageName().toString())) return;
        String text = visibleStaticText(root);
        if (text.length() < 20) return;
        String fingerprint = packageName + ":" + text.hashCode();
        if (fingerprint.equals(lastFingerprint)) return;
        lastFingerprint = fingerprint;
        lastCapture = now;
        try {
            JSONObject item = new JSONObject();
            item.put("kind", "accessibility");
            item.put("packageName", packageName);
            item.put("text", text);
            item.put("capturedAt", now);
            WickrunContextStore.add(item);
        } catch (Exception ignored) { /* Keep private content in memory only. */ }
    }

    private String visibleStaticText(AccessibilityNodeInfo root) {
        StringBuilder result = new StringBuilder();
        Set<String> seen = new HashSet<>();
        ArrayDeque<AccessibilityNodeInfo> nodes = new ArrayDeque<>();
        nodes.add(root);
        int visited = 0;
        while (!nodes.isEmpty() && visited++ < 150 && result.length() < 1400) {
            AccessibilityNodeInfo node = nodes.removeFirst();
            if (!node.isVisibleToUser() || node.isPassword() || node.isEditable()) continue;
            CharSequence className = node.getClassName();
            if (className != null && className.toString().contains("EditText")) continue;
            CharSequence value = node.getText();
            if (value != null) {
                String line = value.toString().replaceAll("\\s+", " ").trim();
                if (line.length() >= 3 && seen.add(line)) {
                    if (result.length() > 0) result.append("\n");
                    result.append(line, 0, Math.min(line.length(), 300));
                }
            }
            for (int i = 0; i < node.getChildCount(); i++) {
                AccessibilityNodeInfo child = node.getChild(i);
                if (child != null) nodes.addLast(child);
            }
        }
        if (result.length() > 1400) result.setLength(1400);
        return result.toString();
    }
}
