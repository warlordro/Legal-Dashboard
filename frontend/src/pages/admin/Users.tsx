import { useCallback, useEffect, useRef, useState } from "react";
import { Users as UsersIcon, RefreshCw, ShieldAlert, Search, UserPlus, Download, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  admin,
  MonitoringApiError,
  USER_IMPORT_TEMPLATE_URL,
  type AdminUser,
  type CreatableUserRole,
  type UserImportReport,
  type UserRole,
  type UserStatus,
} from "@/lib/api";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { formatIsoDateTime } from "@/lib/datetime-formatters";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;

const ROLE_OPTIONS: ReadonlyArray<{ value: UserRole; label: string }> = [
  { value: "user", label: "Utilizator" },
  { value: "admin", label: "Admin" },
  { value: "support", label: "Suport" },
  { value: "readonly", label: "Read-only" },
];

// v2.42.0 (decizie user): support/readonly exista in schema din PR-8 dar nu au
// NICIO regula wired (singura verificare e requireRole("admin")) — un user
// "Read-only" se comporta identic cu unul normal. Nu le mai oferim la
// asignare; raman afisabile pentru randuri istorice (optiune disabled).
const ASSIGNABLE_ROLE_OPTIONS = ROLE_OPTIONS.filter((o) => o.value === "user" || o.value === "admin");

const STATUS_OPTIONS: ReadonlyArray<{ value: UserStatus; label: string }> = [
  { value: "active", label: "Activ" },
  { value: "suspended", label: "Suspendat" },
  { value: "deleted", label: "Sters" },
];

const roleLabel = (role: UserRole) => ROLE_OPTIONS.find((o) => o.value === role)?.label ?? role;
const statusLabel = (status: UserStatus) => STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status;

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

export default function AdminUsers({ embedded = false }: { embedded?: boolean } = {}) {
  const { user: me, refresh: refreshMe } = useCurrentUser();
  const confirm = useConfirm();
  const [rows, setRows] = useState<AdminUser[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [roleFilter, setRoleFilter] = useState<UserRole | "all">("all");
  const [statusFilter, setStatusFilter] = useState<UserStatus | "all">("all");
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // v2.42.0: creare user individual + import bulk din xlsx.
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState<CreatableUserRole>("user");
  const [creating, setCreating] = useState(false);
  const [createMsg, setCreateMsg] = useState<string | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importReport, setImportReport] = useState<UserImportReport | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await admin.listUsers({
        page,
        pageSize: PAGE_SIZE,
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
  }, [page, roleFilter, search, statusFilter]);

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

  const onCreateUser = async (e: React.FormEvent) => {
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

  const onImportFile = async (file: File) => {
    setImportBusy(true);
    setError(null);
    setImportReport(null);
    try {
      const report = await admin.importUsers(await file.arrayBuffer());
      setImportReport(report);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare la importul fisierului.");
    } finally {
      setImportBusy(false);
      // Acelasi fisier reselectat trebuie sa re-declanseze onChange.
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
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

  const summary = (() => {
    const parts = [`${total} total`];
    if (search) parts.push(`filtru: "${search}"`);
    if (roleFilter !== "all") parts.push(`rol: ${roleLabel(roleFilter)}`);
    if (statusFilter !== "all") parts.push(`status: ${statusLabel(statusFilter)}`);
    return parts.join(" · ");
  })();

  return (
    <div className={embedded ? "" : "min-h-full bg-background p-6"}>
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
            Refresh
          </Button>
        </div>

        {/* v2.42.0: provisionare useri din UI — individual + import bulk din xlsx.
            Bridge-ul oauth2 e fail-closed: userul se poate loga imediat ce exista
            aici cu status active. */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <UserPlus className="h-4 w-4" />
              Adauga utilizator
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {createMsg && (
              <div className="rounded-md border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700 dark:border-green-900/50 dark:bg-green-950/30 dark:text-green-300">
                {createMsg}
              </div>
            )}
            <form onSubmit={onCreateUser} className="grid gap-3 md:grid-cols-[2fr_2fr_140px_auto] md:items-end">
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
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground" htmlFor="new-user-role">
                  Rol
                </label>
                <select
                  id="new-user-role"
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as CreatableUserRole)}
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="user">Utilizator</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <Button type="submit" disabled={creating}>
                <UserPlus className="h-4 w-4" />
                Adauga
              </Button>
            </form>

            <div className="border-t border-border pt-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Import din Excel
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    // Content-Disposition: attachment => browserul descarca fara navigare.
                    window.location.assign(USER_IMPORT_TEMPLATE_URL);
                  }}
                >
                  <Download className="h-4 w-4" />
                  Descarca template
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onImportFile(f);
                  }}
                />
                <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={importBusy}>
                  <Upload className={cn("h-4 w-4", importBusy && "animate-pulse")} />
                  {importBusy ? "Se importa..." : "Incarca fisier completat"}
                </Button>
                <span className="text-xs text-muted-foreground">
                  Completeaza template-ul (max 500 randuri) si incarca-l — raportul apare mai jos.
                </span>
              </div>

              {importReport && (
                <div className="mt-3 space-y-2">
                  <p className="text-sm">
                    <span className="font-medium text-green-700 dark:text-green-400">
                      {importReport.summary.created} creati
                    </span>
                    {" · "}
                    <span className="text-muted-foreground">{importReport.summary.duplicates} duplicate</span>
                    {" · "}
                    <span className={importReport.summary.invalid > 0 ? "text-red-600" : "text-muted-foreground"}>
                      {importReport.summary.invalid} invalide
                    </span>
                  </p>
                  {importReport.issues.length > 0 && (
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
                          {importReport.issues.map((issue) => (
                            <tr key={`${issue.rowNumber}:${issue.email}`}>
                              <td className="px-3 py-1.5 align-top text-xs text-muted-foreground">{issue.rowNumber}</td>
                              <td className="px-3 py-1.5 align-top font-mono text-xs">{issue.email || "—"}</td>
                              <td className="px-3 py-1.5 align-top">
                                <Badge variant={issue.status === "invalid" ? "warning" : "secondary"}>
                                  {issue.status === "invalid"
                                    ? "Invalid"
                                    : issue.status === "duplicate_in_db"
                                      ? "Exista deja"
                                      : "Duplicat in fisier"}
                                </Badge>
                              </td>
                              <td className="px-3 py-1.5 align-top text-xs text-muted-foreground">{issue.reason}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

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

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-semibold">Email</th>
                    <th className="px-4 py-2 font-semibold">Nume afisat</th>
                    <th className="px-4 py-2 font-semibold">Rol</th>
                    <th className="px-4 py-2 font-semibold">Status</th>
                    <th className="px-4 py-2 font-semibold">Ultimul login</th>
                    <th className="px-4 py-2 font-semibold">Creat</th>
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
                  {rows.map((row) => {
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

        <div className="flex items-center justify-between">
          <Button variant="outline" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || loading}>
            Inapoi
          </Button>
          <span className="text-sm text-muted-foreground">
            Pagina {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || loading}
          >
            Inainte
          </Button>
        </div>
      </div>
    </div>
  );
}
