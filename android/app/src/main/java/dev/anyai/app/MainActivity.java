package dev.anyai.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SncHttpPlugin.class);
        registerPlugin(WickrunSecretsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
