import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { AI_MODELS, type AiMode, JUDGE_MODELS_LIST } from "@/components/dosare-ai-config";
import type { TenantKeys } from "@/hooks/useTenantKeyStatus";
import type { Dosar } from "@/types";

interface ApiKeys {
  anthropic: string;
  openai: string;
  google: string;
  openrouter: string;
}

// Marker de truthiness pentru cheile tenant (server-side). Nu paraseste
// niciodata clientul: in tenant mode body-ul NU contine apiKeys (bodyKeys
// devine undefined), sentinelul guverneaza doar disponibilitatea UI.
const TENANT_KEY_SENTINEL = "__tenant__";

interface MultiResultPayload {
  analyses: {
    analyst1: { model: string; text: string };
    analyst2: { model: string; text: string };
  };
  judge: { model: string; text: string };
  final: string;
}

type MultiPhase = "analyst1_done" | "analyst2_done" | "judge_started";

export interface AiBundle {
  analysis: Record<string, string>;
  loading: string | null;
  error: string | null;
  model: string;
  setModel: (model: string) => void;
  showKeyPrompt: boolean;
  hasAnyKey: boolean;
  availableModels: typeof AI_MODELS;
  availableJudgeModels: typeof AI_MODELS;
  providerGroups: Record<string, typeof AI_MODELS>;
  collapsed: Set<string>;
  toggleCollapsed: (key: string) => void;
  onAnalyze: (dosar: Dosar) => Promise<void>;
}

export interface MultiBundle {
  analysts: [string, string];
  setAnalysts: React.Dispatch<React.SetStateAction<[string, string]>>;
  judge: string;
  setJudge: (model: string) => void;
  loading: string | null;
  phase: Set<MultiPhase> | undefined;
  result: Record<string, MultiResultPayload>;
  error: string | null;
  showIndividual: Set<string>;
  toggleIndividual: (numar: string) => void;
  onAnalyze: (dosar: Dosar) => Promise<void>;
}

export interface UseDosareAiArgs {
  apiKeys: ApiKeys | undefined;
  aiSettings: { mode: AiMode };
  // Starea cheilor tenant (web mode). Optional pentru compatibilitate cu
  // call-site-uri desktop-only; absenta = comportament BYOK istoric.
  tenantKeys?: TenantKeys;
}

export interface UseDosareAiResult {
  ai: AiBundle;
  // Multi bundle is per-row because `phase` is keyed by dosar.numar. The
  // caller passes `dosar.numar` for the row being rendered.
  multiForRow: (numar: string) => MultiBundle;
}

export function useDosareAi({ apiKeys, aiSettings, tenantKeys }: UseDosareAiArgs): UseDosareAiResult {
  // BYOK = desktop Electron sau dev "browser + backend desktop-auth": cheile
  // locale guverneaza si se trimit in body. In tenant mode (server a confirmat
  // auth_mode=web) disponibilitatea vine din /me/key-status, iar body-ul nu
  // contine chei (backend-ul le rezolva singur; chei in body => 501).
  const byokMode =
    !tenantKeys ||
    tenantKeys.status.state === "desktop" ||
    (tenantKeys.status.state === "ready" && !tenantKeys.tenantMode);

  // Guverneaza DOAR disponibilitatea UI (hasAnyKey + listele de modele).
  // Pe loading/error in browser: fail-open — toate modelele raman selectabile,
  // backend-ul e sursa de adevar si intoarce el eroarea corecta.
  const effectiveKeys: ApiKeys | undefined = useMemo(() => {
    if (byokMode) return apiKeys;
    if (tenantKeys && tenantKeys.status.state === "ready") {
      const cfg = tenantKeys.status.configured;
      return {
        anthropic: cfg.anthropic ? TENANT_KEY_SENTINEL : "",
        openai: cfg.openai ? TENANT_KEY_SENTINEL : "",
        google: cfg.google ? TENANT_KEY_SENTINEL : "",
        openrouter: cfg.openrouter ? TENANT_KEY_SENTINEL : "",
      };
    }
    return {
      anthropic: TENANT_KEY_SENTINEL,
      openai: TENANT_KEY_SENTINEL,
      google: TENANT_KEY_SENTINEL,
      openrouter: TENANT_KEY_SENTINEL,
    };
  }, [byokMode, apiKeys, tenantKeys]);

  // Body-ul primeste chei doar pe calea BYOK reala.
  const bodyKeys = byokMode ? apiKeys : undefined;

  const [aiAnalysis, setAiAnalysis] = useState<Record<string, string>>({});
  const [aiLoading, setAiLoading] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiModel, setAiModel] = useState<string>("claude-sonnet");
  const [showKeyPrompt, setShowKeyPrompt] = useState(false);
  const [collapsedAiConfig, setCollapsedAiConfig] = useState<Set<string>>(new Set());

  const [multiAnalysts, setMultiAnalysts] = useState<[string, string]>(["claude-sonnet", "gpt-5.4-mini"]);
  const [multiJudge, setMultiJudge] = useState<string>("claude-opus");
  const [multiLoading, setMultiLoading] = useState<string | null>(null);
  const [multiResult, setMultiResult] = useState<Record<string, MultiResultPayload>>({});
  const [multiError, setMultiError] = useState<string | null>(null);
  const [multiPhase, setMultiPhase] = useState<Record<string, Set<MultiPhase>>>({});
  const [showIndividual, setShowIndividual] = useState<Set<string>>(new Set());

  const hasAnyKey =
    aiSettings.mode === "openrouter"
      ? Boolean(effectiveKeys?.openrouter)
      : Boolean(effectiveKeys && (effectiveKeys.anthropic || effectiveKeys.openai || effectiveKeys.google));

  const stackModels = AI_MODELS;
  const stackJudgeModels = JUDGE_MODELS_LIST;

  const availableModels = useMemo(
    () =>
      aiSettings.mode === "openrouter"
        ? effectiveKeys?.openrouter
          ? stackModels
          : []
        : stackModels.filter((m) => {
            if (m.provider === "anthropic") return effectiveKeys?.anthropic;
            if (m.provider === "openai") return effectiveKeys?.openai;
            if (m.provider === "google") return effectiveKeys?.google;
            return false;
          }),
    [
      aiSettings.mode,
      effectiveKeys?.anthropic,
      effectiveKeys?.openai,
      effectiveKeys?.google,
      effectiveKeys?.openrouter,
      stackModels,
    ]
  );

  const availableJudgeModels = useMemo(
    () =>
      aiSettings.mode === "openrouter"
        ? effectiveKeys?.openrouter
          ? stackJudgeModels
          : []
        : stackJudgeModels.filter((m) => {
            if (m.provider === "anthropic") return effectiveKeys?.anthropic;
            if (m.provider === "openai") return effectiveKeys?.openai;
            if (m.provider === "google") return effectiveKeys?.google;
            return false;
          }),
    [
      aiSettings.mode,
      effectiveKeys?.anthropic,
      effectiveKeys?.openai,
      effectiveKeys?.google,
      effectiveKeys?.openrouter,
      stackJudgeModels,
    ]
  );

  const providerGroups = useMemo(
    () =>
      availableModels.reduce(
        (acc, m) => {
          if (!acc[m.provider]) acc[m.provider] = [];
          acc[m.provider].push(m);
          return acc;
        },
        {} as Record<string, typeof AI_MODELS>
      ),
    [availableModels]
  );

  // Sync model selections when available models change (e.g. user removes a key).
  // Keeps aiModel + multiAnalysts + multiJudge pointing at currently-usable models
  // so the AI panel never offers a model whose provider key is missing.
  useEffect(() => {
    if (availableModels.length > 0 && !availableModels.some((model) => model.key === aiModel)) {
      setAiModel(availableModels[0].key);
    }
    if (availableModels.length >= 2) {
      setMultiAnalysts((prev) => {
        const [first, second] = prev;
        const firstOk = availableModels.some((model) => model.key === first);
        const secondOk = availableModels.some((model) => model.key === second);
        if (firstOk && secondOk && first !== second) return prev;
        return [availableModels[0].key, availableModels[1].key];
      });
    }
    if (availableJudgeModels.length > 0 && !availableJudgeModels.some((model) => model.key === multiJudge)) {
      setMultiJudge(availableJudgeModels[0].key);
    }
  }, [aiModel, availableModels, availableJudgeModels, multiJudge]);

  const toggleCollapsed = useCallback((key: string) => {
    setCollapsedAiConfig((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleIndividual = useCallback((numar: string) => {
    setShowIndividual((prev) => {
      const next = new Set(prev);
      if (next.has(numar)) next.delete(numar);
      else next.add(numar);
      return next;
    });
  }, []);

  const handleAiAnalyze = useCallback(
    async (dosar: Dosar) => {
      if (!hasAnyKey) {
        setShowKeyPrompt(true);
        return;
      }
      // Check if selected model's provider has a key
      const selectedModelDef = AI_MODELS.find((m) => m.key === aiModel);
      if (selectedModelDef && !availableModels.find((m) => m.key === aiModel)) {
        // Selected model's provider has no key — switch to first available + prompt
        if (availableModels.length > 0) {
          setAiModel(availableModels[0].key);
        }
        setShowKeyPrompt(true);
        return;
      }
      const key = dosar.numar;
      setAiLoading(key);
      setAiError(null);
      try {
        const result = await api.ai.analyze(dosar, aiModel, bodyKeys);
        setAiAnalysis((prev) => ({ ...prev, [key]: result.analysis }));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Eroare la analiza AI";
        if (msg.includes("401") || msg.includes("invalid") || msg.includes("authentication")) {
          setAiError("Cheie API invalida. Verifica setarile.");
        } else {
          setAiError(msg);
        }
      } finally {
        setAiLoading(null);
      }
    },
    [aiModel, bodyKeys, availableModels, hasAnyKey]
  );

  const handleMultiAnalyze = useCallback(
    async (dosar: Dosar) => {
      if (!hasAnyKey) {
        setShowKeyPrompt(true);
        return;
      }
      // In tenant mode mesajul indica adminul (userul nu are ce configura local).
      const missingKeySuffix = byokMode ? "" : " — contacteaza administratorul";
      if (aiSettings.mode === "openrouter") {
        if (!effectiveKeys?.openrouter) {
          setMultiError(`Lipseste cheia API pentru OpenRouter${missingKeySuffix}`);
          return;
        }
      } else {
        const neededProviders = new Set<string>();
        for (const m of [...multiAnalysts, multiJudge]) {
          const modelDef = AI_MODELS.find((mod) => mod.key === m);
          if (modelDef) neededProviders.add(modelDef.provider);
        }
        for (const provider of neededProviders) {
          if (provider === "anthropic" && !effectiveKeys?.anthropic) {
            setMultiError(`Lipseste cheia API pentru Anthropic (Claude)${missingKeySuffix}`);
            return;
          }
          if (provider === "openai" && !effectiveKeys?.openai) {
            setMultiError(`Lipseste cheia API pentru OpenAI (GPT)${missingKeySuffix}`);
            return;
          }
          if (provider === "google" && !effectiveKeys?.google) {
            setMultiError(`Lipseste cheia API pentru Google (Gemini)${missingKeySuffix}`);
            return;
          }
        }
      }
      setMultiLoading(dosar.numar);
      setMultiError(null);
      setMultiPhase((prev) => ({ ...prev, [dosar.numar]: new Set() }));
      try {
        const result = await api.ai.analyzeMulti(dosar, multiAnalysts, multiJudge, bodyKeys, (phase) => {
          setMultiPhase((prev) => {
            const next = new Set(prev[dosar.numar] ?? []);
            next.add(phase);
            return { ...prev, [dosar.numar]: next };
          });
        });
        setMultiResult((prev) => ({ ...prev, [dosar.numar]: result }));
      } catch (err: unknown) {
        setMultiError(err instanceof Error ? err.message : "Eroare la analiza avansata");
      } finally {
        setMultiLoading(null);
        setMultiPhase((prev) => {
          const { [dosar.numar]: _, ...rest } = prev;
          return rest;
        });
      }
    },
    [aiSettings.mode, byokMode, bodyKeys, effectiveKeys, hasAnyKey, multiAnalysts, multiJudge]
  );

  const multiForRow = useCallback(
    (numar: string): MultiBundle => ({
      analysts: multiAnalysts,
      setAnalysts: setMultiAnalysts,
      judge: multiJudge,
      setJudge: setMultiJudge,
      loading: multiLoading,
      phase: multiPhase[numar],
      result: multiResult,
      error: multiError,
      showIndividual,
      toggleIndividual,
      onAnalyze: handleMultiAnalyze,
    }),
    [
      handleMultiAnalyze,
      multiAnalysts,
      multiError,
      multiJudge,
      multiLoading,
      multiPhase,
      multiResult,
      showIndividual,
      toggleIndividual,
    ]
  );

  return {
    ai: {
      analysis: aiAnalysis,
      loading: aiLoading,
      error: aiError,
      model: aiModel,
      setModel: setAiModel,
      showKeyPrompt,
      hasAnyKey,
      availableModels,
      availableJudgeModels,
      providerGroups,
      collapsed: collapsedAiConfig,
      toggleCollapsed,
      onAnalyze: handleAiAnalyze,
    },
    multiForRow,
  };
}
