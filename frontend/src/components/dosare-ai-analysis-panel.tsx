import DOMPurify from "dompurify";
import { Bot, Check, ChevronDown, Circle, Download, Key, Loader2 } from "lucide-react";
import { Button } from "./ui/button";
import type { Dosar } from "@/types";
import { exportAnalysisPDF } from "@/lib/export";
import {
  AI_MODELS,
  JUDGE_MODELS_LIST,
  PROVIDER_LABELS,
  MULTI_AGENT_COLORS as mc,
  type AiModelDef,
} from "@/components/dosare-ai-config";

interface ApiKeys {
  anthropic: string;
  openai: string;
  google: string;
}

interface MultiResult {
  analyses: { analyst1: { model: string; text: string }; analyst2: { model: string; text: string } };
  judge: { model: string; text: string };
  final: string;
}

export interface DosareAiAnalysisPanelProps {
  dosar: Dosar;
  apiKeys?: ApiKeys;
  ai: {
    analysis: Record<string, string>;
    loading: string | null;
    error: string | null;
    model: string;
    setModel: (m: string) => void;
    showKeyPrompt: boolean;
    hasAnyKey: boolean;
    availableModels: AiModelDef[];
    providerGroups: Record<string, AiModelDef[]>;
    collapsed: Set<string>;
    toggleCollapsed: (key: string) => void;
    onAnalyze: (dosar: Dosar) => void;
  };
  multi: {
    analysts: [string, string];
    setAnalysts: (updater: (prev: [string, string]) => [string, string]) => void;
    judge: string;
    setJudge: (j: string) => void;
    loading: string | null;
    phase?: Set<"analyst1_done" | "analyst2_done" | "judge_started">;
    result: Record<string, MultiResult>;
    error: string | null;
    showIndividual: Set<string>;
    toggleIndividual: (numar: string) => void;
    onAnalyze: (dosar: Dosar) => void;
  };
}

export function DosareAiAnalysisPanel({ dosar, apiKeys, ai, multi }: DosareAiAnalysisPanelProps) {
  return (
    <>
      {/* Analiză AI - Collapsible per dosar */}
      <div className="rounded-lg border border-violet-200 dark:border-violet-800 bg-violet-50/30 dark:bg-violet-950/20">
        <button
          className="flex w-full items-center justify-between p-4 pb-2 cursor-pointer hover:bg-violet-100/50 dark:hover:bg-violet-900/20 rounded-t-lg transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            ai.toggleCollapsed(`ai-${dosar.numar}`);
          }}
        >
          <h4 className="flex items-center gap-1.5 text-sm font-semibold text-violet-700 dark:text-violet-400">
            <Bot className="h-3.5 w-3.5" /> Analiză AI
          </h4>
          <div className="flex items-center gap-1.5">
            {ai.analysis[dosar.numar] && (
              <button
                className="p-1 rounded hover:bg-violet-100 dark:hover:bg-violet-900/30 text-violet-500 hover:text-violet-700 dark:hover:text-violet-300 transition-colors"
                title="Exportă PDF"
                onClick={(e) => {
                  e.stopPropagation();
                  exportAnalysisPDF(dosar.numar, dosar.institutie, dosar.obiect, ai.analysis[dosar.numar]);
                }}
              >
                <Download className="h-3.5 w-3.5" />
              </button>
            )}
            <ChevronDown className={`h-4 w-4 text-violet-500 transition-transform ${ai.collapsed.has(`ai-${dosar.numar}`) ? "rotate-180" : ""}`} />
          </div>
        </button>
        {ai.collapsed.has(`ai-${dosar.numar}`) && (
          <div className="px-4 pb-4 space-y-3">
            {/* Model selectors */}
            {ai.availableModels.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {Object.entries(ai.providerGroups).map(([provider, models]) => {
                  const selectedInProvider = models.find((m) => m.key === ai.model);
                  const colorMap: Record<string, string> = {
                    violet: "bg-violet-600 text-white",
                    emerald: "bg-emerald-600 text-white",
                    blue: "bg-blue-600 text-white",
                  };
                  return (
                    <div key={provider} className="flex items-center gap-0.5 rounded-lg border border-border bg-background p-0.5">
                      <span className="px-1.5 text-[10px] font-semibold text-muted-foreground uppercase w-14">{PROVIDER_LABELS[provider]}</span>
                      {models.map((m) => (
                        <button
                          key={m.key}
                          onClick={(e) => { e.stopPropagation(); ai.setModel(m.key); }}
                          className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                            ai.model === m.key
                              ? `${colorMap[m.color]} shadow-sm`
                              : "text-muted-foreground hover:text-foreground hover:bg-muted"
                          }`}
                          title={m.desc}
                        >
                          {m.label}
                        </button>
                      ))}
                      {selectedInProvider && (
                        <span className="px-1.5 text-[10px] text-muted-foreground">{selectedInProvider.desc}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {/* Analyze button */}
            <Button
              variant="outline"
              size="sm"
              className="gap-2 border-violet-300 text-violet-700 hover:bg-violet-50 hover:text-violet-800 dark:border-violet-700 dark:text-violet-400 dark:hover:bg-violet-950"
              onClick={(e) => { e.stopPropagation(); ai.onAnalyze(dosar); }}
              disabled={ai.loading === dosar.numar}
            >
              {ai.loading === dosar.numar ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Bot className="h-4 w-4" />
              )}
              {ai.loading === dosar.numar ? "Se analizează..." : ai.analysis[dosar.numar] ? "Re-analizează" : "Analizează"}
            </Button>
            {ai.showKeyPrompt && !ai.hasAnyKey && (
              <p className="text-sm text-orange-600 dark:text-orange-400">
                <Key className="inline h-3.5 w-3.5 mr-1" />
                Configureaza cel putin o cheie API din <strong>Setari API</strong> (meniul din stanga) pentru a utiliza aceasta functie.
              </p>
            )}
            {ai.error && ai.loading === null && !ai.analysis[dosar.numar] && (
              <p className="text-sm text-destructive">{ai.error}</p>
            )}
            {ai.analysis[dosar.numar] && (
              <div className="prose prose-sm max-w-none text-sm leading-relaxed text-foreground dark:prose-invert [&_strong]:font-semibold [&_strong]:text-foreground [&_h1]:text-base [&_h1]:font-bold [&_h1]:mt-3 [&_h1]:mb-1 [&_h2]:text-sm [&_h2]:font-bold [&_h2]:mt-3 [&_h2]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 [&_p]:my-1.5 [&_ul]:my-1 [&_li]:my-0.5">
                {ai.analysis[dosar.numar].split("\n").map((line, li) => {
                  if (line.startsWith("## ")) return <h2 key={li}>{line.slice(3)}</h2>;
                  if (line.startsWith("### ")) return <h3 key={li}>{line.slice(4)}</h3>;
                  if (line.startsWith("**") && line.endsWith("**")) return <h3 key={li}>{line.slice(2, -2)}</h3>;
                  if (line.startsWith("- ") || line.startsWith("* ")) {
                    const content = line.slice(2);
                    return <div key={li} className="flex gap-2 ml-2"><span className="text-violet-500">•</span><span dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'), { ALLOWED_TAGS: ['strong', 'em', 'b', 'i'], ALLOWED_ATTR: [] }) }} /></div>;
                  }
                  if (line.match(/^\d+\.\s/)) {
                    const content = line.replace(/^\d+\.\s/, "");
                    const num = line.match(/^(\d+)\./)?.[1];
                    return <div key={li} className="flex gap-2 ml-2"><span className="font-semibold text-violet-600 dark:text-violet-400 min-w-[1.2em]">{num}.</span><span dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'), { ALLOWED_TAGS: ['strong', 'em', 'b', 'i'], ALLOWED_ATTR: [] }) }} /></div>;
                  }
                  if (line.trim() === "") return <div key={li} className="h-2" />;
                  return <p key={li} dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'), { ALLOWED_TAGS: ['strong', 'em', 'b', 'i'], ALLOWED_ATTR: [] }) }} />;
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Multi-Agent Analysis - Collapsible per dosar */}
      <div className={`mt-3 rounded-lg border ${mc.border} ${mc.bg}`}>
        <button
          className={`flex w-full items-center justify-between p-4 pb-2 cursor-pointer ${mc.hoverBg} rounded-t-lg transition-colors`}
          onClick={(e) => {
            e.stopPropagation();
            ai.toggleCollapsed(`multi-${dosar.numar}`);
          }}
        >
          <h4 className={`flex items-center gap-1.5 text-sm font-semibold ${mc.text}`}>
            <Bot className="h-3.5 w-3.5" /> Analiză AI Avansată
            <span className="text-[10px] font-normal text-muted-foreground">(multi-agent)</span>
          </h4>
          <div className="flex items-center gap-1.5">
            {multi.result[dosar.numar] && (
              <button
                className="p-1 rounded hover:bg-blue-100 dark:hover:bg-blue-900/30 text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
                title="Exportă PDF"
                onClick={(e) => {
                  e.stopPropagation();
                  const r = multi.result[dosar.numar];
                  exportAnalysisPDF(
                    dosar.numar, dosar.institutie, dosar.obiect,
                    r.final, "advanced",
                    JUDGE_MODELS_LIST.find((j) => j.key === r.judge.model)?.label || r.judge.model
                  );
                }}
              >
                <Download className="h-3.5 w-3.5" />
              </button>
            )}
            <ChevronDown className={`h-4 w-4 ${mc.chevron} transition-transform ${ai.collapsed.has(`multi-${dosar.numar}`) ? "rotate-180" : ""}`} />
          </div>
        </button>
        {ai.collapsed.has(`multi-${dosar.numar}`) && (
          <div className="px-4 pb-4 space-y-3">
            {/* Model selectors */}
            <div className="flex flex-col gap-1.5">
              {/* Analyst 1 */}
              <div className={`flex items-center gap-0.5 rounded-lg border ${mc.selectBorder} bg-background p-0.5`}>
                <span className={`px-1.5 text-[11px] font-medium ${mc.selectLabel} w-20`}>Analist 1</span>
                {ai.availableModels.map((m) => (
                  <button
                    key={m.key}
                    onClick={(e) => { e.stopPropagation(); multi.setAnalysts((prev) => [m.key, prev[1]]); }}
                    disabled={m.key === multi.analysts[1]}
                    className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                      multi.analysts[0] === m.key
                        ? mc.selectActive
                        : m.key === multi.analysts[1]
                          ? "text-muted-foreground/30 cursor-not-allowed"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
                {(() => { const sel = ai.availableModels.find((m) => m.key === multi.analysts[0]); return sel ? <span className="px-1.5 text-[10px] text-muted-foreground">{sel.desc}</span> : null; })()}
              </div>
              {/* Analyst 2 */}
              <div className={`flex items-center gap-0.5 rounded-lg border ${mc.selectBorder} bg-background p-0.5`}>
                <span className={`px-1.5 text-[11px] font-medium ${mc.selectLabel} w-20`}>Analist 2</span>
                {ai.availableModels.map((m) => (
                  <button
                    key={m.key}
                    onClick={(e) => { e.stopPropagation(); multi.setAnalysts((prev) => [prev[0], m.key]); }}
                    disabled={m.key === multi.analysts[0]}
                    className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                      multi.analysts[1] === m.key
                        ? mc.selectActive
                        : m.key === multi.analysts[0]
                          ? "text-muted-foreground/30 cursor-not-allowed"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
                {(() => { const sel = ai.availableModels.find((m) => m.key === multi.analysts[1]); return sel ? <span className="px-1.5 text-[10px] text-muted-foreground">{sel.desc}</span> : null; })()}
              </div>
              {/* Judge */}
              <div className={`flex items-center gap-0.5 rounded-lg border ${mc.selectBorder} bg-background p-0.5`}>
                <span className={`px-1.5 text-[11px] font-medium ${mc.selectLabel} w-20`}>Judecător</span>
                {JUDGE_MODELS_LIST.filter((j) => {
                  if (j.provider === "anthropic") return apiKeys?.anthropic;
                  if (j.provider === "openai") return apiKeys?.openai;
                  if (j.provider === "google") return apiKeys?.google;
                  return false;
                }).map((j) => (
                  <button
                    key={j.key}
                    onClick={(e) => { e.stopPropagation(); multi.setJudge(j.key); }}
                    className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                      multi.judge === j.key
                        ? mc.selectActive
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    }`}
                  >
                    {j.label}
                  </button>
                ))}
                {(() => { const sel = JUDGE_MODELS_LIST.find((j) => j.key === multi.judge); return sel ? <span className="px-1.5 text-[10px] text-muted-foreground">{sel.desc}</span> : null; })()}
              </div>
            </div>
            {/* Analyze button */}
            <Button
              variant="outline"
              size="sm"
              className={`gap-2 ${mc.btnBorder} ${mc.btnText} ${mc.btnHover}`}
              onClick={(e) => { e.stopPropagation(); multi.onAnalyze(dosar); }}
              disabled={multi.loading === dosar.numar}
            >
              {multi.loading === dosar.numar ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Bot className="h-4 w-4" />
              )}
              {multi.loading === dosar.numar ? "Se analizează..." : multi.result[dosar.numar] ? "Re-analizează" : "Analizează"}
            </Button>
            {multi.loading === dosar.numar && (() => {
              const phase = multi.phase ?? new Set<"analyst1_done" | "analyst2_done" | "judge_started">();
              const a1Done = phase.has("analyst1_done");
              const a2Done = phase.has("analyst2_done");
              const judgeStarted = phase.has("judge_started");
              const a1Label = AI_MODELS.find((m) => m.key === multi.analysts[0])?.label ?? multi.analysts[0];
              const a2Label = AI_MODELS.find((m) => m.key === multi.analysts[1])?.label ?? multi.analysts[1];
              const judgeLabel = AI_MODELS.find((m) => m.key === multi.judge)?.label ?? multi.judge;
              const Row = ({ done, active, label, role }: { done: boolean; active: boolean; label: string; role: string }) => (
                <div className={`flex items-center gap-2 text-xs ${done ? mc.text : active ? `${mc.text} animate-pulse` : "text-muted-foreground"}`}>
                  {done ? <Check className="h-3.5 w-3.5" /> : active ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Circle className="h-3.5 w-3.5" />}
                  <span>{role}: <span className="font-medium">{label}</span></span>
                </div>
              );
              return (
                <div className="space-y-1">
                  <Row done={a1Done} active={!a1Done} label={a1Label} role="Analist 1" />
                  <Row done={a2Done} active={!a2Done} label={a2Label} role="Analist 2" />
                  <Row done={false} active={judgeStarted} label={judgeLabel} role="Judecator" />
                </div>
              );
            })()}
            {multi.error && multi.loading === null && (
              <p className="text-sm text-destructive">{multi.error}</p>
            )}
            {multi.result[dosar.numar] && (
              <div className="space-y-3">
                {/* Final judge analysis */}
                <div className={`rounded-lg border ${mc.border} ${mc.bg}`}>
                  <div className="p-4 pb-2">
                    <h4 className={`flex items-center gap-1.5 text-sm font-semibold ${mc.text}`}>
                      <Bot className="h-3.5 w-3.5" /> Analiză AI Avansată (Judecător: {JUDGE_MODELS_LIST.find((j) => j.key === multi.result[dosar.numar].judge.model)?.label || multi.result[dosar.numar].judge.model})
                    </h4>
                  </div>
                  <div className="prose prose-sm max-w-none text-sm leading-relaxed text-foreground dark:prose-invert px-4 pb-4 [&_strong]:font-semibold [&_strong]:text-foreground [&_h2]:text-sm [&_h2]:font-bold [&_h2]:mt-3 [&_h2]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 [&_p]:my-1.5 [&_ul]:my-1 [&_li]:my-0.5">
                    {multi.result[dosar.numar].final.split("\n").map((line, li) => {
                      if (line.startsWith("## ")) return <h2 key={li}>{line.slice(3)}</h2>;
                      if (line.startsWith("### ")) return <h3 key={li}>{line.slice(4)}</h3>;
                      if (line.startsWith("**") && line.endsWith("**")) return <h3 key={li}>{line.slice(2, -2)}</h3>;
                      if (line.startsWith("- ") || line.startsWith("* ")) {
                        const content = line.slice(2);
                        return <div key={li} className="flex gap-2 ml-2"><span className={mc.bullet}>•</span><span dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'), { ALLOWED_TAGS: ['strong', 'em', 'b', 'i'], ALLOWED_ATTR: [] }) }} /></div>;
                      }
                      if (line.match(/^\d+\.\s/)) {
                        const content = line.replace(/^\d+\.\s/, "");
                        const num = line.match(/^(\d+)\./)?.[1];
                        return <div key={li} className="flex gap-2 ml-2"><span className={`font-semibold ${mc.num} min-w-[1.2em]`}>{num}.</span><span dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'), { ALLOWED_TAGS: ['strong', 'em', 'b', 'i'], ALLOWED_ATTR: [] }) }} /></div>;
                      }
                      if (line.trim() === "") return <div key={li} className="h-2" />;
                      return <p key={li} dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'), { ALLOWED_TAGS: ['strong', 'em', 'b', 'i'], ALLOWED_ATTR: [] }) }} />;
                    })}
                  </div>
                </div>
                {/* Toggle individual analyses */}
                <button
                  className={`text-xs ${mc.link} ${mc.linkHover} underline`}
                  onClick={(e) => {
                    e.stopPropagation();
                    multi.toggleIndividual(dosar.numar);
                  }}
                >
                  {multi.showIndividual.has(dosar.numar) ? "Ascunde analizele individuale" : "Vezi analizele individuale"}
                </button>
                {multi.showIndividual.has(dosar.numar) && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {[multi.result[dosar.numar].analyses.analyst1, multi.result[dosar.numar].analyses.analyst2].map((a, idx) => (
                      <div key={idx} className="rounded-lg border border-muted bg-muted/30 p-3">
                        <h5 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                          Analist {idx + 1}: {AI_MODELS.find((m) => m.key === a.model)?.label || a.model}
                        </h5>
                        <div className="prose prose-sm max-w-none text-xs leading-relaxed text-muted-foreground [&_strong]:font-semibold [&_strong]:text-foreground [&_p]:my-1 max-h-[400px] overflow-y-auto">
                          {a.text.split("\n").map((line, li) => {
                            if (line.startsWith("## ") || line.startsWith("### ") || (line.startsWith("**") && line.endsWith("**"))) return <h3 key={li} className="text-xs font-semibold mt-2 mb-0.5">{line.replace(/^#{2,3}\s|^\*\*|\*\*$/g, "")}</h3>;
                            if (line.startsWith("- ") || line.startsWith("* ")) return <div key={li} className="flex gap-1.5 ml-1"><span>•</span><span dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(line.slice(2).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'), { ALLOWED_TAGS: ['strong', 'em', 'b', 'i'], ALLOWED_ATTR: [] }) }} /></div>;
                            if (line.trim() === "") return <div key={li} className="h-1" />;
                            return <p key={li} dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'), { ALLOWED_TAGS: ['strong', 'em', 'b', 'i'], ALLOWED_ATTR: [] }) }} />;
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
