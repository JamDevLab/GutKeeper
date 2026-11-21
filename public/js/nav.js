// Zurück-Taste und Wischgeste: Jede „Ebene“ (Fenster, Unterseite der Optionen, anderer Tab) legt einen Eintrag im Browser-Verlauf an.
// Die Zurück-Geste schließt dann zuerst die oberste Ebene, statt die App zu verlassen. Gezählt wird nur die Tiefe (history.state.dp),
// deshalb funktioniert es auch, wenn eine Ebene auf anderem Weg (Knopf, Tipp daneben) geschlossen wird.
const stack = [];

try { history.replaceState({ dp: 0 }, ''); } catch { /* ohne Verlauf (z. B. Test) */ }

// Ebene anmelden; fn wird aufgerufen, wenn der Nutzer „zurück“ geht. Rückgabe: Funktion, die die Ebene wieder abmeldet (wenn sie anders geschlossen wurde).
export function pushBack(fn) {
  const e = { fn };
  stack.push(e);
  try { history.pushState({ dp: stack.length }, ''); } catch { /* egal */ }
  return () => {
    const i = stack.indexOf(e);
    if (i < 0) return; // schon per „zurück“ geschlossen
    stack.splice(i, 1);
    try { history.go(-1); } catch { /* egal */ }
  };
}

export const backDepth = () => stack.length;

// Android-App (Capacitor): Die WebView beendet die App bei „zurück“ von selbst, solange kein Plugin die Taste übernimmt.
// Mit dem Plugin „App“ schließen wir die oberste Ebene selbst und beenden die App erst, wenn keine mehr offen ist.
try {
  const cap = window.Capacitor, App = cap && cap.isNativePlatform && cap.isNativePlatform() && cap.Plugins && cap.Plugins.App;
  if (App && App.addListener) {
    App.addListener('backButton', () => {
      if (!stack.length) { App.exitApp(); return; }
      const e = stack.pop();
      try { e.fn(); } catch { /* egal */ }
      try { history.go(-1); } catch { /* egal */ } // den Verlaufseintrag der Ebene mit entfernen
    });
  }
} catch { /* ohne Plugin */ }

window.addEventListener('popstate', (ev) => {
  const d = (ev.state && ev.state.dp) || 0;
  while (stack.length > d) { const e = stack.pop(); try { e.fn(); } catch { /* egal */ } }
});
