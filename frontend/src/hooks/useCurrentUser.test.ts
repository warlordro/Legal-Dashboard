// @vitest-environment jsdom

// v2.42.0 (3.4): store partajat /me — un singur fetch pentru toate instantele.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement } from "react";

const mockGet = vi.fn();
vi.mock("@/lib/api", () => ({
  me: { get: (...args: unknown[]) => mockGet(...args) },
}));

import { __resetCurrentUserStoreForTests, useCurrentUser, type UseCurrentUserResult } from "./useCurrentUser";

const PROFILE = {
  id: "u-1",
  email: "u@firma.ro",
  displayName: "U",
  role: "user",
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
  lastLoginAt: null,
};

function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root | null = null;
  const captured: { current: UseCurrentUserResult | null } = { current: null };
  function Probe() {
    captured.current = useCurrentUser();
    return null;
  }
  act(() => {
    root = createRoot(container);
    root.render(createElement(Probe));
  });
  return {
    get api(): UseCurrentUserResult {
      if (!captured.current) throw new Error("hook not mounted");
      return captured.current;
    },
    unmount() {
      act(() => root?.unmount());
      container.remove();
    },
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  mockGet.mockReset();
  __resetCurrentUserStoreForTests();
});

afterEach(() => {
  __resetCurrentUserStoreForTests();
});

describe("useCurrentUser — store partajat", () => {
  it("doua instante montate simultan produc UN SINGUR fetch /me", async () => {
    mockGet.mockResolvedValue(PROFILE);
    const a = mount();
    const b = mount();
    await flush();
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(a.api.user?.id).toBe("u-1");
    expect(b.api.user?.id).toBe("u-1");
    a.unmount();
    b.unmount();
  });

  it("refresh() asteapta fetch-ul curent si porneste unul proaspat", async () => {
    mockGet.mockResolvedValueOnce(PROFILE);
    const h = mount();
    await flush();
    expect(h.api.user?.role).toBe("user");

    mockGet.mockResolvedValueOnce({ ...PROFILE, role: "admin" });
    await act(async () => {
      await h.api.refresh();
    });
    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(h.api.user?.role).toBe("admin");
    h.unmount();
  });

  it("eroarea nu ramane lipita: urmatorul mount re-incearca cu loading vizibil", async () => {
    mockGet.mockRejectedValueOnce(new Error("boom"));
    const a = mount();
    await flush();
    expect(a.api.error).toBe("boom");
    expect(a.api.loading).toBe(false);
    a.unmount();

    mockGet.mockResolvedValueOnce(PROFILE);
    const b = mount();
    // Retry-ul emite loading:true + error:null inainte de fetch.
    expect(b.api.loading).toBe(true);
    expect(b.api.error).toBeNull();
    await flush();
    expect(b.api.user?.id).toBe("u-1");
    expect(mockGet).toHaveBeenCalledTimes(2);
    b.unmount();
  });

  it("mount-urile ulterioare cu stare buna NU re-fetch-uiesc", async () => {
    mockGet.mockResolvedValue(PROFILE);
    const a = mount();
    await flush();
    a.unmount();
    const b = mount();
    await flush();
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(b.api.user?.id).toBe("u-1");
    b.unmount();
  });
});
