// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiFetchMock = vi.fn();
const beginLogoutMock = vi.fn();

vi.mock("./api", () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
  beginLogout: () => beginLogoutMock(),
}));

// beginLogout e async in implementarea reala (asteapta sync-ul in zbor); mock-ul
// trebuie sa se comporte la fel, altfel testele de ordine ar valida altceva.
beginLogoutMock.mockResolvedValue(undefined);

import { logout } from "./authApi";

const SIGN_OUT_URL = "/oauth2/sign_out?rd=%2Fdelogat";

describe("logout", () => {
  let assign: ReturnType<typeof vi.fn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    apiFetchMock.mockReset();
    beginLogoutMock.mockReset();
    // mockReset sterge si valoarea de retur; beginLogout e async in realitate.
    beginLogoutMock.mockResolvedValue(undefined);
    assign = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { assign, href: "https://dashboard.example.test/" },
    });
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("revoca sesiunea pe server, apoi pleaca la sign_out", async () => {
    apiFetchMock.mockResolvedValue(new Response(null, { status: 200 }));

    await logout();

    expect(apiFetchMock).toHaveBeenCalledWith("/api/v1/auth/logout", { method: "POST" });
    expect(assign).toHaveBeenCalledWith(SIGN_OUT_URL);
  });

  // Fara asta, revocarea jti-ului si randul de audit s-ar pierde: navigarea
  // anuleaza cererile in zbor.
  it("asteapta terminarea POST-ului inainte de redirect", async () => {
    const order: string[] = [];
    apiFetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            order.push("post");
            resolve(new Response(null, { status: 200 }));
          }, 10);
        })
    );
    assign.mockImplementation(() => order.push("redirect"));

    await logout();

    expect(order).toEqual(["post", "redirect"]);
  });

  // Un backend picat nu are voie sa tina utilizatorul logat in interfata.
  it("redirecteaza si cand POST-ul esueaza", async () => {
    apiFetchMock.mockRejectedValue(new Error("network down"));

    await logout();

    expect(assign).toHaveBeenCalledWith(SIGN_OUT_URL);
    expect(errorSpy).toHaveBeenCalled();
  });

  // fetch nu arunca pe 4xx/5xx: fara verificarea explicita a lui res.ok, un
  // logout respins de server ar trece drept reusit, fara nicio urma.
  it.each([403, 429, 500])("semnaleaza un raspuns non-2xx (%i)", async (status) => {
    apiFetchMock.mockResolvedValue(new Response(null, { status }));

    await logout();

    expect(errorSpy).toHaveBeenCalled();
    expect(String(errorSpy.mock.calls[0]?.[0] ?? "")).toContain(String(status));
    expect(assign).toHaveBeenCalledWith(SIGN_OUT_URL);
  });

  // Flagul trebuie ridicat INAINTE de orice cerere: altfel un 401 concurent
  // re-minteste sesiunea exact in timpul delogarii.
  it("suspenda re-mint-ul inainte de a trimite cererea", async () => {
    const order: string[] = [];
    beginLogoutMock.mockImplementation(() => order.push("beginLogout"));
    apiFetchMock.mockImplementation(() => {
      order.push("apiFetch");
      return Promise.resolve(new Response(null, { status: 200 }));
    });

    await logout();

    expect(order).toEqual(["beginLogout", "apiFetch"]);
  });

  it("foloseste un rd relativ (unul absolut ar fi respins de whitelist-ul proxy-ului)", async () => {
    apiFetchMock.mockResolvedValue(new Response(null, { status: 200 }));

    await logout();

    const target = assign.mock.calls[0][0] as string;
    expect(target.startsWith("/oauth2/sign_out")).toBe(true);
    expect(decodeURIComponent(target)).toContain("rd=/delogat");
    expect(target).not.toContain("http");
  });
});
