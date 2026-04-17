const { app, BrowserWindow, session, Menu, screen, dialog } = require("electron");
const path = require("path");
const pkg = require(path.join(__dirname, "..", "package.json"));

let mainWindow;
let backendStarted = false;

function buildAppMenu() {
  const isDev = process.env.NODE_ENV !== "production" || process.argv.includes("--dev-tools");

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
        ...(isDev
          ? [
              { type: "separator" },
              { role: "toggleDevTools", label: "Instrumente dezvoltator" },
            ]
          : []),
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

  try {
    require(path.join(__dirname, "..", "dist-backend", "index.cjs"));
  } catch (err) {
    return Promise.reject(new Error(`Initializare backend esuata: ${err && err.message ? err.message : err}`));
  }

  return new Promise((resolve, reject) => {
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;

    const fail = (err) => {
      reject(new Error(`Backend nu raspunde dupa ${STARTUP_TIMEOUT_MS / 1000}s. Ultima eroare: ${err && err.message ? err.message : err}`));
    };

    const check = () => {
      fetch(`http://localhost:${BACKEND_PORT}/health`)
        .then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
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

function showStartupErrorAndQuit(err) {
  const message = err && err.message ? err.message : String(err);
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
    icon: path.join(__dirname, "..", "build", process.platform === "darwin" ? "icon-1024.png" : "icon.ico"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      enableRemoteModule: false,
      devTools: process.env.NODE_ENV !== "production" || process.argv.includes("--dev-tools"),
    },
  });

  mainWindow.loadURL(`http://localhost:${BACKEND_PORT}`);

  // First-launch bootstrap: match PortalJust's default visual size (one Ctrl+- step ≈ 0.9x).
  // Only applies when the user has never customized zoom (current zoom = 0). After the user
  // presses Ctrl++/Ctrl+-, the persisted per-origin zoom takes precedence on next launches.
  mainWindow.webContents.once("did-finish-load", () => {
    if (mainWindow.webContents.getZoomLevel() === 0) {
      mainWindow.webContents.setZoomLevel(-0.5778829311823857);
    }
  });

  // SECURITY: Prevent navigation to external URLs
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const allowed = url.startsWith(`http://localhost:${BACKEND_PORT}`) || url.startsWith(`http://127.0.0.1:${BACKEND_PORT}`);
    if (!allowed) {
      event.preventDefault();
    }
  });

  // SECURITY: Block new window creation (popups)
  const ALLOWED_EXTERNAL_DOMAINS = ["portal.just.ro", "www.just.ro", "portalquery.just.ro", "mj.rnpm.ro", "www.rnpm.ro"];
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // SECURITY: Strict URL validation — exact domain whitelist, not suffix matching
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "https:" && ALLOWED_EXTERNAL_DOMAINS.includes(parsed.hostname)) {
        require("electron").shell.openExternal(url);
      }
    } catch { /* invalid URL, ignore */ }
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

app.whenReady().then(async () => {
  // SECURITY: Set CSP header for all responses
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          `default-src 'self' http://localhost:${BACKEND_PORT}; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' http://localhost:${BACKEND_PORT}; img-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none';`
        ],
      },
    });
  });

  try {
    await startBackend();
    createWindow();
    buildAppMenu();
  } catch (err) {
    showStartupErrorAndQuit(err);
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
