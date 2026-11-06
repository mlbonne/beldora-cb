package app.beldora.cb;

import android.os.Bundle;
import android.webkit.WebSettings;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The app's own plugin: "Save as PDF" through Android's print service
        registerPlugin(BeldoraPrintPlugin.class);
        super.onCreate(savedInstanceState);
        // No pinch zoom: it is too easy to leave the app zoomed in
        WebSettings settings = getBridge().getWebView().getSettings();
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setTextZoom(100);
    }
}
