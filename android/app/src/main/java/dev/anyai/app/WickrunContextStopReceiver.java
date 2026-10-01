package dev.anyai.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** One-tap stop from the persistent capture notice. */
public class WickrunContextStopReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        try { WickrunContextStore.setEnabled(context, false); } catch (Exception ignored) { /* In-memory gate still stops capture. */ }
        WickrunContextService.refresh(context);
    }
}
