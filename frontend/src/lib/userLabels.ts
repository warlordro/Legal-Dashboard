// Etichete RO pentru enum-urile backend `users.role` / `users.status` —
// folosite in paginile admin care afiseaza identitatea unui user (Cote,
// Granturi). Users.tsx isi tine propriile liste de optiuni pentru select-uri;
// vocabularul de aici e identic cu al lor.
const ROLE_LABELS: Record<string, string> = {
  user: "Utilizator",
  admin: "Admin",
  support: "Suport",
  readonly: "Read-only",
};

const STATUS_LABELS: Record<string, string> = {
  active: "Activ",
  suspended: "Suspendat",
  deleted: "Sters",
};

export function userRoleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

export function userStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}
