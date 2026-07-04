import { useEffect, useState } from "react";
import { Users as UsersIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { admin, type AdminUser } from "@/lib/api";

// v2.42.0 (feedback testare): selectia userului in paginile Cote/Granturi e un
// dropdown cu TOTI userii activi, nu cautare dupa email. Tenantii sunt mici
// (zeci de useri); plafonul de 100 acopera cazul real, iar peste el afisam
// nota explicita in loc sa trunchem silentios.
const PICKER_PAGE_SIZE = 100;

export function UserPicker({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (user: AdminUser) => void;
}) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    admin
      .listUsers({ status: "active", pageSize: PICKER_PAGE_SIZE })
      .then((result) => {
        if (cancelled) return;
        setUsers([...result.rows].sort((a, b) => a.email.localeCompare(b.email)));
        setTotal(result.total);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Eroare la incarcarea utilizatorilor.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <UsersIcon className="h-4 w-4" />
          Selecteaza utilizator
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {error && <p className="text-sm text-red-600">{error}</p>}
        <select
          aria-label="Selecteaza utilizatorul"
          value={selectedId ?? ""}
          onChange={(e) => {
            const user = users.find((u) => u.id === e.target.value);
            if (user) onSelect(user);
          }}
          disabled={loading}
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="" disabled>
            {loading ? "Se incarca utilizatorii..." : "Alege utilizatorul..."}
          </option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.email} — {u.displayName || u.email} ({u.role === "admin" ? "Admin" : "Utilizator"})
            </option>
          ))}
        </select>
        {total > PICKER_PAGE_SIZE && (
          <p className="text-xs text-muted-foreground">
            Se afiseaza primii {PICKER_PAGE_SIZE} din {total} useri activi (sortati dupa email) — restul se gasesc din
            pagina Utilizatori.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
