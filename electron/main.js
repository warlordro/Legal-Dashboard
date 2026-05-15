const {
  app,
  BrowserWindow,
  session,
  Menu,
  screen,
  dialog,
  ipcMain,
  safeStorage,
  nativeTheme,
  shell,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const pkg = require(path.join(__dirname, "..", "package.json"));
const { getNotificationStatus, showNativeNotification, registerNotificationIpc } = require(
  path.join(__dirname, "notifications.js")
);
const APP_USER_MODEL_ID = app.isPackaged ? "ro.legaldashboard.app" : "ro.legaldashboard.dev";

// Windows: setAppUserModelId must run before any window/notification is shown
// so the OS associates this process with the correct app identity. Without it,
// the taskbar shows the default Electron atom icon and native notifications
// are attributed to "electron.app.Electron". Must match the appId in
// electron-builder config (build.appId in package.json) for the packaged
// install to inherit the same shortcut grouping.
if (process.platform === "win32") {
  app.setAppUserModelId(APP_USER_MODEL_ID);
}

// SECURITY: single-instance lock — prevents concurrent SQLite writers from corrupting the DB
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// WORKAROUND v2.22.1: opt-in software rendering pentru cazurile in care driver-ul GPU
// e instabil (de ex. dupa un Windows Update force-reboot care lasa driver-ul intr-o
// stare proasta). Renderer-ul cade in software compositing — mai lent dar nu mai
// pierde GPU process si ecranul nu mai devine negru. Activare prin env var:
//   LEGAL_DASHBOARD_DISABLE_GPU=1
// Lasat opt-in pentru a nu penaliza setup-urile sanatoase.
if (process.env.LEGAL_DASHBOARD_DISABLE_GPU === "1") {
  app.disableHardwareAcceleration();
}

// CP-E1: main process crash handlers. Log the failure; show a dialog + quit only for
// truly unrecoverable errors. Benign IO errors (broken stdout pipe, closed stream) are
// logged and ignored — showing a dialog + quitting on those would be a regression.
const NON_FATAL_CODES = new Set(["EPIPE", "EIO", "ECONNRESET", "ECONNABORTED"]);
process.on("uncaughtException", (err) => {
  const code = err?.code;
  if (code && NON_FATAL_CODES.has(code)) {
    console.warn(`[main] non-fatal ${code}:`, err.message || err);
    return;
  }
  console.error("[main] uncaughtException:", err);
  try {
    dialog.showErrorBox(
      "Eroare neasteptata Legal Dashboard",
      `Aplicatia a intampinat o eroare si se va inchide:\n\n${err?.message ? err.message : err}`
    );
  } catch {
    /* dialog may not be ready; log only */
  }
  app.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("[main] unhandledRejection:", reason);
});

// CP-E1: drain the backend (scheduler + SQLite WAL) before Electron tears the
// process down. The shutdown hook is async (it `await`s scheduler.stop()
// which in turn aborts in-flight SOAP runners and waits for them to finalize
// their run rows), so we preventDefault the first quit, run the drain, then
// re-issue app.quit(). The `backendShutdownStarted` flag short-circuits the
// recursive before-quit fired by the second app.quit().
//
// 5s hard cap so a wedged socket can never hang the user's quit indefinitely;
// scheduler.stop() already propagates AbortSignal into fetch, so reaching the
// timeout would indicate a runner that swallowed cancellation — log and force.
let backendShutdownStarted = false;
const BACKEND_SHUTDOWN_TIMEOUT_MS = 5000;
app.on("before-quit", (event) => {
  const shutdown = globalThis.__legalDashboardShutdown;
  if (typeof shutdown !== "function") return;
  if (backendShutdownStarted) return;

  backendShutdownStarted = true;
  event.preventDefault();
  console.log("[main] before-quit: draining backend (scheduler + DB)...");

  let timedOut = false;
  const timeout = new Promise((resolve) =>
    setTimeout(() => {
      timedOut = true;
      resolve("timeout");
    }, BACKEND_SHUTDOWN_TIMEOUT_MS)
  );

  const drain = Promise.resolve()
    .then(() => shutdown())
    .then(() => "ok")
    .catch((e) => {
      console.error("[main] backend shutdown failed:", e);
      return "error";
    });

  Promise.race([drain, timeout]).finally(() => {
    if (timedOut) {
      console.warn(`[main] backend shutdown exceeded ${BACKEND_SHUTDOWN_TIMEOUT_MS}ms — forcing quit`);
    } else {
      console.log("[main] before-quit: backend drained, continuing quit");
    }
    app.quit();
  });
});

let mainWindow;
let backendStarted = false;

const IS_DEV = process.env.NODE_ENV !== "production";

function buildAppMenu() {
  const isDev = IS_DEV;

  const template = [
    {
      label: "Fisier",
      submenu: [
        {
          label: "Reincarca",
          accelerator: "CmdOrCtrl+R",
          click: () => mainWindow?.webContents.reload(),
        },
        {
          label: "Printeaza...",
          accelerator: "CmdOrCtrl+P",
          click: () => mainWindow?.webContents.print(),
        },
        { type: "separator" },
        { role: "quit", label: "Iesire" },
      ],
    },
    {
      label: "Editare",
      submenu: [
        { role: "copy", label: "Copiaza" },
        { role: "paste", label: "Lipeste" },
        { role: "selectAll", label: "Selecteaza tot" },
      ],
    },
    {
      label: "Vizualizare",
      submenu: [
        { role: "zoomIn", label: "Mareste" },
        { role: "zoomOut", label: "Micsoreaza" },
        { role: "resetZoom", label: "Resetare zoom" },
        { type: "separator" },
        { role: "togglefullscreen", label: "Ecran complet" },
        ...(isDev ? [{ type: "separator" }, { role: "toggleDevTools", label: "Instrumente dezvoltator" }] : []),
      ],
    },
    {
      label: "Fereastra",
      submenu: [
        { role: "minimize", label: "Minimizeaza" },
        { role: "close", label: "Inchide fereastra" },
      ],
    },
    {
      label: "Ajutor",
      submenu: [
        {
          label: "Despre Legal Dashboard",
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: "info",
              title: "Despre Legal Dashboard",
              message: "Legal Dashboard",
              detail: `Versiune: ${pkg.version}\nElectron: ${process.versions.electron}\nChromium: ${process.versions.chrome}\nNode: ${process.versions.node}`,
              buttons: ["OK"],
            });
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const STARTUP_TIMEOUT_MS = 30000; // hard ceiling for /health to confirm backend is up
const HEALTH_POLL_INTERVAL_MS = 200;
const HEALTH_POLL_INITIAL_DELAY_MS = 300;
const BACKEND_PORT = Number(process.env.LEGAL_DASHBOARD_PORT) || 3002;
process.env.LEGAL_DASHBOARD_PORT = String(BACKEND_PORT);
const APP_ICON_PATH = path.join(__dirname, "..", "build", process.platform === "darwin" ? "icon-1024.png" : "icon.ico");

// Dynamic window sizing based on monitor work area (no zoom — OS DPI scaling handles that)
function getWindowSize() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  // Window: 85% of work area width, 90% of height, capped at reasonable maximums
  const winWidth = Math.min(Math.round(width * 0.85), 1800);
  const winHeight = Math.min(Math.round(height * 0.9), 1100);

  return {
    width: Math.max(winWidth, 900),
    height: Math.max(winHeight, 600),
  };
}

function startBackend() {
  if (backendStarted) return Promise.resolve();
  process.env.NODE_ENV = "production";
  process.env.LEGAL_DASHBOARD_DB_PATH = path.join(app.getPath("userData"), "legal-dashboard.db");
  // PR-3 monitoring routes — desktop default ON (PR-4 flips this in upstream too).
  // Override with MONITORING_ENABLED=0 in env if needed.
  if (process.env.MONITORING_ENABLED === undefined) {
    process.env.MONITORING_ENABLED = "1";
  }

  try {
    require(path.join(__dirname, "..", "dist-backend", "index.cjs"));
  } catch (err) {
    return Promise.reject(new Error(`Initializare backend esuata: ${err?.message ? err.message : err}`));
  }

  return new Promise((resolve, reject) => {
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;

    const fail = (err) => {
      reject(
        new Error(
          `Backend nu raspunde dupa ${STARTUP_TIMEOUT_MS / 1000}s. Ultima eroare: ${err?.message ? err.message : err}`
        )
      );
    };

    const check = () => {
      fetch(`http://localhost:${BACKEND_PORT}/health`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((body) => {
          // SECURITY: Verify response identity to prevent port hijacking
          if (body && body.service === "Legal Dashboard API") {
            backendStarted = true;
            resolve();
          } else {
            schedule(new Error("Health response identity check failed"));
          }
        })
        .catch((err) => schedule(err));
    };

    const schedule = (err) => {
      if (Date.now() >= deadline) {
        fail(err);
        return;
      }
      setTimeout(check, HEALTH_POLL_INTERVAL_MS);
    };

    setTimeout(check, HEALTH_POLL_INITIAL_DELAY_MS);
  });
}

// SECURITY: IPC bridge for OS-keystore-backed API key storage. Renderer keeps the
// ciphertext in localStorage; the plaintext never touches disk and only lives in
// memory during encrypt/decrypt calls. Input sizes are capped to prevent abuse.
const MAX_PLAINTEXT = 8 * 1024;
const MAX_CIPHERTEXT_B64 = 16 * 1024;

function registerSafeStorageIpc() {
  ipcMain.handle("safeStorage:available", () => safeStorage.isEncryptionAvailable());

  ipcMain.handle("safeStorage:encrypt", (_event, plaintext) => {
    if (typeof plaintext !== "string" || plaintext.length > MAX_PLAINTEXT) return null;
    if (!safeStorage.isEncryptionAvailable()) return null;
    try {
      return safeStorage.encryptString(plaintext).toString("base64");
    } catch {
      return null;
    }
  });

  ipcMain.handle("safeStorage:decrypt", (_event, ciphertextB64) => {
    if (typeof ciphertextB64 !== "string" || ciphertextB64.length > MAX_CIPHERTEXT_B64) return null;
    if (!safeStorage.isEncryptionAvailable()) return null;
    try {
      return safeStorage.decryptString(Buffer.from(ciphertextB64, "base64"));
    } catch {
      return null;
    }
  });

  // Sync renderer theme toggle with the native Windows title bar overlay.
  // Without this, the custom title bar overlay stays frozen at its creation-time color.
  ipcMain.handle("window:setTheme", (_event, theme) => {
    if (theme !== "dark" && theme !== "light" && theme !== "system") return;
    nativeTheme.themeSource = theme;
    const effective = theme === "system" ? (nativeTheme.shouldUseDarkColors ? "dark" : "light") : theme;
    // Match Tailwind `bg-background` tokens: hsl(222 47% 7%) dark / hsl(210 20% 98%) light.
    const overlay =
      effective === "dark"
        ? { color: "#090E1A", symbolColor: "#E5E7EB", height: 32 }
        : { color: "#F8FAFC", symbolColor: "#1E293B", height: 32 };
    try {
      mainWindow?.setTitleBarOverlay?.(overlay);
    } catch (e) {
      console.warn("[theme] setTitleBarOverlay failed:", e?.message || e);
    }
  });

  registerNotificationIpc(ipcMain);
}

function showStartupErrorAndQuit(err) {
  const message = err?.message ? err.message : String(err);
  dialog.showErrorBox(
    "Eroare pornire Legal Dashboard",
    `Aplicatia nu a putut porni:\n\n${message}\n\nVerificati daca portul ${BACKEND_PORT} este liber si baza de date este accesibila, apoi reporniti aplicatia.`
  );
  app.quit();
}

function createWindow() {
  const { width, height } = getWindowSize();

  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: 900,
    minHeight: 600,
    title: "Legal Dashboard",
    icon: APP_ICON_PATH,
    // Background matches Tailwind `bg-background` in dark mode (hsl(222 47% 7%) ~ #090E1A)
    // — removes the white flash before the renderer is ready.
    backgroundColor: "#090E1A",
    // Custom title bar overlay on Windows so the bar matches the navy content instead of
    // Win11's pure-black native dark title bar. Height tuned to standard 32px.
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#090E1A",
      symbolColor: "#E5E7EB",
      height: 32,
    },
    // Hide the native menu bar entirely (Alt still toggles it on demand).
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, "preload.js"),
      devTools: IS_DEV,
    },
  });
  // Windows can keep showing electron.exe's atom in dev launches unless the
  // native window icon is set explicitly after BrowserWindow creation too.
  if (process.platform === "win32") {
    try {
      mainWindow.setIcon(APP_ICON_PATH);
    } catch (err) {
      console.warn("[main] could not set taskbar icon:", err?.message ? err.message : err);
    }
  }
  mainWindow.setMenuBarVisibility(false);

  mainWindow.loadURL(`http://localhost:${BACKEND_PORT}`);

  // First-launch bootstrap: match PortalJust's default visual size (one Ctrl+- step ≈ 0.9x).
  // Only applies when the user has never customized zoom (current zoom = 0). After the user
  // presses Ctrl++/Ctrl+-, the persisted per-origin zoom takes precedence on next launches.
  mainWindow.webContents.once("did-finish-load", () => {
    if (mainWindow.webContents.getZoomLevel() === 0) {
      mainWindow.webContents.setZoomLevel(-0.5778829311823857);
    }
  });

  // DIAGNOSTIC v2.22.1: capturam console + crash events din renderer in stdout-ul main
  // process. Cand renderer-ul moare (ecran negru), DOM-ul nu mai apuca sa afiseze banner-ul
  // de eroare, dar log-urile lui ajung deja la main inainte de crash.
  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    const tag = level === 3 ? "ERROR" : level === 2 ? "WARN" : "LOG";
    console.log(`[renderer:${tag}] ${message} (${sourceId}:${line})`);
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error(`[renderer] GONE reason=${details.reason} exitCode=${details.exitCode}`);
  });
  mainWindow.webContents.on("unresponsive", () => {
    console.error("[renderer] UNRESPONSIVE");
  });
  mainWindow.webContents.on("responsive", () => {
    console.log("[renderer] responsive again");
  });

  // SECURITY: Prevent navigation to external URLs.
  // Use strict URL parsing (NOT startsWith) — userinfo prefix like
  // `http://localhost:3002@attacker.example/` would otherwise pass a naive
  // prefix check while the parser resolves to attacker.example.
  mainWindow.webContents.on("will-navigate", (event, url) => {
    let allowed = false;
    try {
      const parsed = new URL(url);
      allowed =
        parsed.protocol === "http:" &&
        (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") &&
        parsed.port === String(BACKEND_PORT) &&
        parsed.username === "" &&
        parsed.password === "";
    } catch {
      allowed = false;
    }
    if (!allowed) {
      event.preventDefault();
    }
  });

  // SECURITY: Block new window creation (popups)
  const ALLOWED_EXTERNAL_DOMAINS = [
    "portal.just.ro",
    "www.just.ro",
    "portalquery.just.ro",
    "mj.rnpm.ro",
    "www.rnpm.ro",
  ];
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // SECURITY: Strict URL validation — exact domain whitelist, not suffix matching
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "https:" && ALLOWED_EXTERNAL_DOMAINS.includes(parsed.hostname)) {
        require("electron").shell.openExternal(url);
      }
    } catch {
      /* invalid URL, ignore */
    }
    return { action: "deny" };
  });

  // Right-click context menu with Copy, Select All, Print
  mainWindow.webContents.on("context-menu", (event, params) => {
    const menuItems = [];

    if (params.selectionText) {
      menuItems.push({
        label: "Copiaza",
        role: "copy",
      });
    }

    if (params.isEditable) {
      menuItems.push({
        label: "Lipeste",
        role: "paste",
      });
    }

    menuItems.push({
      label: "Selecteaza tot",
      role: "selectAll",
    });

    menuItems.push({ type: "separator" });

    menuItems.push({
      label: "Printeaza...",
      click: () => {
        mainWindow.webContents.print();
      },
    });

    const menu = Menu.buildFromTemplate(menuItems);
    menu.popup();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// Windows dev-mode taskbar icon fix. In packaged builds electron-builder creates
// a Start Menu shortcut with the right AUMID + icon, so the OS can resolve our
// AppUserModelId to the Legal Dashboard icon. In dev (`electron .`), there is
// no such shortcut, so the taskbar falls back to electron.exe's default atom
// icon even though setAppUserModelId() runs. Workaround: drop a per-user Start
// Menu shortcut on first dev launch with the same AUMID + icon — Windows then
// uses that shortcut's icon for any process that registers the same AUMID.
// Idempotent: rewritten when the existing shortcut points at a stale icon or
// project path, because Windows may otherwise keep resolving the AUMID to an
// old Electron shortcut.
function ensureDevTaskbarShortcut() {
  if (process.platform !== "win32") return;
  if (app.isPackaged) return;
  try {
    const startMenu = path.join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs");
    const shortcutPath = path.join(startMenu, "Legal Dashboard (Dev).lnk");
    fs.mkdirSync(startMenu, { recursive: true });
    const projectRoot = path.join(__dirname, "..");
    const shortcutDetails = {
      target: process.execPath,
      args: `"${projectRoot}"`,
      cwd: projectRoot,
      icon: APP_ICON_PATH,
      iconIndex: 0,
      description: "Legal Dashboard (development)",
      appUserModelId: APP_USER_MODEL_ID,
    };
    const operation = fs.existsSync(shortcutPath) ? "replace" : "create";
    shell.writeShortcutLink(shortcutPath, operation, shortcutDetails);
    console.log(`[main] dev taskbar icon shortcut ${operation}d at ${shortcutPath}`);
  } catch (err) {
    console.warn("[main] could not create dev taskbar shortcut:", err?.message ? err.message : err);
  }
}

app.whenReady().then(async () => {
  ensureDevTaskbarShortcut();

  // SECURITY: Set CSP header for all responses
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          `default-src 'self' http://localhost:${BACKEND_PORT}; script-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' http://localhost:${BACKEND_PORT}; img-src 'self' blob:; font-src 'self'; object-src 'none'; frame-ancestors 'none';`,
        ],
      },
    });
  });

  registerSafeStorageIpc();

  try {
    await startBackend();
    createWindow();
    buildAppMenu();
  } catch (err) {
    showStartupErrorAndQuit(err);
  }
});

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on("window-all-closed", () => {
  // Pe macOS, aplicatiile raman active pana la Cmd+Q explicit
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// macOS: re-creeaza fereastra cand se face click pe iconita din dock
app.on("activate", async () => {
  if (BrowserWindow.getAllWindows().length === 0 && app.isReady()) {
    try {
      await startBackend();
      createWindow();
      buildAppMenu();
    } catch (err) {
      showStartupErrorAndQuit(err);
    }
  }
});
