import { ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";

// PR-8 client-side admin gate. Server-side `requireRole('admin')` is the
// authoritative check on every /api/v1/admin/* call — this gate just renders
// a friendly 403 placeholder so non-admins navigating to /admin/* by URL
// don't see an empty page or a flash of content while the API rejects them.
export function AdminGate({ children }: { children: ReactNode }) {
  const { user, loading, error } = useCurrentUser();

  if (loading) {
    return (
      <div className="flex min-h-full items-center justify-center bg-background p-6 text-sm text-muted-foreground">
        Verific permisiunile…
      </div>
    );
  }

  if (user?.role !== "admin") {
    return (
      <div className="flex min-h-full items-center justify-center bg-background p-6">
        <div className="max-w-md rounded-xl border border-border bg-card p-6 text-center shadow-sm">
          <ShieldAlert className="mx-auto mb-3 h-10 w-10 text-red-500" />
          <h2 className="text-lg font-semibold">403 — Acces interzis</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Aceasta sectiune este disponibila doar administratorilor. Daca ai nevoie de acces, cere unui admin sa-ti
            schimbe rolul.
          </p>
          {error && <p className="mt-3 text-xs text-muted-foreground">Detaliu: {error}</p>}
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
