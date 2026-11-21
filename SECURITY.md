# Security Policy

**Supported:** latest release only. **Report privately** via <https://github.com/JamDevLab/GutKeeper/security/advisories/new>, not in public issues. Include version, how you run it, impact and reproduction steps; no real health data. Best effort, reply within about 7 days.

**Out of scope:** misconfiguration, the `NO_AUTH`/`ALLOW_ANY` test flags, the local app PIN (a UI lock only). See [Security and privacy](docs/DATA.md#security-and-privacy).

---

# Sicherheitsrichtlinie

**Unterstützt:** nur das neueste Release ([Releases](https://github.com/JamDevLab/GutKeeper/releases)). Bitte vorher aktualisieren.

**Melden:** bitte **nicht** als öffentliches Issue, sondern privat über <https://github.com/JamDevLab/GutKeeper/security/advisories/new> (Security → Report a vulnerability). Bitte angeben:

- Version und Betriebsart (Docker, `npm start`, Web-App ohne Server, APK)
- Beschreibung, Auswirkung und Schritte zum Nachstellen
- relevante Einstellungen (z. B. Mehrbenutzer, Reverse Proxy, E2EE); keine echten Gesundheitsdaten

Hobbyprojekt: Antwort nach Möglichkeit innerhalb von etwa 7 Tagen, keine garantierten Fristen.

**Nicht im Geltungsbereich:** eigene Fehlkonfiguration (z. B. Internet ohne HTTPS), die Test-Schalter `NO_AUTH` und `ALLOW_ANY`, die lokale App-PIN (nur eine Oberflächensperre, keine Sicherheitsgrenze). Design-Überblick: [Sicherheit und Datenschutz](docs/DATA.de.md#sicherheit-und-datenschutz).
