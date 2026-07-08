// v2.41.0: etichete umane pentru rolurile si statusurile de utilizator.
// Acopera si rolurile istorice (support/readonly) care nu mai sunt creabile
// dar pot exista in DB — fallback pe token daca apare o valoare necunoscuta.

const ROLE_LABELS: Record<string, string> = {
  user: "Utilizator",
  admin: "Admin",
  support: "Suport",
  readonly: "Doar citire",
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
