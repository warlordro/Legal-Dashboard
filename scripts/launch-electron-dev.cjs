const { copyFileSync, existsSync, readFileSync, statSync, writeFileSync } = require("fs");
const { dirname, join } = require("path");
const { spawn, spawnSync } = require("child_process");

const projectRoot = join(__dirname, "..");
const electronExe = require("electron");

function launch(exePath) {
  const env = { ...process.env };
  // biome-ignore lint/performance/noDelete: ELECTRON_RUN_AS_NODE trebuie unset real, nu valoare undefined.
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(exePath, [projectRoot], {
    cwd: projectRoot,
    env,
    stdio: "inherit",
    windowsHide: false,
  });
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
  });
}

if (process.platform !== "win32") {
  launch(electronExe);
  return;
}

const electronDir = dirname(electronExe);
const devExe = join(electronDir, "Legal Dashboard Dev.exe");
const iconPath = join(projectRoot, "build", "icon.ico");
const rceditExe = join(projectRoot, "node_modules", "electron-winstaller", "vendor", "rcedit.exe");
const stampPath = join(electronDir, "legal-dashboard-dev.stamp.json");
const stamp = {
  version: 1,
  electronMtimeMs: statSync(electronExe).mtimeMs,
  iconMtimeMs: statSync(iconPath).mtimeMs,
};

function readStamp() {
  try {
    return JSON.parse(readFileSync(stampPath, "utf8"));
  } catch {
    return null;
  }
}

function stampMatches(current) {
  return (
    current
    && current.version === stamp.version
    && current.electronMtimeMs === stamp.electronMtimeMs
    && current.iconMtimeMs === stamp.iconMtimeMs
  );
}

function writeDevShortcut() {
  const appData = process.env.APPDATA;
  if (!appData) return;
  const escapedRoot = projectRoot.replace(/'/g, "''");
  const escapedArgs = `"${projectRoot}"`.replace(/'/g, "''");
  const escapedExe = devExe.replace(/'/g, "''");
  const escapedIcon = iconPath.replace(/'/g, "''");
  const shortcutPath = join(
    appData,
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
    "Legal Dashboard (Dev).lnk",
  );
  const staleElectronShortcut = join(
    appData,
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
    "Electron.lnk",
  );
  const script = `
$ws = New-Object -ComObject WScript.Shell
$shortcut = $ws.CreateShortcut('${shortcutPath.replace(/'/g, "''")}')
$shortcut.TargetPath = '${escapedExe}'
$shortcut.Arguments = '${escapedArgs}'
$shortcut.WorkingDirectory = '${escapedRoot}'
$shortcut.IconLocation = '${escapedIcon},0'
$shortcut.Description = 'Legal Dashboard (development)'
$shortcut.Save()
$stale = '${staleElectronShortcut.replace(/'/g, "''")}'
if (Test-Path -LiteralPath $stale) {
  $old = $ws.CreateShortcut($stale)
  if ($old.TargetPath -eq '${electronExe.replace(/'/g, "''")}') {
    Remove-Item -LiteralPath $stale -Force
  }
}
`;
  spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    cwd: projectRoot,
    stdio: "inherit",
  });
}

if (!existsSync(devExe) || !stampMatches(readStamp())) {
  copyFileSync(electronExe, devExe);
  if (existsSync(rceditExe)) {
    const result = spawnSync(
      rceditExe,
      [
        devExe,
        "--set-icon",
        iconPath,
        "--set-version-string",
        "ProductName",
        "Legal Dashboard",
        "--set-version-string",
        "FileDescription",
        "Legal Dashboard",
        "--set-version-string",
        "InternalName",
        "Legal Dashboard Dev",
        "--set-version-string",
        "OriginalFilename",
        "Legal Dashboard Dev.exe",
      ],
      { cwd: projectRoot, stdio: "inherit" },
    );
    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }
  } else {
    console.warn("[electron:dev] rcedit.exe missing; taskbar may show the Electron icon.");
  }
  writeFileSync(stampPath, JSON.stringify(stamp, null, 2));
}

writeDevShortcut();
launch(devExe);
