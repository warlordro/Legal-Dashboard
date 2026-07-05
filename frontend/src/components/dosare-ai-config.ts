export interface AiModelDef {
  key: string;
  label: string;
  provider: "anthropic" | "openai" | "google" | "openrouter";
  desc: string;
  color: string;
}

export type AiMode = "native" | "openrouter";

export const AI_MODELS: AiModelDef[] = [
  // Claude
  { key: "claude-haiku", label: "Haiku 4.5", provider: "anthropic", desc: "Rapid", color: "violet" },
  {
    key: "claude-sonnet",
    label: "Sonnet 5",
    provider: "anthropic",
    desc: "Echilibrat",
    color: "violet",
  },
  { key: "claude-opus", label: "Opus 4.8", provider: "anthropic", desc: "Premium", color: "violet" },
  // OpenAI
  { key: "gpt-5.4-nano", label: "5.4 nano", provider: "openai", desc: "Rapid", color: "emerald" },
  {
    key: "gpt-5.4-mini",
    label: "5.4 mini",
    provider: "openai",
    desc: "Echilibrat",
    color: "emerald",
  },
  { key: "gpt-5.4", label: "GPT-5.4", provider: "openai", desc: "Premium", color: "emerald" },
  // Google
  {
    key: "gemini-flash-lite-3",
    label: "3.1 Lite",
    provider: "google",
    desc: "Rapid",
    color: "blue",
  },
  { key: "gemini-flash-3.5", label: "3.5 Flash", provider: "google", desc: "Echilibrat", color: "blue" },
  { key: "gemini-pro-3", label: "3.1 Pro", provider: "google", desc: "Premium", color: "blue" },
];

export const JUDGE_MODELS_LIST: AiModelDef[] = [
  {
    key: "claude-opus",
    label: "Claude Opus 4.8",
    provider: "anthropic",
    color: "violet",
    desc: "Premium",
  },
  { key: "gpt-5.4", label: "GPT-5.4", provider: "openai", color: "emerald", desc: "Premium" },
  {
    key: "gemini-pro-3",
    label: "Gemini 3.1 Pro",
    provider: "google",
    color: "blue",
    desc: "Premium",
  },
];

export const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Claude",
  openai: "GPT",
  google: "Gemini",
  openrouter: "OpenRouter",
};

// Multi-agent panel color tokens (blue theme).
export const MULTI_AGENT_COLORS = {
  border: "border-blue-100 dark:border-blue-900",
  bg: "bg-blue-50/30 dark:bg-blue-950/20",
  hoverBg: "hover:bg-blue-50/50 dark:hover:bg-blue-950/30",
  text: "text-blue-700 dark:text-blue-400",
  chevron: "text-blue-400",
  btnBorder: "border-blue-200 dark:border-blue-800",
  btnText: "text-blue-700 dark:text-blue-400",
  btnHover: "hover:bg-blue-50 dark:hover:bg-blue-950",
  selectBorder: "border-blue-100 dark:border-blue-900",
  selectLabel: "text-blue-600",
  selectActive: "bg-blue-600 text-white shadow-sm",
  bullet: "text-blue-400",
  num: "text-blue-600 dark:text-blue-400",
  link: "text-blue-600 dark:text-blue-400",
  linkHover: "hover:text-blue-700 dark:hover:text-blue-300",
} as const;
