import { describe, expect, it } from "vitest";
import { JobCreateBodySchema, JobUpdateBodySchema } from "./monitoring";

describe("notes - limita 200 chars", () => {
  it("Create: 200 chars trece", () => {
    const result = JobCreateBodySchema.safeParse({
      kind: "dosar_soap",
      target: { numar_dosar: "1234/180/2024" },
      cadence_sec: 14400,
      alert_config: {},
      notes: "x".repeat(200),
    });

    expect(result.success).toBe(true);
  });

  it("Create: 201 chars esueaza cu mesaj romanesc clar", () => {
    const result = JobCreateBodySchema.safeParse({
      kind: "dosar_soap",
      target: { numar_dosar: "1234/180/2024" },
      cadence_sec: 14400,
      alert_config: {},
      notes: "x".repeat(201),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes("notes"));
      expect(issue?.message).toMatch(/200/);
    }
  });

  it("Update: 200 chars trece", () => {
    expect(JobUpdateBodySchema.safeParse({ notes: "x".repeat(200) }).success).toBe(true);
  });

  it("Update: 201 chars esueaza", () => {
    expect(JobUpdateBodySchema.safeParse({ notes: "x".repeat(201) }).success).toBe(false);
  });

  it("Update: notes=null trece (stergere explicita)", () => {
    expect(JobUpdateBodySchema.safeParse({ notes: null }).success).toBe(true);
  });
});
