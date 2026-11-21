# Security Policy

**Supported:** only the latest release ([Releases](https://github.com/JamDevLab/GutKeeper/releases)). Please update first.

**Reporting:** please **do not** open a public issue; report privately via <https://github.com/JamDevLab/GutKeeper/security/advisories/new> (Security → Report a vulnerability). Please include:

- version and how you run it (Docker, `npm start`, web app without a server, APK)
- description, impact and steps to reproduce
- relevant settings (e.g. multiple accounts, reverse proxy, E2EE); no real health data

Hobby project: I try to reply within about 7 days, with no guaranteed deadlines.

**Out of scope:** your own misconfiguration (e.g. internet access without HTTPS), the test flags `NO_AUTH` and `ALLOW_ANY`, the local app PIN (only a lock for the interface, not a security boundary). Design overview: [Security and privacy](docs/DATA.md#security-and-privacy).

---

# Sicherheitsrichtlinie

**Unterstützt:** nur das neueste Release ([Releases](https://github.com/JamDevLab/GutKeeper/releases)). Bitte vorher aktualisieren.

**Melden:** bitte **nicht** als öffentliches Issue, sondern privat über <https://github.com/JamDevLab/GutKeeper/security/advisories/new> (Security → Report a vulnerability). Bitte angeben:

- Version und Betriebsart (Docker, `npm start`, Web-App ohne Server, APK)
- Beschreibung, Auswirkung und Schritte zum Nachstellen
- relevante Einstellungen (z. B. Mehrbenutzer, Reverse Proxy, E2EE); keine echten Gesundheitsdaten

Hobbyprojekt: Antwort nach Möglichkeit innerhalb von etwa 7 Tagen, keine garantierten Fristen.

**Nicht im Geltungsbereich:** eigene Fehlkonfiguration (z. B. Internet ohne HTTPS), die Test-Schalter `NO_AUTH` und `ALLOW_ANY`, die lokale App-PIN (nur eine Oberflächensperre, keine Sicherheitsgrenze). Design-Überblick: [Sicherheit und Datenschutz](docs/DATA.de.md#sicherheit-und-datenschutz).
