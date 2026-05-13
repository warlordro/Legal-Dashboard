// Toggle pentru forward la OS notifications, persistat in localStorage. Cand e
// OFF, useAlertsStream face early return inainte de showNotification, deci
// nimic nu se stocheaza/queue-uieste; la reactivare primesc doar alertele noi
// de la acel moment, nu un flood. Badge-ul si pagina Alerts nu sunt afectate.
// v2.22.x: persistenta adaugata — la restart Electron / reboot OS valoarea
// supravietuieste (anterior se reseta la true).

const STORAGE_KEY = "legaldashboard.alerts.notifications.enabled";

function readInitial(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === "false") return false;
    if (raw === "true") return true;
    return true;
  } catch {
    return true;
  }
}

let enabled = readInitial();
const listeners = new Set<(value: boolean) => void>();

export function getAlertsNotificationsEnabled(): boolean {
  return enabled;
}

export function setAlertsNotificationsEnabled(next: boolean): void {
  enabled = next;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? "true" : "false");
    } catch {
      // privacy mode / quota — toggle ramane in-memory pana la urmatorul restart
    }
  }
  for (const listener of listeners) listener(next);
}

export function subscribeAlertsNotificationsPref(listener: (value: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
