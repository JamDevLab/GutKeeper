# Änderungen

## 1.0.0

Erste Veröffentlichung.

- **Erfassen** in Sekunden auf einer Seite: Konsistenz (Bristol-Skala), Stuhldrang, Menge, Farbe, Schmerzen, Blut, Schleim, Luft und Notiz mit bearbeitbaren Schlagwörtern; optional **Essen** mit Mahlzeit, Vorschlägen und angehefteten Speisen. Keine Einträge in der Zukunft.
- **Verlauf** mit Filtern, **Jahresübersicht** und **Statistik:** Kennzahlen mit Vergleich zum Zeitraum davor, Anteil normal (Typ 3–4), aufklappbare Kachel „Auffälligkeiten“ mit Sprung in den gefilterten Verlauf, Stuhlgänge pro Tag/Woche, Ø Konsistenz im Verlauf, Tageszeit, Wochentag und Kalender. Ein Tipp auf den schon offenen Tab Verlauf oder Statistik scrollt nach oben. **Rückblick teilen:** ein Bild der letzten 7 Tage, des letzten Monats, des letzten Jahres (52 volle Wochen; jeweils bis gestern, damit nur abgeschlossene Tage zählen) oder eines eigenen Zeitraums in fünf Designs zum Durchwischen (Übersicht, Übersicht mit Skala, Formen, Tageszeit, Kalender), zum Teilen oder als Bild speichern, bewusst ohne heikle Angaben.
- **PDF-Bericht** direkt im Browser: dieselben Auswertungen in jedem Umfang, Einträge kurz (nur Auffälligkeiten), normal oder ausführlich; optional Name und Geburtsdatum, Essen, Schwarz-Weiß und Passwortschutz (AES-256).
- **Offline-first** mit Abgleich zwischen mehreren Geräten; ältere Einträge werden bei Bedarf live vom Server geladen.
- **Anmeldung und Sicherheit:** Server-Passwort mit Einmal-Code bei der Einrichtung, optional mehrere Konten (Admin, vorläufige Passwörter, Konto löschen), App-Sperre per PIN mit Fingerabdruck/Gesicht, verschlüsselter Gerätespeicher und optionale Ende-zu-Ende-Verschlüsselung. Schutz vor DNS-Rebinding, Beschränkung auf private Netze, Bremse gegen das Durchprobieren von Passwörtern.
- **Backups:** tägliche Server-Backups (optional verschlüsselt), JSON-/CSV-Export und -Import mit Vorschau, Export mit Passwort, Backup-Erinnerung; in der Android-App automatisches Backup in den Dokumente-Ordner (optional mit Passwort).
- **Ohne Server nutzbar** als Web-App oder **Android-App (APK)**; die App lässt sich mit einem Server verbinden (auch über http im Heimnetz). In der Android-App lässt sich das Icon auf dem Startbildschirm wechseln.
- **Acht eingebaute Icons** (`APP_ICON`): Bristol, Kranz, Wächter, Wappen, Klassisch, Schild, Liste und Tagebuch, alle auf Bristol-Grün; Wächter, Wappen, Schild, Liste und Tagebuch verraten auf dem Startbildschirm nichts. In der Android-App sind alle umschaltbar.
- **Geführter Einstieg** beim ersten Start (abschaltbar mit `ONBOARDING=0`).
- **Einstellungen in `data/settings.json`:** Mahlzeit-Zeiten, Zahl der Essensvorschläge, Farbtöne der Stuhlfarben, vorgegebene Notiz-Schlagwörter und angeheftete Speisen.
- **Deutsch und Englisch**, Hell-/Dunkelmodus, angepasste Darstellung für Tablet und Desktop.
- **Betrieb:** Docker-Image für amd64 und arm64 auf ghcr.io (gehärteter Container), kurze `docker-compose.yml` mit den wichtigsten Einstellungen und Vorlagen in `compose/` (auch mit allen Optionen), Server-Log und Admin-CLI auf Deutsch und Englisch, Werkzeuge zum Bauen der serverlosen Version und der APK, Tests für Server, Verschlüsselung und Oberfläche.
- **Dokumentation** auf Englisch und Deutsch: kurze README, Details in `docs/` (Installation, Konfiguration, Daten und Sicherheit, Entwicklung).
