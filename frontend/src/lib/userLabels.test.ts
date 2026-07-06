import { describe, expect, it } from "vitest";
import { userRoleLabel, userStatusLabel } from "./userLabels";

describe("userLabels", () => {
  it("traduce rolurile, inclusiv cele istorice", () => {
    expect(userRoleLabel("user")).toBe("Utilizator");
    expect(userRoleLabel("admin")).toBe("Admin");
    expect(userRoleLabel("support")).toBe("Suport");
    expect(userRoleLabel("readonly")).toBe("Doar citire");
  });

  it("traduce statusurile", () => {
    expect(userStatusLabel("active")).toBe("Activ");
    expect(userStatusLabel("suspended")).toBe("Suspendat");
    expect(userStatusLabel("deleted")).toBe("Sters");
  });

  it("valoare necunoscuta: fallback pe token", () => {
    expect(userRoleLabel("owner")).toBe("owner");
    expect(userStatusLabel("archived")).toBe("archived");
  });
});
