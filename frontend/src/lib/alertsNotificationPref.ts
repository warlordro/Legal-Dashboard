// In-memory toggle (session-scoped) pentru forward la OS notifications. NU
// persista — la restart revine la ON. Cand e OFF, useAlertsStream face early
// return inainte de showNotification, deci nimic nu se stocheaza/queue-uieste;
// la reactivare primesc doar alertele noi de la acel moment, nu un flood.
// Badge-ul si pagina Alerts nu sunt afectate.

let enabled = true;
const listeners = new Set<(value: boolean) => void>();

export function getAlertsNotificationsEnabled(): boolean {
  return enabled;
}

export function setAlertsNotificationsEnabled(next: boolean): void {
  enabled = next;
  for (const listener of listeners) listener(next);
}

export function subscribeAlertsNotificationsPref(
  listener: (value: boolean) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
