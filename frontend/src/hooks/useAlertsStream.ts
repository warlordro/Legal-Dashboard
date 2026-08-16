// SSE alerts stream + unread counter — extracted from App.tsx (Stage 9). The
// AppShell component had ~130 LOC of EventSource plumbing inline (refs,
// reconnect backoff, `alert` / `alert_enriched` handlers, desktop-notification
// gating, server-truth unread refresh). Lifting it into a dedicated hook
// shrinks AppShell substantially and lets the alerts logic live next to its
// only consumer (the navigation chrome) without crowding the rendering code.

import { useCallback, useEffect, useRef, useState } from "react";
import { ensureWebSession, isWebRuntime } from "@/lib/api";
import { alertsApi, type MonitoringAlert } from "@/lib/alertsApi";
import { getAlertsNotificationsEnabled } from "@/lib/alertsNotificationPref";
import type { DesktopNotificationStatus } from "@/types/desktop-api";

export interface UseAlertsStreamResult {
  unreadAlerts: number;
  streamVersion: number;
  refreshUnreadAlerts: () => Promise<void>;
}

export function buildAlertNotificationPayload(alert: MonitoringAlert) {
  return {
    title: "Legal Dashboard - alerta noua",
    body: alert.title.length > 120 ? `${alert.title.slice(0, 117)}...` : alert.title,
    silent: alert.severity === "info",
    tag: alert.dedup_key || `alert-${alert.id}`,
  };
}

export function notificationStatusAllowsNative(status: DesktopNotificationStatus | null): boolean {
  return status?.canNotify !== false;
}

export function useAlertsStream(): UseAlertsStreamResult {
  const reconnectTimerRef = useRef<number | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const notificationStatusRef = useRef<{ value: DesktopNotificationStatus | null; checkedAt: number } | null>(null);
  const [unreadAlerts, setUnreadAlerts] = useState(0);
  const [streamVersion, setStreamVersion] = useState(0);

  const refreshUnreadAlerts = useCallback(async () => {
    try {
      const result = await alertsApi.list({ page: 1, pageSize: 1, onlyUnread: true });
      setUnreadAlerts(result.unread);
    } catch (err) {
      console.warn("[alerts] unread count refresh failed", err);
    }
  }, []);

  const getDesktopNotificationStatus = useCallback(async () => {
    if (!window.desktopApi?.getNotificationStatus) return null;
    const cached = notificationStatusRef.current;
    if (cached && Date.now() - cached.checkedAt < 60_000) return cached.value;
    try {
      const value = await window.desktopApi.getNotificationStatus();
      notificationStatusRef.current = { value, checkedAt: Date.now() };
      return value;
    } catch (err) {
      console.warn("[alerts] native notification status failed", err);
      notificationStatusRef.current = { value: null, checkedAt: Date.now() };
      return null;
    }
  }, []);

  const showDesktopNotification = useCallback(
    async (alert: MonitoringAlert) => {
      // Per-user opt-out (Setari → Notificari sistem). In-app badge / Alerts page
      // raman intacte; doar popup-urile OS sunt suprimate.
      if (!getAlertsNotificationsEnabled()) return;
      // Suppress when the user is already looking at the app — the in-app badge
      // and Alerts page are sufficient. Covers both Electron and browser modes.
      if (typeof document !== "undefined" && document.visibilityState === "visible" && document.hasFocus()) {
        return;
      }
      const payload = buildAlertNotificationPayload(alert);
      if (window.desktopApi?.showNotification) {
        const status = await getDesktopNotificationStatus();
        if (!notificationStatusAllowsNative(status)) {
          console.warn("[alerts] native notification blocked", status?.reason || status?.state);
          return;
        }
        window.desktopApi
          .showNotification(payload)
          .catch((err) => console.warn("[alerts] native notification failed", err));
        return;
      }
      if (!("Notification" in window)) return;
      const notify = () => {
        try {
          new Notification(payload.title, {
            body: payload.body,
            tag: payload.tag,
            silent: payload.silent,
          });
        } catch (err) {
          console.warn("[alerts] desktop notification failed", err);
        }
      };
      if (Notification.permission === "granted") {
        notify();
        return;
      }
      if (Notification.permission === "default") {
        Notification.requestPermission()
          .then((permission) => {
            if (permission === "granted") notify();
          })
          .catch((err) => console.warn("[alerts] notification permission failed", err));
      }
    },
    [getDesktopNotificationStatus]
  );

  useEffect(() => {
    let stopped = false;
    let retryMs = 1000;

    const cleanupSource = () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };

    // A ajuns conexiunea curenta la `open`? Distinge cele doua feluri de moarte:
    // refuz de sesiune la handshake (nu s-a deschis niciodata) vs pana de retea
    // pe o conexiune care functiona. Doar prima justifica fortarea re-mintului.
    let openedSinceConnect = false;

    // EventSource nu trece prin apiFetch, deci nu are interceptorul de 401:
    // conectarea cu un cookie lipsa sau expirat lasa un `auth.denied` in audit si
    // nu se repara singura. ensureWebSession e ieftin cat timp cookie-ul pare
    // proaspat (nu emite request), deci il punem pe FIECARE conectare, inclusiv
    // pe prima. In desktop nu exista bridge -> conectam direct.
    //
    // `force` inchide gaura in care euristica de prospetime MINTE: ea e o
    // variabila per-tab, nu adevarul cookie-jar-ului, deci un cookie sters de un
    // logout in alt tab (sau invalidat de o rotatie de secret) o lasa pe
    // "proaspat". Fara fortare, apelul devine no-op si stream-ul reintra la
    // nesfarsit in acelasi refuz.
    //
    // LIMITA cunoscuta (review 2026-08-16): `force: false` nu garanteaza absenta
    // unui POST de sync. Daca prospetimea ramane NECUNOSCUTA — sync reusit din
    // care `expiresAt` n-a putut fi citit — apelul nefortat emite oricum cerere,
    // iar un ciclu `open` urmat imediat de eroare reseteaza backoff-ul la 1s si
    // poate repeta. Cu backend-ul actual scenariul nu se produce (`expiresAt` e
    // trimis mereu pe sync reusit), deci nu adaugam un cooldown separat aici; daca
    // acel camp devine vreodata optional, cazul trebuie retratat.
    //
    // Conectam DOAR pe rezultat "ok": inainte, `.finally()` deschidea stream-ul
    // si dupa un re-mint esuat, ceea ce garanta inca un 401. Pe orice alt
    // rezultat reprogramam — backoff-ul existent tine ritmul, iar ciclul nu se
    // poate opri definitiv.
    const connectWithSession = (force: boolean) => {
      if (stopped) return;
      if (!isWebRuntime()) {
        connect();
        return;
      }
      void ensureWebSession(force ? { force: true } : undefined)
        .then((result) => {
          if (stopped) return;
          if (result === "ok") connect();
          else scheduleReconnect();
        })
        .catch(() => {
          // ensureWebSession nu arunca azi, dar un listener din `emitSessionReminted`
          // poate respinge promisiunea. Fara acest catch, stream-ul ar ramane mort.
          if (!stopped) scheduleReconnect();
        });
    };

    const scheduleReconnect = () => {
      if (stopped || reconnectTimerRef.current !== null) return;
      const force = !openedSinceConnect;
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        connectWithSession(force);
      }, retryMs);
      retryMs = Math.min(retryMs * 2, 30000);
    };

    const connect = () => {
      cleanupSource();
      openedSinceConnect = false;
      const es = new EventSource("/api/v1/alerts/stream");
      eventSourceRef.current = es;
      es.addEventListener("open", () => {
        openedSinceConnect = true;
        retryMs = 1000;
        // Refresh server-truth counter and bump streamVersion so the Alerts
        // page re-fetches its visible list — covers any alerts dropped while
        // the SSE connection was disconnected.
        refreshUnreadAlerts();
        setStreamVersion((v) => v + 1);
      });
      es.addEventListener("alert", (event) => {
        try {
          const alert = JSON.parse((event as MessageEvent).data) as MonitoringAlert;
          if (!alert.read_at && !alert.dismissed_at) {
            showDesktopNotification(alert).catch((err) => console.warn("[alerts] native notification failed", err));
          }
          // Server-truth counter — avoids racing with optimistic increments.
          refreshUnreadAlerts();
          setStreamVersion((v) => v + 1);
        } catch (err) {
          console.warn("[alerts] invalid SSE event", err);
          refreshUnreadAlerts();
        }
      });
      // F7 — backend emits `alert_enriched` when the runner backfills
      // solutie_sumar / numar_document / instanta on an existing alert (the
      // PortalJust ruling text appears in a later tick than the alert itself).
      // Bumping streamVersion is enough: the Alerts page listens on it and
      // re-fetches the visible page, picking up the patched detail_json. We
      // intentionally do NOT trigger a desktop notification or unread refresh
      // — enrichment isn't a new alert and counters haven't moved.
      es.addEventListener("alert_enriched", () => {
        setStreamVersion((v) => v + 1);
      });
      es.onerror = () => {
        cleanupSource();
        scheduleReconnect();
      };
    };

    // Prima conectare nu forteaza: nu exista inca un handshake refuzat care sa
    // dovedeasca faptul ca euristica de prospetime minte.
    connectWithSession(false);
    return () => {
      stopped = true;
      cleanupSource();
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [refreshUnreadAlerts, showDesktopNotification]);

  return { unreadAlerts, streamVersion, refreshUnreadAlerts };
}
