const { contextBridge, ipcRenderer } = require("electron");

// CP-E3: hard timeout on every IPC call so the renderer never hangs forever when the main
// process freezes (DPAPI stall, keychain prompt lockup, etc.). 10s is an eternity for
// safeStorage — real calls finish in <10ms — so the timeout only fires on pathological cases.
const IPC_TIMEOUT_MS = 10_000;
function invokeWithTimeout(channel, payload) {
  return Promise.race([
    ipcRenderer.invoke(channel, payload),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`IPC timeout (${channel}) after ${IPC_TIMEOUT_MS}ms`)), IPC_TIMEOUT_MS)
    ),
  ]);
}

// Exposed surface — keep narrow.
contextBridge.exposeInMainWorld("desktopApi", {
  encryptKeys: (plaintext) => invokeWithTimeout("safeStorage:encrypt", plaintext),
  decryptKeys: (ciphertextB64) => invokeWithTimeout("safeStorage:decrypt", ciphertextB64),
  isEncryptionAvailable: () => invokeWithTimeout("safeStorage:available"),
  setWindowTheme: (theme) => invokeWithTimeout("window:setTheme", theme),
});
