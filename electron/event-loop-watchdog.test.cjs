// Run with: node --test electron/   (Node built-in test runner; no vitest/tsc —
// electron/*.js is CJS outside the backend TS/vitest harness).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { redactReportSecrets } = require("./event-loop-watchdog.js");

test("redactReportSecrets strips env + cmdline at top level and in nested workers", () => {
  const report = {
    environmentVariables: { LEGAL_DASHBOARD_JWT_SECRET: "supersecret", PATH: "/bin" },
    header: { commandLine: ["node", "--inspect", "main.js"], cwd: "/app" },
    javascriptStack: { frames: ["frame1"] },
    workers: [
      {
        environmentVariables: { SMTP_PASS: "leak-me" },
        header: { commandLine: ["worker", "secret-arg"] },
        javascriptStack: { frames: ["wframe"] },
        workers: [
          {
            environmentVariables: { ANTHROPIC_API_KEY: "sk-leak" },
            header: { commandLine: ["nested"] },
          },
        ],
      },
    ],
  };

  redactReportSecrets(report);

  // top-level secret channels removed
  assert.equal(report.environmentVariables, undefined);
  assert.equal(report.header.commandLine, undefined);
  // diagnostic value preserved
  assert.deepEqual(report.javascriptStack.frames, ["frame1"]);
  assert.equal(report.header.cwd, "/app");
  // nested worker redacted
  assert.equal(report.workers[0].environmentVariables, undefined);
  assert.equal(report.workers[0].header.commandLine, undefined);
  assert.deepEqual(report.workers[0].javascriptStack.frames, ["wframe"]);
  // doubly-nested worker redacted
  assert.equal(report.workers[0].workers[0].environmentVariables, undefined);
  assert.equal(report.workers[0].workers[0].header.commandLine, undefined);

  // serialized output carries no secret from any level
  const json = JSON.stringify(report);
  for (const secret of ["supersecret", "leak-me", "sk-leak", "secret-arg"]) {
    assert.ok(!json.includes(secret), `serialized report leaked: ${secret}`);
  }
});

test("redactReportSecrets handles missing/empty fields safely", () => {
  assert.doesNotThrow(() => redactReportSecrets(null));
  assert.doesNotThrow(() => redactReportSecrets(undefined));
  assert.doesNotThrow(() => redactReportSecrets({}));
  const r = { workers: [] };
  redactReportSecrets(r);
  assert.deepEqual(r.workers, []);
});
