// SSE alerts stream + unread counter — extracted from App.tsx (Stage 9). The
// AppShell component had ~130 LOC of EventSource plumbing inline (refs,
// reconnect backoff, `alert` / `alert_enriched` handlers, desktop-notification
// gating, server-truth unread refresh). Lifting it into a dedicated hook
// shrinks AppShell substantially and lets the alerts logic live next to its
// only consumer (the navigation chrome) without crowding the rendering code.

import { useCallback, useEffect, useRef, useState } from "react";
import { alertsApi, type MonitoringAlert } from "@/lib/alertsApi";

export interface UseAlertsStreamResult {
  unreadAlerts: number;
  streamVersion: number;
  refreshUnreadAlerts: () => Promise<void>;
}

export function useAlertsStream(): UseAlertsStreamResult {
  const reconnectTimerRef = useRef<number | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
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

  const showDesktopNotification = useCallback((alert: MonitoringAlert) => {
    // Suppress when the user is already looking at the app — the in-app badge
    // and Alerts page are sufficient. Covers both Electron and browser modes.
    if (typeof document !== "undefined"
      && document.visibilityState === "visible"
      && document.hasFocus()) {
      return;
    }
    const title = "Legal Dashboard - alerta noua";
    const body = alert.title.length > 120 ? `${alert.title.slice(0, 117)}...` : alert.title;
    const tag = alert.dedup_key || `alert-${alert.id}`;
    if (window.desktopApi?.showNotification) {
      window.desktopApi.showNotification({
        title,
        body,
        silent: alert.severity === "info",
        tag,
      }).catch((err) => console.warn("[alerts] native notification failed", err));
      return;
    }
    if (!("Notification" in window)) return;
    const notify = () => {
      try {
        new Notification(title, {
          body,
          tag,
          silent: alert.severity === "info",
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
      Notification.requestPermission().then((permission) => {
        if (permission === "granted") notify();
      }).catch((err) => console.warn("[alerts] notification permission failed", err));
    }
  }, []);

  useEffect(() => {
    let stopped = false;
    let retryMs = 1000;

    const cleanupSource = () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };

    const scheduleReconnect = () => {
      if (stopped || reconnectTimerRef.current !== null) return;
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        connect();
      }, retryMs);
      retryMs = Math.min(retryMs * 2, 30000);
    };

    const connect = () => {
      cleanupSource();
      const es = new EventSource("/api/v1/alerts/stream");
      eventSourceRef.current = es;
      es.addEventListener("open", () => {
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
            showDesktopNotification(alert);
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

    connect();
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
