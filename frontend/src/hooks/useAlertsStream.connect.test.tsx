// @vitest-environment jsdom

// Prima conectare a stream-ului de alerte, in modul web.
//
// Bug observat in productie (audit: `auth.denied` pe /api/v1/alerts/stream, cod
// `unauthorized`, actor `system`): la incarcarea paginii hook-ul deschidea
// EventSource-ul imediat, fara sa se asigure ca sesiunea exista. EventSource NU
// trece prin apiFetch, deci nu prinde interceptorul de 401 care repara tacut
// celelalte cereri — refuzul ramane scris, si singura recuperare era prin
// ciclul de reconectare, adica dupa cel putin o secunda si dupa un `auth.denied`
// deja consumat.
//
// Calea de RECONECTARE avea deja gardul (`ensureWebSession()` inainte de
// `connect()`), pus exact ca sa opreasca rafalele de `auth.denied` dupa o
// trezire cu cookie expirat. Testele fixeaza aceeasi garantie pe prima
// conectare, si pastreaza desktopul cu zero apeluri de sesiune.

import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Ordinea reala a efectelor: fiecare apel isi lasa urma aici, deci testul poate
// afirma ca sesiunea a fost ceruta INAINTE de deschiderea stream-ului, nu doar
// ca ambele s-au intamplat la un moment dat.
const calls: string[] = [];
const ensureWebSession = vi.fn();
let webRuntime = true;

vi.mock("@/lib/api", () => ({
  ensureWebSession: (...args: unknown[]) => ensureWebSession(...args),
  isWebRuntime: () => webRuntime,
}));

vi.mock("@/lib/alertsApi", () => ({
  alertsApi: { unreadCount: vi.fn(async () => 0) },
}));

vi.mock("@/lib/alertsNotificationPref", () => ({
  getAlertsNotificationsEnabled: () => false,
}));

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly url: string;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    calls.push(`eventsource:${url}`);
    FakeEventSource.instances.push(this);
  }

  addEventListener(): void {}
  close(): void {}
}

let container: HTMLDivElement;
let root: Root;

async function renderHook() {
  const { useAlertsStream } = await import("@/hooks/useAlertsStream");
  function Probe() {
    useAlertsStream();
    return null;
  }
  await act(async () => {
    root.render(<Probe />);
  });
}

beforeEach(() => {
  calls.length = 0;
  FakeEventSource.instances.length = 0;
  webRuntime = true;
  ensureWebSession.mockReset();
  ensureWebSession.mockImplementation(async () => {
    calls.push("ensureWebSession");
    return { ok: true };
  });
  vi.stubGlobal("EventSource", FakeEventSource);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.unstubAllGlobals();
});

describe("useAlertsStream — prima conectare", () => {
  it("in web, asigura sesiunea INAINTE de a deschide stream-ul", async () => {
    await renderHook();

    expect(FakeEventSource.instances.length).toBe(1);
    expect(calls).toEqual(["ensureWebSession", "eventsource:/api/v1/alerts/stream"]);
  });

  it("in desktop, conecteaza direct si NU cere sesiune web", async () => {
    webRuntime = false;
    await renderHook();

    expect(ensureWebSession).not.toHaveBeenCalled();
    expect(calls).toEqual(["eventsource:/api/v1/alerts/stream"]);
  });
});
