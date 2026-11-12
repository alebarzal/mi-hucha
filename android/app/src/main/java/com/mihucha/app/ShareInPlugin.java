package com.mihucha.app;

import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;

// Recibe un PDF compartido o abierto desde otra app (por ejemplo, la del banco)
// y se lo entrega a la parte web para importarlo.
@CapacitorPlugin(name = "ShareIn")
public class ShareInPlugin extends Plugin {
    private static final int MAX_BYTES = 20 * 1024 * 1024;
    private static final String DONE = "mihucha_done";
    private String pending;

    @Override
    public void load() {
        read(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (read(intent)) notifyListeners("shared", new JSObject(), true);
    }

    private boolean read(Intent intent) {
        if (intent == null || intent.getBooleanExtra(DONE, false)) return false;
        String action = intent.getAction();
        Uri uri = null;
        if (Intent.ACTION_SEND.equals(action)) uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        else if (Intent.ACTION_VIEW.equals(action)) uri = intent.getData();
        if (uri == null) return false;
        intent.putExtra(DONE, true);
        try (InputStream in = getContext().getContentResolver().openInputStream(uri)) {
            if (in == null) return false;
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
                if (out.size() > MAX_BYTES) return false;
            }
            pending = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    @PluginMethod
    public void take(PluginCall call) {
        JSObject r = new JSObject();
        r.put("data", pending);
        pending = null;
        call.resolve(r);
    }
}
