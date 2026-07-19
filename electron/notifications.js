// Native notifications module — split out of main.js (MIN-VIABLE seam) so the
// notification surface (capability detection + show + tag-dedup map + IPC
// handlers) lives in one place rather than as ~150 lines of inline state in
// the bootstrap file.
//
// Public surface:
//   getNotificationStatus()        — capability snapshot for UI status panels.
//   showNativeNotification(p)      — programmatic API; main.js still calls this
//                                    when the renderer wants a "test" toast.
//   registerNotificationIpc(ipc)   — wires the three notification:* channels.
//
// What stays out of scope (intentional, per MIN-VIABLE qualifier):
//   - safeStorage, theme, AUMID, single-instance, crash handlers — those
//     remain in main.js until a follow-up sweep proves the seam holds.

const { Notification } = require("electron");

// Native dep missing in dev: either Node could not resolve the JS package
// (MODULE_NOT_FOUND) or the package resolved but its .node file was never
// compiled, in which case `bindings` throws a plain Error whose message starts
// with "Could not locate the bindings file". Both cases mean the same thing
// for our diagnostic: optimistic-available, not a hard error.
function isMissingNativeNotificationDep(err) {
  if (!err) return false;
  if (err.code === "MODULE_NOT_FOUND") return true;
  const message = typeof err.message === "string" ? err.message : "";
  return /could not locate the bindings file/i.test(message);
}

const MAX_NOTIFICATION_TITLE = 120;
const MAX_NOTIFICATION_BODY = 500;
const MAX_NOTIFICATION_TAG = 200;
const MAX_NOTIFICATION_TAG_MAP = 100;
const WINDOWS_NOTIFICATION_ACCEPTS = "QUNS_ACCEPTS_NOTIFICATIONS";
const MACOS_NOTIFICATION_ACCEPTS = "SESSION_ON_CONSOLE_KEY";

// Manual cross-platform dedup for notifications. Electron's Notification has
// no stable `tag` field across platforms (libnotify uses tags, macOS/Windows
// use other dedup mechanisms), so we close the previous Notification with the
// same tag before showing the new one. Map insertion order is preserved,
// which gives us a free LRU-by-insertion eviction when capacity is exceeded.
const notificationsByTag = new Map();

function normalizeNotificationCapability(state, platform) {
  if (platform === "win32") {
    return {
      canNotify: state === WINDOWS_NOTIFICATION_ACCEPTS,
      reason:
        state === WINDOWS_NOTIFICATION_ACCEPTS
          ? "Windows accepta notificari pentru sesiunea curenta."
          : `Windows nu accepta notificari acum (${state}).`,
    };
  }
  if (platform === "darwin") {
    return {
      canNotify: state === MACOS_NOTIFICATION_ACCEPTS,
      reason:
        state === MACOS_NOTIFICATION_ACCEPTS
          ? "macOS accepta notificari pentru sesiunea curenta."
          : `macOS nu accepta notificari acum (${state}).`,
    };
  }
  return {
    canNotify: true,
    reason: "Platforma nu are verificare dedicata; se foloseste suportul Electron.",
  };
}

function getNotificationStatus() {
  const supported = typeof Notification.isSupported === "function" ? Notification.isSupported() : true;
  if (!supported) {
    return {
      platform: process.platform,
      supported,
      state: "unsupported",
      canNotify: false,
      reason: "Electron raporteaza ca notificarile native nu sunt suportate.",
    };
  }

  if (process.platform === "win32") {
    try {
      const { getNotificationState } = require("windows-notification-state");
      const state = getNotificationState();
      return {
        platform: process.platform,
        supported,
        state,
        ...normalizeNotificationCapability(state, process.platform),
      };
    } catch (err) {
      // Missing native dep in dev (either MODULE_NOT_FOUND on the JS package or
      // "Could not locate the bindings file" when the .node was never built
      // without Visual Studio C++ Build Tools) is treated as optimistic-available
      // — packaged installers always ship the prebuilt .node from CI. Genuine
      // runtime failures (module loaded but throws) keep the "unknown" status.
      if (isMissingNativeNotificationDep(err)) {
        return {
          platform: process.platform,
          supported,
          state: "available",
          canNotify: true,
          reason:
            "Notificarile native sunt disponibile prin Electron (status detaliat indisponibil in dev fara modulul nativ).",
        };
      }
      return {
        platform: process.platform,
        supported,
        state: "unknown",
        canNotify: null,
        reason: `Statusul Windows nu a putut fi citit: ${err?.message ? err.message : err}`,
      };
    }
  }

  if (process.platform === "darwin") {
    try {
      const { getNotificationState } = require("macos-notification-state");
      const state = getNotificationState();
      return {
        platform: process.platform,
        supported,
        state,
        ...normalizeNotificationCapability(state, process.platform),
      };
    } catch (err) {
      if (isMissingNativeNotificationDep(err)) {
        return {
          platform: process.platform,
          supported,
          state: "available",
          canNotify: true,
          reason:
            "Notificarile native sunt disponibile prin Electron (status detaliat indisponibil in dev fara modulul nativ).",
        };
      }
      return {
        platform: process.platform,
        supported,
        state: "unknown",
        canNotify: null,
        reason: `Statusul macOS nu a putut fi citit: ${err?.message ? err.message : err}`,
      };
    }
  }

  return {
    platform: process.platform,
    supported,
    state: "available",
    canNotify: true,
    reason: "Notificarile native sunt disponibile prin Electron.",
  };
}

function showNativeNotification(payload) {
  if (!payload || typeof payload !== "object") return false;
  const title = typeof payload.title === "string" ? payload.title.slice(0, MAX_NOTIFICATION_TITLE) : "";
  const body = typeof payload.body === "string" ? payload.body.slice(0, MAX_NOTIFICATION_BODY) : "";
  if (!title) return false;
  const status = getNotificationStatus();
  if (status.canNotify === false) {
    console.warn("[notification] native notification suppressed:", status.reason);
    return false;
  }
  // Defensive validation: drop tag silently if it's not a non-empty string of
  // bounded length. Same defensive style as title/body — never error, just
  // omit when malformed.
  const tag =
    typeof payload.tag === "string" && payload.tag.length >= 1 && payload.tag.length <= MAX_NOTIFICATION_TAG
      ? payload.tag
      : null;
  try {
    // Manual dedup: close any previous Notification carrying the same tag so
    // the OS does not stack duplicates when SSE replays the same alert after
    // a reconnect.
    if (tag && notificationsByTag.has(tag)) {
      const previous = notificationsByTag.get(tag);
      try {
        previous.close();
      } catch {
        /* already gone */
      }
      notificationsByTag.delete(tag);
    }

    const notification = new Notification({ title, body, silent: payload.silent === true });

    if (tag) {
      // Cap map size — eject oldest insertion if over capacity (Map preserves
      // insertion order).
      if (notificationsByTag.size >= MAX_NOTIFICATION_TAG_MAP) {
        const oldestTag = notificationsByTag.keys().next().value;
        if (oldestTag !== undefined) notificationsByTag.delete(oldestTag);
      }
      notificationsByTag.set(tag, notification);
      notification.on("close", () => {
        if (notificationsByTag.get(tag) === notification) notificationsByTag.delete(tag);
      });
    }

    notification.show();
    return true;
  } catch (e) {
    console.warn("[notification] show failed:", e?.message || e);
    return false;
  }
}

function registerNotificationIpc(ipcMain, isTrustedIpcSender) {
  if (typeof isTrustedIpcSender !== "function") {
    throw new Error("registerNotificationIpc necesita isTrustedIpcSender (fail-closed)");
  }
  const guard = isTrustedIpcSender;
  ipcMain.handle("notification:getStatus", (event) => (guard(event) ? getNotificationStatus() : null));

  ipcMain.handle("notification:test", (event) =>
    guard(event)
      ? showNativeNotification({
          title: "Legal Dashboard - notificari active",
          body: "Aceasta este o notificare de test pentru alertele de monitorizare.",
          tag: "legal-dashboard-notification-test",
        })
      : undefined
  );

  // notification:show is the renderer-driven path; identical contract to
  // showNativeNotification (same caps, same dedup, same status gate).
  ipcMain.handle("notification:show", (event, payload) => (guard(event) ? showNativeNotification(payload) : undefined));
}

module.exports = {
  getNotificationStatus,
  showNativeNotification,
  registerNotificationIpc,
};
