const { contextBridge, ipcRenderer } = require("electron");

// Exposed surface — keep narrow. Renderer sees only these three methods.
contextBridge.exposeInMainWorld("desktopApi", {
  encryptKeys: (plaintext) => ipcRenderer.invoke("safeStorage:encrypt", plaintext),
  decryptKeys: (ciphertextB64) => ipcRenderer.invoke("safeStorage:decrypt", ciphertextB64),
  isEncryptionAvailable: () => ipcRenderer.invoke("safeStorage:available"),
});
