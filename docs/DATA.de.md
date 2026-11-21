# Daten, Verschlüsselung und Sicherheit

[English](DATA.md) · **Deutsch**

[Zurück zur README](../README.de.md)

## Verschlüsselung

Zwei Stufen, beide ohne zusätzliches Anmelden beim Eintragen:

**1. Lokaler Speicher (automatisch).** Über HTTPS (oder `localhost`) legt die App die Einträge nicht mehr als Klartext im Browser ab, sondern in IndexedDB. Jeder Wert ist mit einem zufälligen Geräteschlüssel verschlüsselt (AES-256-GCM, der Schlüssel lässt sich im Browser nicht auslesen). Bestehende Daten werden beim ersten Start übernommen. Das schützt vor dem Auslesen der Browser-Daten, etwa aus einem Backup des Browser-Speichers, nicht vor jemandem, der dein entsperrtes Gerät benutzt. Ohne HTTPS (z. B. `http://192.168.…`) bleibt es beim bisherigen Browser-Speicher; unter *Optionen → Speicher und Server* steht, welcher Fall vorliegt.

**2. Ende-zu-Ende-Verschlüsselung (optional, nur mit Server).** Einschalten unter *Optionen → Verschlüsselung*. Einträge und Essen werden auf dem Gerät verschlüsselt, bevor sie zum Server gehen. Der Server, seine Backups und der Admin sehen nur Chiffretext, den Monat der Einträge, den Zeitpunkt der Änderung und die Anzahl. Konsistenz, Blut, Schmerz, Notizen und Essen sind für sie nicht lesbar. Eine eigene Verschlüsselung der Server-Datenbank ist damit nicht nötig.

- **Wiederherstellungscode:** Beim Einschalten bekommst du einen Code aus 32 Zeichen (160 Bit). Er verpackt den Datenschlüssel, der so für den Server unlesbar auf dem Server liegt. Auf einem neuen Gerät meldest du dich wie gewohnt an und gibst den Code einmalig ein. Schreibe ihn auf oder speichere ihn im Passwortmanager.
- **Passwort vergessen:** Setze es zurück (`docker compose exec gutkeeper node server/cli.js reset-password`, siehe [Anmeldung und Sitzungen](#sicherheit-und-datenschutz)). Das Zurücksetzen betrifft die Verschlüsselung nicht: Der Datenschlüssel ist durch den Wiederherstellungscode verpackt, nicht durch das Passwort. Deine Daten bleiben lesbar, und auf bereits freigeschalteten Geräten musst du den Code nicht neu eingeben. Den Code brauchst du nur auf neuen Geräten.
- **Code vergessen:** Auf einem bereits freigeschalteten Gerät lässt sich unter *Optionen → Verschlüsselung* ein neuer Code erzeugen.
- **Code und alle freigeschalteten Geräte verloren:** Dann sind die Daten auf dem Server nicht mehr lesbar, auch nicht für den Admin. Das ist der Preis der Ende-zu-Ende-Verschlüsselung. Sichere deshalb regelmäßig ein JSON-Backup aus der App.
- **Ausschalten:** Jederzeit unter *Optionen → Verschlüsselung*; die Daten liegen danach wieder lesbar auf dem Server. Auch dann bleiben alte Backups, was sie waren: Backups von vor dem Einschalten enthalten Klartext (beim Einschalten lassen sie sich im Einzelnutzer-Betrieb löschen), Backups aus der verschlüsselten Zeit lassen sich nur mit dem Code von damals lesen.
- **Grenzen:** Der Server liefert die App selbst aus. Ein Server, der manipulierten Programmcode ausliefert, könnte Eingaben abgreifen; die Verschlüsselung schützt vor Mitlesen in Datenbank und Backups, nicht vor einem bösartigen Betreiber. Der Server-CSV-Export geschieht bei aktiver Verschlüsselung in der App. Die Funktion braucht HTTPS (oder `localhost`).

## Sicherheit und Datenschutz

- **Netzwerk:** Der Server nimmt nur Anfragen aus **privaten Adressbereichen** an (LAN, VPN, Tailscale). Gib den Port nicht im Router frei.
- **Reverse Proxy:** Ohne `TRUST_PROXY=1` sieht der Server nur die (private) Adresse des Proxys und lässt alles zu. Ist der Proxy aus dem Internet erreichbar (z. B. weil er auch andere Dienste veröffentlicht), richte deshalb unbedingt das Passwort ein **und** setze `TRUST_PROXY=1`. Dann lehnt der Server Besucher aus dem Internet anhand ihrer echten Adresse ab. Setze zusätzlich `TRUSTED_PROXY` auf die Adresse des Proxys, sonst kann jedes Gerät im privaten Netz die Client-IP per `X-Real-IP` fälschen.
- **Anmeldung und Sitzungen:** Beim ersten Start steht ein Einmal-Code im Server-Log; damit legst du in der App das Passwort fest (Einzelnutzer) bzw. das erste Konto (Mehrbenutzer). Das Passwort wird nur als scrypt-Hash in der Datenbank gespeichert. Die Anmeldung per `POST` liefert ein signiertes Cookie (`HttpOnly`, `SameSite=Strict`, `Secure` über HTTPS; die eigenständige App nutzt stattdessen ein Token im Header). Die Sitzung ist **gleitend**: Sie gilt 180 Tage ab der letzten Nutzung, der Server stellt bei Anfragen ein frisches Cookie aus, sobald das alte älter als ein Tag ist. Ein Gerät bleibt also angemeldet, bis du dich abmeldest, *Andere Geräte abmelden* wählst (*Optionen → Sicherheit*), das Passwort änderst oder die App 180 Tage lang nicht benutzt wird. Das Passwort ändern: *Optionen → Sicherheit* (mit mehreren Konten: *Konto und Sicherheit*), dabei werden die anderen Geräte abgemeldet. Auf dem Server: `docker compose exec gutkeeper node server/cli.js reset-password [NEUES_PASSWORT]` (im Einzelnutzer-Betrieb ohne Namen, mit mehreren Konten `reset-password NAME [NEUES_PASSWORT]`; ohne Angabe wird das Passwort von der Standardeingabe gelesen) bzw. `logout-all [NAME]`. Das Zurücksetzen ändert nichts an einer eingeschalteten Ende-zu-Ende-Verschlüsselung (siehe [Verschlüsselung](#verschlüsselung)). Nach fünf falschen Versuchen steigt die Wartezeit pro IP und pro Konto; im Einzelnutzer-Betrieb gilt zusätzlich eine gemeinsame Sperre von höchstens 15 Minuten, damit wechselnde Adressen nicht helfen. Beim Einrichten bremst dieselbe Sperre das Raten des Einmal-Codes.
- **Weitere Schutzmaßnahmen:** Content-Security-Policy, `X-Frame-Options`, `nosniff`, Ablehnung fremder Seiten bei schreibenden Anfragen (`Sec-Fetch-Site`), Prüfung des Host-Headers gegen DNS-Rebinding (`ALLOWED_HOSTS`, nur wenn gesetzt). Der Docker-Container ist gehärtet: keine Linux-Capabilities (`cap_drop: ALL`), `no-new-privileges`, schreibgeschütztes Dateisystem (beschrieben wird nur `/data`, `/backups` und `/tmp`).
- **App-Sperre (PIN) und Fingerabdruck/Gesicht:** Optional und nur für das jeweilige Gerät. Die PIN (4–12 Ziffern) wird lokal als Prüfwert gespeichert und **nie an den Server gesendet**; der Server wird zum Entsperren nicht gefragt (das geht also auch offline). Sie sperrt die Oberfläche beim Öffnen und nach 0, 1 oder 5 Minuten im Hintergrund (einstellbar). Wer die PIN vergisst, meldet sich mit dem Server-Passwort an („PIN vergessen?“), dann wird die PIN des Geräts entfernt. Fingerabdruck/Gesicht ersetzt das Eintippen der PIN und braucht HTTPS. Die Sperre schützt die Oberfläche; die Daten im Browser sind davon getrennt verschlüsselt (siehe [Verschlüsselung](#verschlüsselung)). Wird die Sitzung am Server ungültig, erscheint die Passwort-Anmeldung, nicht die PIN-Abfrage.
- **Grenzen:** Passwort und PIN sperren die Oberfläche und schützen den Server, ersetzen aber keine Displaysperre und keine Geräteverschlüsselung. Die Datenbank auf dem Server ist ohne Ende-zu-Ende-Verschlüsselung unverschlüsselt (nutze ggf. eine verschlüsselte Festplatte oder schalte sie ein).
- **Mehrere Konten:** Die Konten sind in der App strikt getrennt. Ohne eingeschaltete Ende-zu-Ende-Verschlüsselung kann ein Admin mit Vollzugriff (`ADMIN_FULL_ACCESS=1`) über Backups und Gesamt-Export trotzdem alle Daten lesen. Mit `ADMIN_FULL_ACCESS=0` entfallen Backups und Gesamt-Export, aber ein Admin kann weiterhin das Passwort eines Kontos zurücksetzen und sich damit anmelden, um dessen Daten zu sehen (die Person merkt es: das alte Passwort gilt nicht mehr, sie muss ein neues vergeben). Echte Trennung gibt es nur mit Ende-zu-Ende-Verschlüsselung oder mit einem eigenen Container pro Person.
- **Datenschutz:** Es gibt keine externen Anfragen, keine Schriften oder Skripte von Dritten und keine Telemetrie. Einzige Ausnahme: Tippst du unter *Optionen → Über* auf „Nach Updates suchen“, fragt die App bei `api.github.com` die neueste Versionsnummer ab (ohne Daten aus der App).

## Daten, Sync und Backups

- **Sync:** Jeder Eintrag hat eine eindeutige ID und einen Zeitstempel; bei Konflikten gewinnt die neuere Änderung. Der Abgleich läuft beim Öffnen, nach Änderungen und alle 60 Sekunden. Der Punkt oben rechts zeigt den Stand (grün synchron, orange wartet, grau offline).
- **Speicher auf dem Gerät:** Standardmäßig nur die letzten 12 Monate (`LOCAL_MONTHS`). 12 Monate belegen im Browser nur wenige hundert KB; auch mehrere Jahre bleiben weit unter dem Limit (im Notfall-Speicher ohne HTTPS etwa 5 MB, im verschlüsselten Speicher gibt es kein solches Limit). Unter *Optionen → Speicher und Server* siehst du den aktuellen Verbrauch von Gerät und Server.
- **Ältere Einträge:** Wählst du in Verlauf, Statistik, Kalender oder Bericht einen Zeitraum vor dem lokalen Speicherbereich, holt die App die Einträge live vom Server, solange eine Verbindung besteht. Sie liegen nur im Arbeitsspeicher und werden beim Neuladen verworfen. Das ist sparsam: Im Test (4.600 Einträge) ergibt ein Monat etwa 3 KB, ein Jahr etwa 40 KB und alles etwa 150 KB, jeweils komprimiert übertragen. Im WLAN oder per VPN daheim fällt kein Mobilfunk-Datenvolumen an. Unter *Optionen → Speicher und Server → Daten auf diesem Gerät* lässt sich der Abruf auf „Nur auf Tipp“ umstellen. Ohne Verbindung fehlen die älteren Einträge, und die App weist darauf hin.
- **Server-Backups:** Standardmäßig täglich eine Kopie der Datenbank in `data/backups/` (Anzahl: `BACKUP_KEEP`, Abstand: `BACKUP_INTERVAL_HOURS`, Ordner: `BACKUP_HOST_DIR`). Unter *Optionen → Administration* lassen sie sich anlegen, herunterladen, zurückspielen (vorher entsteht ein Sicherungspunkt) und löschen. „Alle Daten löschen“ entfernt die Einträge, aber nicht die Backups.
- **Datenbank:** SQLite in `data/gutkeeper.db`. Zum Sichern genügt es, den Ordner `data/` zu kopieren.
- **Alle Daten löschen** wirkt auf dem Server und beim nächsten Abgleich auch auf allen Geräten.
- **Konto löschen** (*Optionen → Daten löschen*, verlangt das Passwort; falsche Eingaben zählen wie bei der Anmeldung als Fehlversuch, `POST /api/account/delete`): Im Einzelnutzer-Betrieb löscht es alles auf dem Server (Einträge, Essen, Einstellungen, Verschlüsselungsschlüssel, Passwort) und auf dem Gerät. Der Server beginnt danach wieder bei der Einrichtung, und im Log steht ein **neuer Einmal-Code**; alte Sitzungen sind ungültig. Wahlweise werden auch die Server-Backups gelöscht, sonst bleiben sie und lassen sich nach der neuen Einrichtung zurückspielen. Mit Konten löscht jede Person ihr eigenes Konto samt Daten. Die Daten eines gelöschten Kontos bleiben in den vorhandenen Server-Backups, bis diese ablaufen (`BACKUP_KEEP`); über die App lassen sie sich aber nicht zurückspielen, weil Konto-IDs nie wiederverwendet werden. Nur das manuelle Zurückspielen der ganzen Datenbankdatei würde sie zurückbringen. Der **letzte Admin** muss erst ein anderes Konto zum Admin machen (*Benutzerverwaltung → Zum Admin*); ist es das letzte Konto überhaupt, wird der Server wie im Einzelnutzer-Betrieb zurückgesetzt. In der serverlosen Version und der APK setzt „Konto löschen“ die App auf dem Gerät komplett zurück (Einträge, App-Sperre, Backup-Einstellungen, Darstellung …; Bestätigung mit der PIN bzw. dem Wort „LÖSCHEN“); bereits geschriebene Backup-Dateien bleiben. Als Admin lässt sich ein Konto auch auf dem Server löschen: `node server/cli.js delete-user NAME`.

### CSV-Format (Import/Export)

Trennzeichen `;`, erste Zeile = Kopfzeile. Spalten dürfen fehlen oder leer sein, einzig Datum und Uhrzeit sind Pflicht, dazu mindestens Konsistenz, Luft oder Schmerz.
Beim **Export** folgen Kopfzeile und Wörter der eingestellten Sprache (z. B. `date;time;consistency;…` und `yes`/`no`). Beim **Import** werden deutsche und englische Spaltennamen und Werte erkannt.

| Spalte | Werte |
|---|---|
| `datum` | `2026-11-05` oder `05.11.2026` |
| `uhrzeit` | `08:15` |
| `konsistenz` | `1`–`7` (Bristol), leer = kein Stuhl |
| `stuhldrang` | `0`–`3` oder keiner/leicht/mittel/stark |
| `menge` | `1`–`3` oder wenig/mittel/viel |
| `blut`, `schleim`, `luft` | `ja`/`nein` (oder leer) |
| `schmerz` | `0`–`3` |
| `farbe` | braun, hell, gelb, grün, schwarz, rot |
| `notiz` | Text (max. 300 Zeichen), bei Semikolons in Anführungszeichen |

### Stuhlfarben: Zahlen und Farbtöne

Die Farbe eines Eintrags wird als **Zahl** gespeichert (Datenbank, JSON-Backup, API); im CSV-Export steht das Wort in der Sprache der App. Der Farbton, in dem die Farbe angezeigt wird, ist nur Darstellung und wird nicht mit den Einträgen gespeichert.

| Zahl | CSV-Wort | Standard-Farbton |
|---|---|---|
| 0 | *(leer, unbekannt)* | – |
| 1 | braun | `#7a4e2d` |
| 2 | hell | `#d9ccab` |
| 3 | gelb | `#d6b23a` |
| 4 | grün | `#5d8f3a` |
| 5 | schwarz | `#1f1d1c` |
| 6 | rot | `#c0334a` |

**Farbtöne anpassen (optional):** In `data/settings.json` kannst du die Farbtöne für alle Konten ändern. Nicht genannte Stufen behalten den Standard, ohne die Datei oder bei einem ungültigen Wert (erwartet wird `#RRGGBB`) gelten die Standardtöne. Die Zahlen und ihre Bedeutung bleiben fest. Nach dem Speichern den Container neu starten. In der serverlosen Version gelten immer die Standardtöne.

```json
{ "colors": { "1": "#6b4423", "6": "#b00020" } }
```
