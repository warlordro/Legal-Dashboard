export interface DesktopApi {
  encryptKeys: (plaintext: string) => Promise<string | null>;
  decryptKeys: (ciphertextB64: string) => Promise<string | null>;
  isEncryptionAvailable: () => Promise<boolean>;
}

declare global {
  interface Window {
    desktopApi?: DesktopApi;
  }
}

export {};
