export type AuthMode = "desktop" | "web";

export function useAuthMode(): AuthMode {
  return typeof window !== "undefined" && window.desktopApi !== undefined ? "desktop" : "web";
}
