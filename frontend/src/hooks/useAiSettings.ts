import { useCallback, useEffect, useState } from "react";
import { apiFetch, extractErrorMessage } from "@/lib/api";
import type { AiMode, OpenRouterStack } from "@/components/dosare-ai-config";

export interface AiSettings {
  mode: AiMode;
  openrouter_stack: OpenRouterStack;
}

const DEFAULT_SETTINGS: AiSettings = { mode: "native", openrouter_stack: "western" };

function parseSettings(value: unknown): AiSettings {
  if (!value || typeof value !== "object") return DEFAULT_SETTINGS;
  const row = value as Partial<AiSettings>;
  return {
    mode: row.mode === "openrouter" ? "openrouter" : "native",
    openrouter_stack: row.openrouter_stack === "chinese" ? "chinese" : "western",
  };
}

export function useAiSettings() {
  const [settings, setSettings] = useState<AiSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch("/api/v1/ai/settings")
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(extractErrorMessage(json, "Nu am putut incarca setarile AI."));
        if (!cancelled) setSettings(parseSettings(json));
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Nu am putut incarca setarile AI.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback(async (next: AiSettings) => {
    setSettings(next);
    setError(null);
    const res = await apiFetch("/api/v1/ai/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
    const json = await res.json();
    if (!res.ok) {
      const message = extractErrorMessage(json, "Nu am putut salva setarile AI.");
      setError(message);
      throw new Error(message);
    }
    setSettings(parseSettings(json));
  }, []);

  const setMode = useCallback(
    (mode: AiMode) => {
      persist({ ...settings, mode }).catch(() => {});
    },
    [persist, settings]
  );

  const setStack = useCallback(
    (openrouter_stack: OpenRouterStack) => {
      persist({ ...settings, openrouter_stack }).catch(() => {});
    },
    [persist, settings]
  );

  return {
    settings,
    mode: settings.mode,
    stack: settings.openrouter_stack,
    setMode,
    setStack,
    loading,
    error,
  };
}
