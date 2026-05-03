export interface DesktopNotificationStatus {
  platform: string;
  supported: boolean;
  state: string;
  canNotify: boolean | null;
  reason: string;
}

export interface DesktopApi {
  encryptKeys: (plaintext: string) => Promise<string | null>;
  decryptKeys: (ciphertextB64: string) => Promise<string | null>;
  isEncryptionAvailable: () => Promise<boolean>;
  setWindowTheme: (theme: "light" | "dark" | "system") => Promise<void>;
  getNotificationStatus?: () => Promise<DesktopNotificationStatus>;
  showTestNotification?: () => Promise<boolean>;
  showNotification: (payload: { title: string; body?: string; silent?: boolean; tag?: string }) => Promise<boolean>;
}

declare global {
  interface Window {
    desktopApi?: DesktopApi;
  }
}

export {};
