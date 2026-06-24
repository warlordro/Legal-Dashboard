// SSE alerts stream + unread counter — extracted from App.tsx (Stage 9). The
// AppShell component had ~130 LOC of EventSource plumbing inline (refs,
// reconnect backoff, `alert` / `alert_enriched` handlers, desktop-notification
// gating, server-truth unread refresh). Lifting it into a dedicated hook
// shrinks AppShell substantially and lets the alerts logic live next to its
// only consumer (the navigation chrome) without crowding the rendering code.

import { useCallback, useEffect, useRef, useState } from "react";
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
