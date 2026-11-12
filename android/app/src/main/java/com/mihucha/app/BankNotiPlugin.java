package com.mihucha.app;

import android.Manifest;
import android.content.Intent;
import android.location.Address;
import android.location.Geocoder;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.List;
import java.util.Locale;

// Puente entre los avisos del banco guardados por BankListener y la parte web,
// y gestión del permiso de ubicación.
@CapacitorPlugin(
    name = "BankNoti",
    permissions = {
        @Permission(strings = {Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, alias = "location"),
        @Permission(strings = {Manifest.permission.ACCESS_BACKGROUND_LOCATION}, alias = "background")
    }
)
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
    public void openAppSettings(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
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

    // ---------- ubicación ----------
    private boolean hasLocation() {
        return BankListener.granted(getContext(), Manifest.permission.ACCESS_FINE_LOCATION)
            || BankListener.granted(getContext(), Manifest.permission.ACCESS_COARSE_LOCATION);
    }

    private boolean hasBackground() {
        return Build.VERSION.SDK_INT < 29 || BankListener.granted(getContext(), Manifest.permission.ACCESS_BACKGROUND_LOCATION);
    }

    @PluginMethod
    public void geoStatus(PluginCall call) {
        JSObject r = new JSObject();
        r.put("on", BankListener.geoOn(getContext()));
        r.put("fine", hasLocation());
        r.put("background", hasLocation() && hasBackground());
        r.put("geocoder", Geocoder.isPresent());
        call.resolve(r);
    }

    @PluginMethod
    public void geoSet(PluginCall call) {
        BankListener.setGeo(getContext(), Boolean.TRUE.equals(call.getBoolean("on", false)));
        geoStatus(call);
    }

    @PluginMethod
    public void geoRequest(PluginCall call) {
        if (hasLocation()) { geoStatus(call); return; }
        requestPermissionForAlias("location", call, "geoDone");
    }

    @PluginMethod
    public void geoRequestBackground(PluginCall call) {
        if (!hasLocation()) { call.reject("Primero concede la ubicación"); return; }
        if (hasBackground()) { geoStatus(call); return; }
        requestPermissionForAlias("background", call, "geoDone");
    }

    @PermissionCallback
    private void geoDone(PluginCall call) {
        geoStatus(call);
    }

    // Convierte coordenadas en ciudad y calle con el servicio de direcciones de Android.
    @SuppressWarnings("deprecation")
    @PluginMethod
    public void geocode(final PluginCall call) {
        final double lat = call.getDouble("lat", 0.0);
        final double lon = call.getDouble("lon", 0.0);
        new Thread(() -> {
            JSObject r = new JSObject();
            try {
                if (Geocoder.isPresent()) {
                    List<Address> l = new Geocoder(getContext(), new Locale("es", "ES")).getFromLocation(lat, lon, 1);
                    if (l != null && !l.isEmpty()) {
                        Address a = l.get(0);
                        String loc = a.getLocality() != null ? a.getLocality() : a.getSubAdminArea();
                        String street = a.getThoroughfare();
                        if (street != null && a.getSubThoroughfare() != null) street += " " + a.getSubThoroughfare();
                        r.put("locality", loc);
                        r.put("address", street);
                        r.put("country", a.getCountryCode());
                    }
                }
            } catch (Exception e) {
                r.put("error", e.getClass().getSimpleName());
            }
            call.resolve(r);
        }).start();
    }
}
