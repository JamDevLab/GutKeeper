package de.jamdevlab.gutkeeper;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;

// Speichert ein PNG über den MediaStore in Bilder/GutKeeper (erscheint in der Galerie).
// Ab Android 10 ohne Berechtigung; darunter lehnt das Plugin ab und die App nimmt Dokumente/GutKeeper.
@CapacitorPlugin(name = "ImageSaver")
public class ImageSaverPlugin extends Plugin {
    private static final String FOLDER = "Pictures/GutKeeper";

    @PluginMethod
    public void savePng(PluginCall call) {
        String name = call.getString("name");
        String data = call.getString("data");
        if (name == null || data == null) { call.reject("name and data required"); return; }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) { call.reject("unsupported"); return; }
        new Thread(() -> {
            ContentResolver cr = getContext().getContentResolver();
            Uri uri = null;
            try {
                byte[] bytes = Base64.decode(data, Base64.DEFAULT);
                ContentValues v = new ContentValues();
                v.put(MediaStore.Images.Media.DISPLAY_NAME, name);
                v.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
                v.put(MediaStore.Images.Media.RELATIVE_PATH, FOLDER);
                v.put(MediaStore.Images.Media.IS_PENDING, 1); // unsichtbar, bis die Datei fertig geschrieben ist
                uri = cr.insert(MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), v);
                if (uri == null) throw new IllegalStateException("insert failed");
                try (OutputStream out = cr.openOutputStream(uri)) {
                    if (out == null) throw new IllegalStateException("no stream");
                    out.write(bytes);
                }
                v.clear();
                v.put(MediaStore.Images.Media.IS_PENDING, 0);
                cr.update(uri, v, null, null);
                JSObject ret = new JSObject();
                ret.put("folder", FOLDER);
                call.resolve(ret);
            } catch (Exception e) {
                if (uri != null) cr.delete(uri, null, null);
                call.reject("save failed: " + e.getMessage(), e);
            }
        }).start();
    }
}
