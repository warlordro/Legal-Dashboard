// Drift detector — backend ALERT_KINDS / ALERT_SEVERITIES / ALERT_JOB_KINDS
// must stay in lockstep with the frontend type unions.
//
// Why this exists: the backend now exposes single-source-of-truth tuples
// (v2.16.1), but the frontend duplicates the same lists as TypeScript union
// types in `frontend/src/lib/alertsApi.ts`. A new kind added in one place
// without the other slips through tsc on both sides (each file type-checks
// against its own definition) and only surfaces as a runtime label hole or a
// missing dropdown option. This test reads the frontend source as text,
// regex-extracts the union members, and asserts set equality with the backend
// const tuples.

import fsPromises from "fs/promises";
import path from "path";
import { describe, expect, it } from "vitest";

import { ALERT_JOB_KINDS, ALERT_KINDS, ALERT_SEVERITIES } from "./monitoringAlertsRepository.ts";

const FRONTEND_ALERTS_API = path.resolve(__dirname, "../../../frontend/src/lib/alertsApi.ts");

async function readFrontendSource(): Promise<string> {
  return fsPromises.readFile(FRONTEND_ALERTS_API, "utf8");
}

// Extracts the string-literal members from a TypeScript union of the form
// `export type Name = "a" | "b" | "c";`, tolerating multi-line layouts and
// optional leading `|`. Returns the members in source order; tests compare via
// Set so order drift is not a failure.
function extractUnionMembers(src: string, typeName: string): string[] {
  const re = new RegExp(`export type ${typeName}\\s*=\\s*([\\s\\S]*?);`, "m");
  const match = src.match(re);
  if (!match) {
    throw new Error(`Could not find 'export type ${typeName}' in frontend source`);
  }
  const body = match[1];
  const members = [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  if (members.length === 0) {
    throw new Error(`No string literals extracted from union '${typeName}'`);
  }
  return members;
}

describe("alert enum drift detector — backend tuples vs frontend unions", () => {
  it("ALERT_KINDS matches frontend AlertKind union exactly", async () => {
    const src = await readFrontendSource();
    const frontend = new Set(extractUnionMembers(src, "AlertKind"));
    const backend = new Set<string>(ALERT_KINDS);
    expect(frontend).toEqual(backend);
  });

  it("ALERT_SEVERITIES matches frontend AlertSeverity union exactly", async () => {
    const src = await readFrontendSource();
    const frontend = new Set(extractUnionMembers(src, "AlertSeverity"));
    const backend = new Set<string>(ALERT_SEVERITIES);
    expect(frontend).toEqual(backend);
  });

  it("ALERT_JOB_KINDS matches frontend AlertJobKind union exactly", async () => {
    const src = await readFrontendSource();
    const frontend = new Set(extractUnionMembers(src, "AlertJobKind"));
    const backend = new Set<string>(ALERT_JOB_KINDS);
    expect(frontend).toEqual(backend);
  });

  it("alertKindLabels object covers every frontend AlertKind member", async () => {
    const src = await readFrontendSource();
    const frontendKinds = new Set(extractUnionMembers(src, "AlertKind"));
    // Pull keys from the labels object body. Pattern: `kind: "Label",`
    // tolerant to either single or double-quoted label values.
    const labelsBlock = src.match(/export const alertKindLabels[^=]*=\s*\{([\s\S]*?)\};/m);
    if (!labelsBlock) throw new Error("alertKindLabels block not found");
    const keys = new Set([...labelsBlock[1].matchAll(/^\s*([a-z_]+)\s*:/gm)].map((m) => m[1]));
    expect(keys).toEqual(frontendKinds);
  });
});
