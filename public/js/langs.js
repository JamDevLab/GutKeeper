// Verfügbare Sprachen der Oberfläche. Deutsch ist die Sprache im Code (keine Übersetzungsdatei),
// jede weitere Sprache hat eine Datei lang-<code>.js mit `export const T = { "Deutscher Text": "Übersetzung", … }`.
// Neue Sprache: Datei anlegen (Vorlage: lang-en.js), hier eintragen und in public/sw.js (SHELL) aufnehmen.
// Fehlende Texte erscheinen auf Englisch. tests/consistency.test.js prüft, dass Liste und Dateien zusammenpassen.
//   code:    Sprachcode (ISO 639-1), auch Teil des Dateinamens
//   name:    Name in der Sprache selbst (für die Auswahl)
//   locale:  Format für Datum und Zahlen (Intl)
//   clock12: Uhrzeiten im Rückblick als 12-Stunden-Angabe (am/pm)
export const LANGS = [
  { code: 'de', name: 'Deutsch', locale: 'de-DE' },
  { code: 'en', name: 'English', locale: 'en-GB', clock12: true },
];
