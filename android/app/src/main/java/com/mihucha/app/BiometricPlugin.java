package com.mihucha.app;

import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Desbloqueo con huella o cara usando el diálogo del sistema.
@CapacitorPlugin(name = "Biometric")
public class BiometricPlugin extends Plugin {
    private static final int AUTH = BiometricManager.Authenticators.BIOMETRIC_WEAK;

    @PluginMethod
    public void available(PluginCall call) {
        JSObject r = new JSObject();
        r.put("value", BiometricManager.from(getContext()).canAuthenticate(AUTH) == BiometricManager.BIOMETRIC_SUCCESS);
        call.resolve(r);
    }

    @PluginMethod
    public void verify(final PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                BiometricPrompt prompt = new BiometricPrompt(
                    getActivity(),
                    ContextCompat.getMainExecutor(getContext()),
                    new BiometricPrompt.AuthenticationCallback() {
                        @Override
                        public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                            done(call, true);
                        }

                        @Override
                        public void onAuthenticationError(int code, @NonNull CharSequence msg) {
                            done(call, false);
                        }
                    }
                );
                prompt.authenticate(
                    new BiometricPrompt.PromptInfo.Builder()
                        .setTitle("Mi Hucha")
                        .setSubtitle("Desbloquea para ver tus cuentas")
                        .setNegativeButtonText("Usar PIN")
                        .setAllowedAuthenticators(AUTH)
                        .build()
                );
            } catch (Exception e) {
                done(call, false);
            }
        });
    }

    private void done(PluginCall call, boolean ok) {
        JSObject r = new JSObject();
        r.put("ok", ok);
        call.resolve(r);
    }
}
