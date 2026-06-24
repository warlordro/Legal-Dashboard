import { describe, expect, it } from "vitest";
import { getPortalJustUrl } from "./dosare-table-helpers";

describe("getPortalJustUrl", () => {
  it("encodes slashes for canonical dosar number", () => {
    expect(getPortalJustUrl("1234/3/2024")).toBe("https://portal.just.ro/SitePages/cautare.aspx?k=1234%2F3%2F2024");
  });

  it("strips /aN sub-register suffix to find the parent on SharePoint indexer", () => {
    expect(getPortalJustUrl("2753/89/2025/a2")).toBe(
      "https://portal.just.ro/SitePages/cautare.aspx?k=2753%2F89%2F2025"
    );
    expect(getPortalJustUrl("2753/89/2025/a")).toBe("https://portal.just.ro/SitePages/cautare.aspx?k=2753%2F89%2F2025");
    expect(getPortalJustUrl("2753/89/2025/A2")).toBe(
      "https://portal.just.ro/SitePages/cautare.aspx?k=2753%2F89%2F2025"
    );
    expect(getPortalJustUrl("2753/89/2025")).toBe("https://portal.just.ro/SitePages/cautare.aspx?k=2753%2F89%2F2025");
  });
});
