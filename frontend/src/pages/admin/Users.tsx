import { useCallback, useEffect, useRef, useState } from "react";
import { Users as UsersIcon, Download, FileUp, RefreshCw, ShieldAlert, Search, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { SortableTh } from "@/components/ui/sortable-th";
import { TablePagination } from "@/components/table-pagination";
import { useClientSort } from "@/hooks/useClientSort";
import {
  admin,
  MonitoringApiError,
  triggerBlobDownload,
  type AdminUser,
  type ImportUsersResult,
  type UserImportIssue,
  type UserRole,
  type UserStatus,
} from "@/lib/api";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { formatIsoDateTime } from "@/lib/datetime-formatters";
import { userRoleLabel, userStatusLabel } from "@/lib/userLabels";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;
const SORT_SCOPE_NOTE = "Sorteaza pagina curenta";

// v2.42.0 (6.5): etichetele vin din sursa unica userLabels (nu map local —
// "Doar citire", nu "Read-only").
const ROLE_OPTIONS: ReadonlyArray<{ value: UserRole; label: string }> = [
  { value: "user", label: userRoleLabel("user") },
  { value: "admin", label: userRoleLabel("admin") },
  { value: "support", label: userRoleLabel("support") },
  { value: "readonly", label: userRoleLabel("readonly") },
];

// v2.42.0 (4.1): support/readonly exista in schema dar nu au NICIO regula
// wired (singura verificare e requireRole("admin")) — un user "Doar citire"
// s-ar comporta identic cu unul normal. Nu le oferim la creare SAU asignare;
// raman afisabile pentru randuri istorice (optiune disabled).
const ASSIGNABLE_ROLE_OPTIONS = ROLE_OPTIONS.filter((o) => o.value === "user" || o.value === "admin");

const STATUS_OPTIONS: ReadonlyArray<{ value: UserStatus; label: string }> = [
  { value: "active", label: userStatusLabel("active") },
  { value: "suspended", label: userStatusLabel("suspended") },
  { value: "deleted", label: userStatusLabel("deleted") },
];

const roleLabel = (role: UserRole) => userRoleLabel(role);
const statusLabel = (status: UserStatus) => userStatusLabel(status);

function statusVariant(status: UserStatus): "success" | "warning" | "destructive" {
  if (status === "active") return "success";
  if (status === "suspended") return "warning";
  return "destructive";
}

function roleVariant(role: UserRole): "default" | "secondary" | "outline" {
  if (role === "admin") return "default";
  if (role === "support") return "secondary";
  return "outline";
}

function importIssueBadge(issue: UserImportIssue): { label: string; variant: "warning" | "secondary" } {
  if (issue.code === "invalid_row") return { label: "Invalid", variant: "warning" };
  if (issue.code === "duplicate_in_db") return { label: "Exista deja", variant: "secondary" };
  return { label: "Duplicat in fisier", variant: "secondary" };
}

// v2.42.0 (5.1): `embedded` — pagina se randeaza ca tab in /setari, fara
// shell-ul propriu (padding + h1); sumarul si actiunile raman.
export default function AdminUsers({ embedded = false }: { embedded?: boolean } = {}) {
  const { user: me, refresh: refreshMe } = useCurrentUser();
  const confirm = useConfirm();
  const toast = useToast();
  const [rows, setRows] = useState<AdminUser[]>([]);
  // v2.42.0 (6.8): sortare client-side pe pagina curenta (paginarea ramane pe
  // server, deci sortarea NU traverseaza paginile — title-ul o spune).
  // Rol/status se sorteaza pe etichetele UMANE, ca ordinea sa urmeze ce vede userul.
  const { sorted: sortedRows, ...sort } = useClientSort(rows, {
    email: (r) => r.email,
    displayName: (r) => r.displayName,
    role: (r) => roleLabel(r.role),
    status: (r) => statusLabel(r.status),
    lastLoginAt: (r) => r.lastLoginAt,
    createdAt: (r) => r.createdAt,
  });
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [roleFilter, setRoleFilter] = useState<UserRole | "all">("all");
  const [statusFilter, setStatusFilter] = useState<UserStatus | "all">("all");
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Paginare completa (numere + marime pagina), ca la Dosare.
  const [pageSize, setPageSize] = useState(PAGE_SIZE);

  // Creare individuala (4.2).
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState<"user" | "admin">("user");
  const [creating, setCreating] = useState(false);
  const [createMsg, setCreateMsg] = useState<string | null>(null);

  // Import Excel (4.3).
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportUsersResult | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await admin.listUsers({
        page,
        pageSize,
        search: search || undefined,
        role: roleFilter === "all" ? undefined : roleFilter,
        status: statusFilter === "all" ? undefined : statusFilter,
      });
      setRows(result.rows);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare la incarcarea utilizatorilor.");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, roleFilter, search, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: resetarea paginii depinde explicit de filtrele vizibile.
  useEffect(() => {
    setPage(1);
  }, [roleFilter, search, statusFilter]);

  const onSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput.trim());
  };

  // Server-side guards (last_admin, self_deactivation) are the source of truth;
  // the client just hides the change as a UX nicety so admins don't even try.
  const blockSelfDemote = useCallback((target: AdminUser) => target.id === me?.id && target.role === "admin", [me?.id]);
  const blockSelfDeactivate = useCallback((target: AdminUser) => target.id === me?.id, [me?.id]);

  const handleRoleChange = async (target: AdminUser, nextRole: UserRole) => {
    if (nextRole === target.role) return;
    if (blockSelfDemote(target) && nextRole !== "admin") {
      setError(
        "Nu te poti retrograda pe tine: cere altui admin sa schimbe rolul, ca fail-safe impotriva blocarii contului unic de admin."
      );
      return;
    }
    const ok = await confirm({
      title: "Schimba rol",
      message: `Schimba rolul lui ${target.email} din "${roleLabel(target.role)}" in "${roleLabel(nextRole)}"?`,
      destructive: nextRole !== "admin" && target.role === "admin",
      confirmLabel: "Schimba",
    });
    if (!ok) return;
    setBusyId(target.id);
    setError(null);
    try {
      await admin.updateRole(target.id, nextRole);
      await load();
      toast(`Rolul lui ${target.email} este acum "${roleLabel(nextRole)}".`, { variant: "success" });
      // If the caller changed their own role, refresh /me so the sidebar
      // reflects the new role (e.g., admin → user hides the Admin section).
      if (target.id === me?.id) refreshMe();
    } catch (err) {
      const msg =
        err instanceof MonitoringApiError && err.code === "last_admin"
          ? "Refuzat: ar ramane zero administratori activi."
          : err instanceof Error
            ? err.message
            : "Eroare la schimbarea rolului.";
      setError(msg);
    } finally {
      setBusyId(null);
    }
  };

  const handleStatusChange = async (target: AdminUser, nextStatus: UserStatus) => {
    if (nextStatus === target.status) return;
    if (blockSelfDeactivate(target) && nextStatus !== "active") {
      setError("Nu te poti dezactiva singur. Cere altui admin.");
      return;
    }
    const destructive = nextStatus !== "active";
    const ok = await confirm({
      title: "Schimba status",
      message: `Schimba statusul lui ${target.email} din "${statusLabel(target.status)}" in "${statusLabel(nextStatus)}"?`,
      destructive,
      confirmLabel: destructive ? "Confirma" : "Reactiveaza",
    });
    if (!ok) return;
    setBusyId(target.id);
    setError(null);
    try {
      await admin.updateStatus(target.id, nextStatus);
      await load();
      toast(`Statusul lui ${target.email} este acum "${statusLabel(nextStatus)}".`, { variant: "success" });
    } catch (err) {
      const msg =
        err instanceof MonitoringApiError && err.code === "self_deactivation"
          ? "Refuzat: nu te poti dezactiva singur."
          : err instanceof Error
            ? err.message
            : "Eroare la schimbarea statusului.";
      setError(msg);
    } finally {
      setBusyId(null);
    }
  };

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = newEmail.trim();
    const displayName = newName.trim();
    if (!email || !displayName) {
      setError("Completeaza emailul si numele afisat.");
      return;
    }
    setCreating(true);
    setError(null);
    setCreateMsg(null);
    try {
      const created = await admin.createUser({ email, displayName, role: newRole });
      setCreateMsg(`Utilizator creat — se poate loga cu contul Google ${created.email}.`);
      setNewEmail("");
      setNewName("");
      setNewRole("user");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare la crearea utilizatorului.");
    } finally {
      setCreating(false);
    }
  };

  const onDownloadTemplate = async () => {
    setError(null);
    try {
      const blob = await admin.downloadUsersImportTemplate();
      triggerBlobDownload(blob, "model-import-utilizatori.xlsx");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare la descarcarea template-ului.");
    }
  };

  const onImportFile = async (file: File) => {
    setImporting(true);
    setError(null);
    setImportResult(null);
    try {
      const result = await admin.importUsers(await file.arrayBuffer());
      setImportResult(result);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare la importul fisierului.");
    } finally {
      setImporting(false);
      // Acelasi fisier poate fi re-selectat dupa o corectie.
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const summary = (() => {
    const parts = [`${total} total`];
    if (search) parts.push(`filtru: "${search}"`);
    if (roleFilter !== "all") parts.push(`rol: ${roleLabel(roleFilter)}`);
    if (statusFilter !== "all") parts.push(`status: ${statusLabel(statusFilter)}`);
    return parts.join(" · ");
  })();

  return (
    <div className={cn(!embedded && "min-h-full bg-background p-6")}>
      <div className={cn("space-y-5", !embedded && "mx-auto max-w-7xl")}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            {!embedded && (
              <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
                <UsersIcon className="h-6 w-6 text-primary" />
                Utilizatori
              </h1>
            )}
            <p className={cn("text-sm text-muted-foreground", !embedded && "mt-1")}>{summary}</p>
          </div>
          <Button variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            Reincarca
          </Button>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Search className="h-4 w-4" />
              Filtre
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSearchSubmit} className="grid gap-3 md:grid-cols-4">
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Cauta dupa email sau nume"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm md:col-span-2"
              />
              <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as UserRole | "all")}>
                <SelectTrigger>
                  <SelectValue placeholder="Rol" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toate rolurile</SelectItem>
                  {ROLE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as UserStatus | "all")}>
                <SelectTrigger>
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  {/* Default-ul exclude userii stersi (soft delete) — ei apar
                      doar cu filtrul explicit "Sters". */}
                  <SelectItem value="all">Toate (fara stersi)</SelectItem>
                  {STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="submit" variant="secondary" className="md:col-span-4 md:w-fit">
                Aplica cautarea
              </Button>
            </form>
          </CardContent>
        </Card>

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="flex-1">{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              className="text-red-700/70 hover:text-red-900 dark:text-red-300/70"
            >
              ×
            </button>
          </div>
        )}

        {/* v2.42.0: provisionare useri din UI — individual + import bulk din
            xlsx, in doua carduri alaturate (layout pastrat la cererea userului;
            referinta le comaseaza intr-un singur card orizontal). Bridge-ul
            oauth2 e fail-closed: userul se poate loga imediat ce exista aici
            cu status active. */}
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <UserPlus className="h-4 w-4" />
                Adauga utilizator
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={onCreate} className="space-y-3">
                {createMsg && (
                  <div className="rounded-md border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700 dark:border-green-900/50 dark:bg-green-950/30 dark:text-green-300">
                    {createMsg}
                  </div>
                )}
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground" htmlFor="new-user-email">
                    Email (contul Google)
                  </label>
                  <input
                    id="new-user-email"
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="ana@firma.ro"
                    maxLength={254}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground" htmlFor="new-user-name">
                    Nume afisat
                  </label>
                  <input
                    id="new-user-name"
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Ana Pop"
                    maxLength={120}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                </div>
                <div className="flex items-end gap-3">
                  <div className="flex-1">
                    <label className="mb-1 block text-xs text-muted-foreground" htmlFor="new-user-role">
                      Rol
                    </label>
                    <select
                      id="new-user-role"
                      value={newRole}
                      onChange={(e) => setNewRole(e.target.value as "user" | "admin")}
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    >
                      {ASSIGNABLE_ROLE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Button type="submit" disabled={creating}>
                    <UserPlus className="h-4 w-4" />
                    {creating ? "Se creeaza..." : "Creeaza"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileUp className="h-4 w-4" />
                Import din Excel
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Descarca modelul, completeaza un rand per utilizator (rol: Utilizator sau Admin) si incarca fisierul.
                Maxim 500 de randuri / 512KB.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={onDownloadTemplate} disabled={importing}>
                  <Download className="h-4 w-4" />
                  Descarca modelul
                </Button>
                <Button onClick={() => fileInputRef.current?.click()} disabled={importing}>
                  <FileUp className={cn("h-4 w-4", importing && "animate-pulse")} />
                  {importing ? "Se importa..." : "Incarca fisierul"}
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void onImportFile(file);
                  }}
                />
              </div>
              {importResult && (
                <div className="space-y-2">
                  <p className="text-sm">
                    <span className="font-medium text-green-700 dark:text-green-400">
                      {importResult.summary.created} creati
                    </span>
                    {" · "}
                    <span className="text-muted-foreground">{importResult.summary.duplicates} duplicate</span>
                    {" · "}
                    <span className={importResult.summary.invalid > 0 ? "text-red-600" : "text-muted-foreground"}>
                      {importResult.summary.invalid} invalide
                    </span>
                  </p>
                  {importResult.issues.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                            <th className="px-3 py-1.5 font-semibold">Rand</th>
                            <th className="px-3 py-1.5 font-semibold">Email</th>
                            <th className="px-3 py-1.5 font-semibold">Status</th>
                            <th className="px-3 py-1.5 font-semibold">Motiv</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {importResult.issues.map((issue) => {
                            const badge = importIssueBadge(issue);
                            return (
                              <tr key={`${issue.rowNumber}:${issue.code}:${issue.email ?? ""}`}>
                                <td className="px-3 py-1.5 align-top text-xs text-muted-foreground">
                                  {issue.rowNumber}
                                </td>
                                <td className="px-3 py-1.5 align-top font-mono text-xs">{issue.email || "—"}</td>
                                <td className="px-3 py-1.5 align-top">
                                  <Badge variant={badge.variant}>{badge.label}</Badge>
                                </td>
                                <td className="px-3 py-1.5 align-top text-xs text-muted-foreground">{issue.message}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <SortableTh sort={sort} sortKeyName="email" className="px-4" scopeNote={SORT_SCOPE_NOTE}>
                      Email
                    </SortableTh>
                    <SortableTh sort={sort} sortKeyName="displayName" className="px-4" scopeNote={SORT_SCOPE_NOTE}>
                      Nume afisat
                    </SortableTh>
                    <SortableTh sort={sort} sortKeyName="role" className="px-4" scopeNote={SORT_SCOPE_NOTE}>
                      Rol
                    </SortableTh>
                    <SortableTh sort={sort} sortKeyName="status" className="px-4" scopeNote={SORT_SCOPE_NOTE}>
                      Status
                    </SortableTh>
                    <SortableTh sort={sort} sortKeyName="lastLoginAt" className="px-4" scopeNote={SORT_SCOPE_NOTE}>
                      Ultimul login
                    </SortableTh>
                    <SortableTh sort={sort} sortKeyName="createdAt" className="px-4" scopeNote={SORT_SCOPE_NOTE}>
                      Creat
                    </SortableTh>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && !loading && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                        Niciun utilizator pentru filtrele curente.
                      </td>
                    </tr>
                  )}
                  {sortedRows.map((row) => {
                    const isSelf = row.id === me?.id;
                    return (
                      <tr key={row.id} className="border-b border-border last:border-b-0 hover:bg-muted/30">
                        <td className="px-4 py-2 align-top font-mono text-xs">
                          {row.email}
                          {isSelf && (
                            <Badge variant="outline" className="ml-2">
                              tu
                            </Badge>
                          )}
                        </td>
                        <td className="px-4 py-2 align-top">{row.displayName || "-"}</td>
                        <td className="px-4 py-2 align-top">
                          {/* Latimi fixe pe badge + select: altfel eticheta variabila a
                              rolului ("Admin" vs "Utilizator") impinge select-urile la
                              offset-uri diferite intre randuri. */}
                          <div className="flex items-center gap-2">
                            <Badge variant={roleVariant(row.role)} className="w-24 justify-center">
                              {roleLabel(row.role)}
                            </Badge>
                            <Select value={row.role} onValueChange={(v) => handleRoleChange(row, v as UserRole)}>
                              <SelectTrigger
                                className="h-7 px-2 text-xs w-[130px]"
                                disabled={busyId === row.id || loading}
                              >
                                <SelectValue placeholder="Rol" />
                              </SelectTrigger>
                              <SelectContent>
                                {/* Rand istoric cu rol in afara celor asignabile: vizibil,
                                    dar nu re-selectabil. */}
                                {!ASSIGNABLE_ROLE_OPTIONS.some((o) => o.value === row.role) && (
                                  <SelectItem value={row.role} disabled>
                                    {roleLabel(row.role)}
                                  </SelectItem>
                                )}
                                {ASSIGNABLE_ROLE_OPTIONS.map((o) => (
                                  <SelectItem key={o.value} value={o.value}>
                                    {o.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </td>
                        <td className="px-4 py-2 align-top">
                          <div className="flex items-center gap-2">
                            <Badge variant={statusVariant(row.status)} className="w-24 justify-center">
                              {statusLabel(row.status)}
                            </Badge>
                            <Select value={row.status} onValueChange={(v) => handleStatusChange(row, v as UserStatus)}>
                              <SelectTrigger
                                className="h-7 px-2 text-xs w-[130px]"
                                disabled={busyId === row.id || loading}
                              >
                                <SelectValue placeholder="Status" />
                              </SelectTrigger>
                              <SelectContent>
                                {STATUS_OPTIONS.map((o) => (
                                  <SelectItem key={o.value} value={o.value}>
                                    {o.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </td>
                        <td className="px-4 py-2 align-top text-xs text-muted-foreground">
                          {formatIsoDateTime(row.lastLoginAt)}
                        </td>
                        <td className="px-4 py-2 align-top text-xs text-muted-foreground">
                          {formatIsoDateTime(row.createdAt)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <TablePagination
          page={page - 1}
          totalPages={totalPages}
          pageSize={pageSize}
          onPageChange={(p) => setPage(p + 1)}
          onPageSizeChange={(s) => {
            setPageSize(s);
            setPage(1);
          }}
          pageSizes={[20, 50, 100]}
          disabled={loading}
        />
      </div>
    </div>
  );
}
