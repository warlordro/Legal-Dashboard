import { useEffect, useState } from "react";
import { Users as UsersIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { admin, type AdminUser } from "@/lib/api";
import { userRoleLabel } from "@/lib/userLabels";

// v2.41.0 (5.5): selectia userului in paginile Cote + Granturi = dropdown cu
// TOTI userii activi (nu cautare dupa email — un tenant e o firma, lista e
// mica). Sortare pe email; nota vizibila cand totalul depaseste pagina.
// v2.43.0: pagineaza pana acopera tot totalul (plafon de siguranta MAX_USERS)
// — inainte se opreau la prima pagina si userii de dupa locul 100 lipseau din
// dropdown, ne-selectabili pentru cote/granturi.

const PAGE_SIZE = 100;
const MAX_USERS = 1000;

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
    (async () => {
      const all: AdminUser[] = [];
      let page = 1;
      let grandTotal = 0;
      let hasMore = true;
      while (hasMore) {
        const result = await admin.listUsers({ status: "active", page, pageSize: PAGE_SIZE, signal: ac.signal });
        if (ac.signal.aborted) return;
        all.push(...result.rows);
        grandTotal = result.total;
        // Garda anti-bucla: daca o pagina vine goala desi totalul promitea mai
        // mult (useri stersi intre pagini), ne oprim — altfel fetch infinit.
        hasMore = result.rows.length > 0 && all.length < grandTotal && all.length < MAX_USERS;
        page += 1;
      }
      const sorted = all.sort((a, b) => a.email.localeCompare(b.email));
      setUsers(sorted);
      setTotal(grandTotal);
    })()
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
        {/* Select-ul custom (nu <select> nativ): popup-ul nativ e desenat de
            browser si iese din tema pe dark mode (feedback user). */}
        <Select
          value={value}
          onValueChange={(v) => {
            const user = users.find((u) => u.id === v);
            if (user) onSelect(user);
          }}
        >
          <SelectTrigger aria-label={ariaLabel} disabled={disabled || loading} className="w-full">
            <SelectValue placeholder={loading ? "Se incarca utilizatorii..." : "Alege un utilizator"} />
          </SelectTrigger>
          <SelectContent>
            {users.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {`${u.email} — ${u.displayName} (${userRoleLabel(u.role)})`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {error && <p className="text-xs text-red-600">{error}</p>}
        {!loading && total > users.length && (
          <p className="text-xs text-muted-foreground">
            Se afiseaza {users.length} din {total} utilizatori activi — lista e trunchiata la {MAX_USERS}, unii
            utilizatori pot lipsi din dropdown.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
