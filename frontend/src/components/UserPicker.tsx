import { useEffect, useState } from "react";
import { Users as UsersIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { admin, type AdminUser } from "@/lib/api";
import { userRoleLabel } from "@/lib/userLabels";

// v2.41.0 (5.5): selectia userului in paginile Cote + Granturi = dropdown cu
// TOTI userii activi (nu cautare dupa email — un tenant e o firma, lista e
// mica). Sortare pe email; nota vizibila cand totalul depaseste pagina.

const PAGE_SIZE = 100;

export interface UserPickerProps {
  // Id-ul selectat curent ("" = nimic selectat).
  value: string;
  onSelect: (user: AdminUser) => void;
  disabled?: boolean;
  ariaLabel: string;
}

export function UserPicker({ value, onSelect, disabled, ariaLabel }: UserPickerProps) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    admin
      .listUsers({ status: "active", pageSize: PAGE_SIZE, signal: ac.signal })
      .then((result) => {
        if (ac.signal.aborted) return;
        const sorted = [...result.rows].sort((a, b) => a.email.localeCompare(b.email));
        setUsers(sorted);
        setTotal(result.total);
      })
      .catch((err) => {
        if (ac.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Eroare la incarcarea utilizatorilor.");
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, []);

  // Card cu titlu, nu select gol pe fundalul paginii — altfel controlul se
  // pierde vizual (feedback user, Cote + Granturi).
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <UsersIcon className="h-4 w-4" />
          Selecteaza utilizator
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <select
          aria-label={ariaLabel}
          value={value}
          disabled={disabled || loading}
          onChange={(e) => {
            const user = users.find((u) => u.id === e.target.value);
            if (user) onSelect(user);
          }}
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="" disabled>
            {loading ? "Se incarca utilizatorii..." : "Alege un utilizator"}
          </option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.email} — {u.displayName} ({userRoleLabel(u.role)})
            </option>
          ))}
        </select>
        {error && <p className="text-xs text-red-600">{error}</p>}
        {!loading && total > users.length && (
          <p className="text-xs text-muted-foreground">
            Se afiseaza {users.length} din {total} utilizatori activi — lista e incompleta, unii utilizatori pot lipsi
            din dropdown.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
