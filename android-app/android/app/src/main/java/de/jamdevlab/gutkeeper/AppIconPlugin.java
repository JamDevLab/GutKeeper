package de.jamdevlab.gutkeeper;

import android.content.ComponentName;
import android.content.pm.PackageManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Wechselt das Icon auf dem Startbildschirm: Je Icon-Satz gibt es einen activity-alias in AndroidManifest.xml,
// genau einer davon ist aktiv. Die Icons stecken fest in der APK (tools/android-style.js), deshalb ohne Neubau umschaltbar.
@CapacitorPlugin(name = "AppIcon")
public class AppIconPlugin extends Plugin {
    private static final String[] ICONS = { "bristol", "classic", "list", "diary", "shield", "ring", "crest", "guard" };

    private ComponentName alias(String icon) {
        String name = "Icon" + Character.toUpperCase(icon.charAt(0)) + icon.substring(1);
        return new ComponentName(getContext().getPackageName(), getContext().getPackageName() + "." + name);
    }

    private boolean enabled(PackageManager pm, String icon) {
        int s = pm.getComponentEnabledSetting(alias(icon));
        // DEFAULT = Wert aus dem Manifest: dort ist nur „bristol“ aktiv
        return s == PackageManager.COMPONENT_ENABLED_STATE_ENABLED || (s == PackageManager.COMPONENT_ENABLED_STATE_DEFAULT && "bristol".equals(icon));
    }

    @PluginMethod
    public void get(PluginCall call) {
        PackageManager pm = getContext().getPackageManager();
        String cur = "bristol";
        for (String i : ICONS) if (enabled(pm, i)) { cur = i; break; }
        JSObject r = new JSObject();
        r.put("icon", cur);
        call.resolve(r);
    }

    @PluginMethod
    public void set(PluginCall call) {
        String icon = call.getString("icon", "");
        boolean known = false;
        for (String i : ICONS) if (i.equals(icon)) known = true;
        if (!known) { call.reject("unknown icon"); return; }
        PackageManager pm = getContext().getPackageManager();
        // Erst den neuen Eintrag einschalten, dann die anderen aus: So gibt es nie einen Moment ohne Icon
        pm.setComponentEnabledSetting(alias(icon), PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP);
        for (String i : ICONS) {
            if (!i.equals(icon)) pm.setComponentEnabledSetting(alias(i), PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP);
        }
        call.resolve();
    }
}
