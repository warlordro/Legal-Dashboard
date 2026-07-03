import { useCallback, useEffect, useState } from "react";
import { Users as UsersIcon, RefreshCw, ShieldAlert, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { admin, MonitoringApiError, type AdminUser, type UserRole, type UserStatus } from "@/lib/api";
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

export default function AdminUsers() {
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
    <div className="min-h-full bg-background p-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <UsersIcon className="h-6 w-6 text-primary" />
              Utilizatori
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">{summary}</p>
          </div>
          <Button variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            Refresh
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
                  <SelectItem value="all">Toate statusurile</SelectItem>
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
                                {ROLE_OPTIONS.map((o) => (
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
