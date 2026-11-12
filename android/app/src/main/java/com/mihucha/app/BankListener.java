package com.mihucha.app;

import android.app.Notification;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

// Escucha los avisos de las apps de banco y guarda los que hablan de un importe,
// para que la app los convierta en movimientos al abrirse. Nada sale del móvil.
public class BankListener extends NotificationListenerService {
    private static final String PREFS = "mihucha_noti";
    private static final String KEY = "queue";
    private static final int MAX = 200;
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
            String title = str(x.getCharSequence(Notification.EXTRA_TITLE));
            String text = str(x.getCharSequence(Notification.EXTRA_BIG_TEXT));
            if (text.isEmpty()) text = str(x.getCharSequence(Notification.EXTRA_TEXT));
            if (!MONEY.matcher(title + " " + text).find()) return;
            push(this, sbn.getPackageName(), title, text, sbn.getPostTime());
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

    static synchronized void push(Context ctx, String pkg, String title, String text, long time) throws Exception {
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
