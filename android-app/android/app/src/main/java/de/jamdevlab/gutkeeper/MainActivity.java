package de.jamdevlab.gutkeeper;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AppIconPlugin.class); // eigenes Plugin: Icon auf dem Startbildschirm wechseln
        registerPlugin(ImageSaverPlugin.class); // eigenes Plugin: Bilder in die Galerie speichern
        super.onCreate(savedInstanceState);
    }
}
