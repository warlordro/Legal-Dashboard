import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { AI_MODELS, type AiMode, JUDGE_MODELS_LIST } from "@/components/dosare-ai-config";
import { useTenantKeyStatus } from "@/hooks/useTenantKeyStatus";
import type { Dosar } from "@/types";

interface ApiKeys {
  anthropic: string;
  openai: string;
  google: string;
  openrouter: string;
}

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
}

export interface UseDosareAiResult {
  ai: AiBundle;
  // Multi bundle is per-row because `phase` is keyed by dosar.numar. The
  // caller passes `dosar.numar` for the row being rendered.
  multiForRow: (numar: string) => MultiBundle;
}

export function useDosareAi({ apiKeys, aiSettings }: UseDosareAiArgs): UseDosareAiResult {
  const [aiAnalysis, setAiAnalysis] = useState<Record<string, string>>({});
  const [aiLoading, setAiLoading] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiModel, setAiModel] = useState<string>("claude-sonnet");
  const [showKeyPrompt, setShowKeyPrompt] = useState(false);
  const [collapsedAiConfig, setCollapsedAiConfig] = useState<Set<string>>(new Set());

  const [multiAnalysts, setMultiAnalysts] = useState<[string, string]>(["claude-sonnet", "gpt-5.6-terra"]);
  const [multiJudge, setMultiJudge] = useState<string>("claude-opus");
  const [multiLoading, setMultiLoading] = useState<string | null>(null);
  const [multiResult, setMultiResult] = useState<Record<string, MultiResultPayload>>({});
  const [multiError, setMultiError] = useState<string | null>(null);
  const [multiPhase, setMultiPhase] = useState<Record<string, Set<MultiPhase>>>({});
  const [showIndividual, setShowIndividual] = useState<Set<string>>(new Set());

  const tenant = useTenantKeyStatus();
  // In web mode cheile sunt ale tenantului (server-side). BYOK din body doar pe
  // desktop; in web trimitem undefined si serverul rezolva cheile tenant.
  const byokMode = tenant.state.state === "desktop";
  const bodyKeys = byokMode ? apiKeys : undefined;

  // Prezenta unei chei per provider, dupa runtime:
  //   desktop  -> cheile locale BYOK
  //   web ready-> flag-urile tenant din /me/key-status
  //   web loading/error -> fail-open (true): nu blocam pe client, serverul
  //     respinge daca chiar lipseste cheia (politica fail-open din contract).
  const providerHasKey = useCallback(
    (provider: "anthropic" | "openai" | "google" | "openrouter"): boolean => {
      if (byokMode) return Boolean(apiKeys?.[provider]);
      if (tenant.state.state === "ready") return tenant.state.configured[provider];
      return true; // web loading/error -> fail-open
    },
    [byokMode, apiKeys, tenant.state]
  );

  const hasAnyKey =
    aiSettings.mode === "openrouter"
      ? providerHasKey("openrouter")
      : providerHasKey("anthropic") || providerHasKey("openai") || providerHasKey("google");

  const stackModels = AI_MODELS;
  const stackJudgeModels = JUDGE_MODELS_LIST;

  const availableModels = useMemo(
    () =>
      aiSettings.mode === "openrouter"
        ? providerHasKey("openrouter")
          ? stackModels
          : []
        : stackModels.filter((m) => {
            if (m.provider === "anthropic") return providerHasKey("anthropic");
            if (m.provider === "openai") return providerHasKey("openai");
            if (m.provider === "google") return providerHasKey("google");
            return false;
          }),
    [aiSettings.mode, providerHasKey, stackModels]
  );

  const availableJudgeModels = useMemo(
    () =>
      aiSettings.mode === "openrouter"
        ? providerHasKey("openrouter")
          ? stackJudgeModels
          : []
        : stackJudgeModels.filter((m) => {
            if (m.provider === "anthropic") return providerHasKey("anthropic");
            if (m.provider === "openai") return providerHasKey("openai");
            if (m.provider === "google") return providerHasKey("google");
            return false;
          }),
    [aiSettings.mode, providerHasKey, stackJudgeModels]
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
      if (aiSettings.mode === "openrouter") {
        if (!providerHasKey("openrouter")) {
          setMultiError("Lipseste cheia API pentru OpenRouter");
          return;
        }
      } else {
        const neededProviders = new Set<string>();
        for (const m of [...multiAnalysts, multiJudge]) {
          const modelDef = AI_MODELS.find((mod) => mod.key === m);
          if (modelDef) neededProviders.add(modelDef.provider);
        }
        for (const provider of neededProviders) {
          if (provider === "anthropic" && !providerHasKey("anthropic")) {
            setMultiError("Lipseste cheia API pentru Anthropic (Claude)");
            return;
          }
          if (provider === "openai" && !providerHasKey("openai")) {
            setMultiError("Lipseste cheia API pentru OpenAI (GPT)");
            return;
          }
          if (provider === "google" && !providerHasKey("google")) {
            setMultiError("Lipseste cheia API pentru Google (Gemini)");
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
    [aiSettings.mode, bodyKeys, providerHasKey, hasAnyKey, multiAnalysts, multiJudge]
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
