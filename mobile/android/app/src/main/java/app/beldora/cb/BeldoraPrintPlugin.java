package app.beldora.cb;

import android.content.Context;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.IOException;
import java.io.InputStream;
import java.net.URLConnection;
import java.util.ArrayList;
import java.util.List;

/**
 * Prints a laid-out Beldora CB document (character sheet, cards, booklet, cheat sheet) with Android's
 * print service, where "Save as PDF" is one of the printers. The HTML is loaded into an off-screen
 * WebView whose https://localhost/ requests are served from the app's web assets, so fonts, styles
 * and images resolve exactly as in the app.
 */
@CapacitorPlugin(name = "BeldoraPrint")
public class BeldoraPrintPlugin extends Plugin {

    // Print jobs read from their WebView after printHtml() returns; keep them alive
    private final List<WebView> printViews = new ArrayList<>();

    /** Serves https://localhost/<path> from assets/public/<path>. */
    private static class PublicAssetsHandler implements WebViewAssetLoader.PathHandler {
        private final Context context;

        PublicAssetsHandler(Context context) {
            this.context = context;
        }

        @Nullable
        @Override
        public WebResourceResponse handle(@NonNull String path) {
            try {
                String clean = Uri.decode(path);
                if (clean.isEmpty()) clean = "index.html";
                InputStream in = context.getAssets().open("public/" + clean);
                String mime = URLConnection.guessContentTypeFromName(clean);
                if (clean.endsWith(".css")) mime = "text/css";
                else if (clean.endsWith(".js")) mime = "text/javascript";
                else if (clean.endsWith(".woff2")) mime = "font/woff2";
                else if (clean.endsWith(".webp")) mime = "image/webp";
                else if (clean.endsWith(".svg")) mime = "image/svg+xml";
                return new WebResourceResponse(mime != null ? mime : "application/octet-stream", null, in);
            } catch (IOException e) {
                return null;
            }
        }
    }

    @PluginMethod
    public void printHtml(PluginCall call) {
        String html = call.getString("html");
        String name = call.getString("name", "Beldora CB");
        if (html == null) {
            call.reject("No document to print.");
            return;
        }
        getActivity().runOnUiThread(() -> {
            Context ctx = getContext();
            WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                    .setDomain("localhost")
                    .addPathHandler("/", new PublicAssetsHandler(ctx))
                    .build();
            WebView view = new WebView(ctx);
            view.getSettings().setJavaScriptEnabled(false);
            view.getSettings().setAllowFileAccess(false);
            view.setWebViewClient(new WebViewClientCompat() {
                private boolean started = false;

                @Override
                public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest request) {
                    return loader.shouldInterceptRequest(request.getUrl());
                }

                @Override
                public void onPageFinished(WebView v, String url) {
                    if (started) return;
                    started = true;
                    // Give fonts a moment, then hand the page to the print service
                    new Handler(Looper.getMainLooper()).postDelayed(() -> {
                        try {
                            PrintManager pm = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                            PrintDocumentAdapter adapter = v.createPrintDocumentAdapter(name);
                            pm.print(name, adapter, new PrintAttributes.Builder().build());
                            call.resolve();
                        } catch (Exception e) {
                            call.reject("Could not open the print screen: " + e.getMessage());
                        }
                    }, 700);
                }
            });
            printViews.add(view);
            // Old documents can go once a few newer ones exist
            while (printViews.size() > 6) printViews.remove(0).destroy();
            view.loadDataWithBaseURL("https://localhost/", html, "text/html", "UTF-8", null);
        });
    }
}
