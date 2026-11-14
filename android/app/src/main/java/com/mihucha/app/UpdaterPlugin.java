package com.mihucha.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

// Descarga el APK publicado en GitHub y abre el instalador de Android.
@CapacitorPlugin(name = "Updater")
public class UpdaterPlugin extends Plugin {

    @PluginMethod
    public void canInstall(PluginCall call) {
        boolean ok = Build.VERSION.SDK_INT < 26 || getContext().getPackageManager().canRequestPackageInstalls();
        JSObject r = new JSObject();
        r.put("allowed", ok);
        call.resolve(r);
    }

    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    @PluginMethod
    public void install(PluginCall call) {
        String url = call.getString("url");
        if (url == null) { call.reject("Falta la dirección"); return; }
        new Thread(() -> {
            try {
                File dir = new File(getContext().getCacheDir(), "update");
                dir.mkdirs();
                File apk = new File(dir, "MiHucha.apk");
                download(url, apk);
                // Un momento para que la app enseñe la animación de «lista» antes del instalador.
                Thread.sleep(1100);
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
                Intent i = new Intent(Intent.ACTION_VIEW);
                i.setDataAndType(uri, "application/vnd.android.package-archive");
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(i);
                call.resolve();
            } catch (Exception e) {
                call.reject("No se pudo descargar: " + e.getMessage());
            }
        }).start();
    }

    private void download(String url, File out) throws Exception {
        // GitHub redirige a otro dominio para la descarga: seguimos las redirecciones a mano.
        for (int hops = 0; hops < 6; hops++) {
            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(15000);
            c.setReadTimeout(30000);
            c.setRequestProperty("Accept", "application/octet-stream");
            int code = c.getResponseCode();
            if (code >= 300 && code < 400) { url = c.getHeaderField("Location"); c.disconnect(); continue; }
            if (code != 200) throw new Exception("HTTP " + code);
            long total = c.getContentLengthLong();
            try (InputStream in = c.getInputStream(); OutputStream os = new FileOutputStream(out)) {
                byte[] buf = new byte[65536];
                int n, lastPct = -1;
                long done = 0, lastSent = 0;
                while ((n = in.read(buf)) > 0) {
                    os.write(buf, 0, n);
                    done += n;
                    int pct = total > 0 ? (int) (done * 100 / total) : -1;
                    long now = System.currentTimeMillis();
                    // Avisa a la app como mucho una vez por cada 1 % (o cada 200 ms si no se sabe el tamaño).
                    if (total > 0 ? pct != lastPct : now - lastSent > 200) {
                        lastPct = pct; lastSent = now;
                        JSObject p = new JSObject();
                        p.put("done", done);
                        p.put("total", total);
                        notifyListeners("progress", p);
                    }
                }
            } finally { c.disconnect(); }
            return;
        }
        throw new Exception("demasiadas redirecciones");
    }
}
