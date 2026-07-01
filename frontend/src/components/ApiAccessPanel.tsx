import { useEffect, useRef, useState } from "react";
import { Check, Copy, KeyRound, Trash2 } from "lucide-react";
import {
  type ApiTokenSummary,
  type CreateApiTokenInput,
  createApiToken,
  listApiTokens,
  revokeAllApiTokens,
  revokeApiToken,
} from "@/lib/apiTokensApi";

const SCOPES: Array<{ value: "dosare" | "iccj" | "rnpm"; label: string }> = [
  { value: "dosare", label: "Dosare + termene" },
  { value: "iccj", label: "ICCJ" },
  { value: "rnpm", label: "RNPM" },
];

// Sectiune "Acces API" — management Personal Access Tokens (doar web mode). Gate-uita
// de caller-ul din ApiKeyDialog (isWebRuntime()); desktop pastreaza BYOK in modalul existent.
export function ApiAccessPanel() {
  const [tokens, setTokens] = useState<ApiTokenSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadOk, setLoadOk] = useState(false); // ultima incarcare a reusit? (empty-state doar daca da)
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<Array<"dosare" | "iccj" | "rnpm">>([]);
  const [expiresInDays, setExpiresInDays] = useState<"" | "30" | "90" | "365">("");
  const [captchaCap, setCaptchaCap] = useState("");
  // Serializeaza mutatiile: cat o creare/revocare + refresh sunt in curs, butoanele sunt
  // dezactivate (busy = UI). busyRef = sursa SINCRONA de adevar pentru guard (state-ul React e
  // async, deci doua click-uri rapide ar putea trece de `if (busy)` inainte de re-render -> ref-ul
  // inchide cursa complet: previne double-create pe UI, CodeRabbit).
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setTokens(await listApiTokens());
      setLoadOk(true);
    } catch {
      setError("Nu am putut incarca tokenurile.");
      setLoadOk(false);
    } finally {
      setLoading(false);
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: incarca lista o singura data la montare.
  useEffect(() => {
    void refresh();
  }, []);

  function toggleScope(s: "dosare" | "iccj" | "rnpm") {
    setScopes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  async function submitCreate() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const body: CreateApiTokenInput = {
      name: name.trim(),
      scopes,
      captchaDailyCap: captchaCap.trim() === "" ? null : Number(captchaCap),
      expiresInDays: expiresInDays === "" ? null : (Number(expiresInDays) as 30 | 90 | 365),
    };
    try {
      const created = await createApiToken(body);
      setNewSecret(created.secret);
      setShowCreate(false);
      setName("");
      setScopes([]);
      setExpiresInDays("");
      setCaptchaCap("");
      await refresh();
    } catch {
      setError("Creare esuata. Verifica numele si scope-urile.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function onRevoke(id: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await revokeApiToken(id);
      await refresh();
    } catch {
      setError("Revocare esuata. Reincearca.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function onRevokeAll() {
    if (busyRef.current) return;
    if (
      !window.confirm("Revoci TOATE tokenurile? Actiunea e ireversibila si va rupe orice integrare care le foloseste.")
    ) {
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await revokeAllApiTokens();
      await refresh();
    } catch {
      setError("Revocare esuata. Reincearca.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function copySecret() {
    if (!newSecret) return;
    try {
      await navigator.clipboard.writeText(newSecret);
      setCopied(true);
    } catch {
      setError("Nu am putut copia in clipboard. Selecteaza si copiaza manual din campul de mai sus.");
    }
  }

  return (
    <div className="mb-4 rounded-lg border border-border p-3" data-testid="api-access-panel">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-medium">
          <KeyRound className="h-4 w-4" /> Acces API (token-uri)
        </span>
        <div className="flex items-center gap-2">
          {tokens.length > 0 && (
            <button
              type="button"
              onClick={onRevokeAll}
              disabled={busy}
              className="rounded-md border border-border px-2 py-1 text-[11px] text-red-600 hover:bg-muted disabled:opacity-50"
            >
              Revoca toate
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowCreate((v) => !v)}
            className="rounded-md bg-primary px-2 py-1 text-[11px] text-primary-foreground hover:opacity-90"
          >
            Creeaza token
          </button>
        </div>
      </div>

      {error && <p className="mb-2 text-[11px] text-red-600">{error}</p>}

      {newSecret && (
        <div className="mb-3 rounded-md border border-amber-400 bg-amber-50 p-2 text-[12px]">
          <p className="mb-1 font-medium">Copiaza tokenul acum — nu mai poate fi afisat.</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded bg-white px-2 py-1 font-mono text-[11px]">{newSecret}</code>
            <button
              type="button"
              onClick={copySecret}
              aria-label="Copiaza tokenul"
              className="rounded-md border border-border p-1 hover:bg-muted"
            >
              {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={() => {
                setNewSecret(null);
                setCopied(false);
              }}
              className="rounded-md border border-border px-2 py-1 text-[11px] hover:bg-muted"
            >
              Am copiat
            </button>
          </div>
        </div>
      )}

      {showCreate && (
        <div className="mb-3 space-y-2 rounded-md border border-border p-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nume token (ex. mcp-desktop)"
            aria-label="Nume token"
            className="w-full rounded-md border border-border px-2 py-1 text-sm"
          />
          <div className="flex flex-wrap gap-3">
            {SCOPES.map((s) => (
              <label key={s.value} className="flex items-center gap-1 text-[12px]">
                <input type="checkbox" checked={scopes.includes(s.value)} onChange={() => toggleScope(s.value)} />
                {s.label}
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <label className="flex items-center gap-1">
              Expira in
              <select
                value={expiresInDays}
                onChange={(e) => setExpiresInDays(e.target.value as "" | "30" | "90" | "365")}
                aria-label="Expirare"
                className="rounded-md border border-border px-1 py-0.5"
              >
                <option value="">fara</option>
                <option value="30">30 zile</option>
                <option value="90">90 zile</option>
                <option value="365">365 zile</option>
              </select>
            </label>
            <label className="flex items-center gap-1">
              Max captcha/zi
              <input
                value={captchaCap}
                onChange={(e) => setCaptchaCap(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder="fara"
                aria-label="Plafon captcha zilnic"
                inputMode="numeric"
                className="w-16 rounded-md border border-border px-1 py-0.5"
              />
            </label>
          </div>
          <button
            type="button"
            onClick={submitCreate}
            disabled={busy || name.trim() === "" || scopes.length === 0}
            className="rounded-md bg-primary px-3 py-1 text-[12px] text-primary-foreground disabled:opacity-50"
          >
            Creeaza
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-[12px] text-muted-foreground">Se incarca…</p>
      ) : !loadOk ? (
        // Load esuat: NU arata empty-state ("Niciun token") — ar fi inselator; mesajul de eroare
        // e afisat sus. (CodeRabbit)
        <p className="text-[12px] text-muted-foreground">Reincarca dialogul pentru a reincerca.</p>
      ) : tokens.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">Niciun token. Creeaza unul pentru acces programatic.</p>
      ) : (
        <ul className="space-y-1">
          {tokens.map((t) => (
            <li
              key={t.id}
              className="flex items-center justify-between rounded-md border border-border px-2 py-1 text-[12px]"
            >
              <div className="min-w-0">
                <span className="font-medium">{t.name}</span>{" "}
                <code className="font-mono text-[11px] text-muted-foreground">{t.tokenPrefix}…</code>
                <span className="ml-1 text-muted-foreground">[{t.scopes.join(", ")}]</span>
                {t.revokedAt && <span className="ml-1 text-red-600">revocat</span>}
                {t.lastUsedAt && (
                  <span className="ml-1 text-muted-foreground">
                    · ultima: {t.lastUsedIp ?? "?"} {new Date(t.lastUsedAt).toLocaleDateString()}
                  </span>
                )}
              </div>
              {!t.revokedAt && (
                <button
                  type="button"
                  onClick={() => onRevoke(t.id)}
                  disabled={busy}
                  aria-label={`Revoca ${t.name}`}
                  className="rounded-md border border-border p-1 text-red-600 hover:bg-muted disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
