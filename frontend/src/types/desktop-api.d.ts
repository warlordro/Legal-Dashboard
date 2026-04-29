export interface DesktopApi {
  encryptKeys: (plaintext: string) => Promise<string | null>;
  decryptKeys: (ciphertextB64: string) => Promise<string | null>;
  isEncryptionAvailable: () => Promise<boolean>;
  setWindowTheme: (theme: "light" | "dark" | "system") => Promise<void>;
  showNotification: (payload: { title: string; body?: string; silent?: boolean }) => Promise<boolean>;
}

declare global {
  interface Window {
    desktopApi?: DesktopApi;
  }
}

export {};
