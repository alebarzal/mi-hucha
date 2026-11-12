package com.mihucha.app;

import android.Manifest;
import android.app.Notification;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

// Escucha los avisos de las apps de banco y guarda los que hablan de un importe,
// para que la app los convierta en movimientos al abrirse. Si el usuario lo activa,
// guarda también dónde estaba en ese instante. Nada sale del móvil.
public class BankListener extends NotificationListenerService {
    private static final String PREFS = "mihucha_noti";
    private static final String KEY = "queue";
    private static final int MAX = 200;
    private static final ExecutorService EXEC = Executors.newSingleThreadExecutor();
    private static final String[] BANKS = {
        "santander", "bbva", "caixa", "imagin", "openbank", "ingdirect", "bankinter", "sabadell", "unicaja", "abanca",
        "kutxa", "ibercaja", "cajamar", "cajarural", "ruralvia", "laboralkutxa", "evobanco", "pibank", "myinvestor",
        "revolut", "n26", "wise", "bizum", "walletnfcrel", "samsung.android.spay", "paypal"
    };
    private static final Pattern MONEY = Pattern.compile("\\d\\s?(€|eur\\b|euros?\\b)", Pattern.CASE_INSENSITIVE);

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        try {
            if (sbn == null || !isBank(sbn.getPackageName())) return;
            seen(this);
            Notification n = sbn.getNotification();
            if (n == null || (n.flags & Notification.FLAG_GROUP_SUMMARY) != 0) return;
            Bundle x = n.extras;
            if (x == null) return;
            final String title = str(x.getCharSequence(Notification.EXTRA_TITLE));
            String t = str(x.getCharSequence(Notification.EXTRA_BIG_TEXT));
            if (t.isEmpty()) t = str(x.getCharSequence(Notification.EXTRA_TEXT));
            final String text = t;
            if (!MONEY.matcher(title + " " + text).find()) return;
            final String pkg = sbn.getPackageName();
            final long time = sbn.getPostTime();
            final Context ctx = getApplicationContext();
            if (geoOn(ctx)) {
                // La búsqueda de posición puede tardar unos segundos: fuera del hilo del servicio.
                EXEC.execute(() -> {
                    try { push(ctx, pkg, title, text, time, locate(ctx)); } catch (Exception ignored) {}
                });
            } else {
                push(ctx, pkg, title, text, time, null);
            }
        } catch (Exception ignored) {}
    }

    private boolean isBank(String pkg) {
        if (pkg == null) return false;
        String p = pkg.toLowerCase();
        for (String b : BANKS) if (p.contains(b)) return true;
        // En compilaciones de prueba se aceptan avisos lanzados con adb para poder verificarlo.
        boolean debug = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        return debug && "com.android.shell".equals(pkg);
    }

    private static String str(CharSequence c) {
        return c == null ? "" : c.toString().trim();
    }

    // ---------- ubicación ----------
    static boolean geoOn(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("geo_on", false);
    }

    static void setGeo(Context ctx, boolean on) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("geo_on", on).apply();
    }

    static boolean granted(Context ctx, String perm) {
        return ctx.checkSelfPermission(perm) == PackageManager.PERMISSION_GRANTED;
    }

    // Devuelve siempre un objeto con "geoState" (qué pasó) y, si hay posición, lat/lon/acc/locAge/fresh.
    static JSONObject locate(Context ctx) {
        JSONObject o = new JSONObject();
        try {
            boolean any = granted(ctx, Manifest.permission.ACCESS_FINE_LOCATION) || granted(ctx, Manifest.permission.ACCESS_COARSE_LOCATION);
            if (!any) { o.put("geoState", "sin permiso de ubicación"); return o; }
            boolean bg = Build.VERSION.SDK_INT < 29 || granted(ctx, Manifest.permission.ACCESS_BACKGROUND_LOCATION);
            LocationManager lm = (LocationManager) ctx.getSystemService(Context.LOCATION_SERVICE);
            if (lm == null) { o.put("geoState", "sin servicio de ubicación"); return o; }
            Location loc = null;
            boolean fresh = false;
            if (Build.VERSION.SDK_INT >= 30) {
                for (String p : new String[] {"fused", LocationManager.NETWORK_PROVIDER, LocationManager.GPS_PROVIDER}) {
                    try {
                        if (!lm.isProviderEnabled(p)) continue;
                        final Location[] out = new Location[1];
                        final CountDownLatch latch = new CountDownLatch(1);
                        lm.getCurrentLocation(p, null, ctx.getMainExecutor(), l -> { out[0] = l; latch.countDown(); });
                        latch.await(6, TimeUnit.SECONDS);
                        if (out[0] != null) { loc = out[0]; fresh = true; break; }
                    } catch (Exception ignored) {}
                }
            }
            if (loc == null) {
                for (String p : lm.getProviders(true)) {
                    try {
                        Location l = lm.getLastKnownLocation(p);
                        if (l != null && (loc == null || l.getTime() > loc.getTime())) loc = l;
                    } catch (Exception ignored) {}
                }
                if (loc != null && System.currentTimeMillis() - loc.getTime() > 15 * 60 * 1000L) loc = null;
            }
            if (loc == null) {
                o.put("geoState", bg ? "sin posición disponible" : "sin permiso «todo el tiempo»");
                return o;
            }
            o.put("lat", loc.getLatitude());
            o.put("lon", loc.getLongitude());
            o.put("acc", (double) loc.getAccuracy());
            o.put("locAge", Math.max(0, (System.currentTimeMillis() - loc.getTime()) / 1000));
            o.put("fresh", fresh);
            o.put("geoState", (fresh ? "posición actual" : "última posición conocida") + (bg ? "" : " (sin permiso «todo el tiempo»)"));
        } catch (Exception e) {
            try { o.put("geoState", "error: " + e.getClass().getSimpleName()); } catch (Exception ignored) {}
        }
        return o;
    }

    // ---------- cola de avisos ----------
    static synchronized void push(Context ctx, String pkg, String title, String text, long time, JSONObject geo) throws Exception {
        SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        JSONArray q = new JSONArray(sp.getString(KEY, "[]"));
        for (int i = 0; i < q.length(); i++) {
            JSONObject o = q.getJSONObject(i);
            if (text.equals(o.optString("text")) && title.equals(o.optString("title")) && Math.abs(time - o.optLong("time")) < 120000) return;
        }
        JSONObject o = new JSONObject();
        o.put("pkg", pkg);
        o.put("title", title);
        o.put("text", text);
        o.put("time", time);
        if (geo != null) {
            java.util.Iterator<String> keys = geo.keys();
            while (keys.hasNext()) { String k = keys.next(); o.put(k, geo.get(k)); }
        }
        q.put(o);
        while (q.length() > MAX) q.remove(0);
        sp.edit().putString(KEY, q.toString()).apply();
    }

    private static synchronized void seen(Context ctx) {
        SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        sp.edit().putInt("seen", sp.getInt("seen", 0) + 1).putLong("lastSeen", System.currentTimeMillis()).apply();
    }

    static int seenCount(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getInt("seen", 0);
    }

    static long lastSeen(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong("lastSeen", 0);
    }

    static synchronized String take(Context ctx) {
        SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String q = sp.getString(KEY, "[]");
        sp.edit().remove(KEY).apply();
        return q;
    }
}
