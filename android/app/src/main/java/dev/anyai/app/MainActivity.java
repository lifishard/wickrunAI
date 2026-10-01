package dev.anyai.app;

import android.os.Bundle;
import android.content.Intent;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SncHttpPlugin.class);
        registerPlugin(WickrunSecretsPlugin.class);
        registerPlugin(WickrunAccountPlugin.class);
        registerPlugin(WickrunFilesPlugin.class);
        registerPlugin(WickrunContextPlugin.class);
        super.onCreate(savedInstanceState);
        WickrunContextStore.acceptShare(this, getIntent());
        if (Intent.ACTION_SEND.equals(getIntent().getAction())) setIntent(new Intent(this, MainActivity.class));
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        WickrunContextStore.acceptShare(this, intent);
        if (Intent.ACTION_SEND.equals(intent.getAction())) setIntent(new Intent(this, MainActivity.class));
    }
}
