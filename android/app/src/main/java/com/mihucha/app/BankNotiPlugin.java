package com.mihucha.app;

import android.content.Intent;
import android.provider.Settings;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Puente entre los avisos del banco guardados por BankListener y la parte web.
@CapacitorPlugin(name = "BankNoti")
public class BankNotiPlugin extends Plugin {

    @PluginMethod
    public void status(PluginCall call) {
        String on = Settings.Secure.getString(getContext().getContentResolver(), "enabled_notification_listeners");
        JSObject r = new JSObject();
        r.put("enabled", on != null && on.contains(getContext().getPackageName() + "/"));
        r.put("seen", BankListener.seenCount(getContext()));
        r.put("lastSeen", BankListener.lastSeen(getContext()));
        call.resolve(r);
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("No se pudo abrir los ajustes");
        }
    }

    @PluginMethod
    public void take(PluginCall call) {
        JSObject r = new JSObject();
        try {
            r.put("items", new JSArray(BankListener.take(getContext())));
        } catch (Exception e) {
            r.put("items", new JSArray());
        }
        call.resolve(r);
    }
}
