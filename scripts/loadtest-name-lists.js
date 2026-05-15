// k6 load test for PR-5 bulk name import.
//
// Covers the hot API trio:
//   - POST /api/v1/name-lists/preview (multipart CSV)
//   - POST /api/v1/name-lists/commit  (idempotent create + auto jobs)
//   - GET  /api/v1/name-lists         (dashboard list)
//
// Run:
//   MONITORING_ENABLED=1 npm run dev:backend
//   k6 run scripts/loadtest-name-lists.js
//
// Thresholds:
//   - p95 < 500ms
//   - error rate < 1%

import http from "k6/http";
import { check, sleep } from "k6";
import { randomIntBetween } from "https://jslib.k6.io/k6-utils/1.4.0/index.js";

const BASE_URL = __ENV.BASE_URL || "http://127.0.0.1:3002";
const AUTH = __ENV.AUTH_HEADER || "";

export const options = {
  scenarios: {
    bulk_import: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "20s", target: 10 },
        { duration: "60s", target: 25 },
        { duration: "20s", target: 0 },
      ],
      gracefulRampDown: "10s",
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<500"],
    http_req_failed: ["rate<0.01"],
  },
};

function headers(extra = {}) {
  const h = { ...extra };
  if (AUTH) h.Authorization = AUTH;
  return h;
}

function csvFor(iteration) {
  const rows = ["nume,cnp,cui"];
  for (let i = 0; i < 20; i++) {
    rows.push(`Persoana Bulk ${iteration}-${i},,`);
  }
  rows.push(`Persoana Bulk ${iteration}-0,,`);
  rows.push("1,,");
  return `${rows.join("\n")}\n`;
}

export default function () {
  const iteration = `${__VU}-${__ITER}-${Date.now()}`;
  const csv = csvFor(iteration);

  const previewRes = http.post(
    `${BASE_URL}/api/v1/name-lists/preview`,
    {
      file: http.file(csv, `lista-${iteration}.csv`, "text/csv"),
    },
    { headers: headers() }
  );
  check(previewRes, {
    "preview 200": (r) => r.status === 200,
    "preview totals": (r) => Number(r.json("data.totals.total")) === 22,
  });
  if (previewRes.status !== 200) {
    sleep(1);
    return;
  }

  const preview = previewRes.json("data");
  const rows = preview.rows
    .filter((row) => row.validation !== "rejected")
    .map((row) => ({ nameRaw: row.nameRaw, cnp: row.cnp, cui: row.cui }));

  const commitRes = http.post(
    `${BASE_URL}/api/v1/name-lists/commit`,
    JSON.stringify({
      title: `Load ${iteration}`,
      sourceFilename: preview.sourceFilename,
      sourceSha256: preview.sha256,
      items: rows,
      autoCreateJobs: true,
      maxJobs: 100,
    }),
    { headers: headers({ "Content-Type": "application/json" }) }
  );
  check(commitRes, {
    "commit 200/201": (r) => r.status === 200 || r.status === 201,
    "commit creates jobs": (r) => Number(r.json("data.jobsTotal")) >= 20,
  });

  const page = randomIntBetween(1, 5);
  const listRes = http.get(`${BASE_URL}/api/v1/name-lists?page=${page}&pageSize=20`, { headers: headers() });
  check(listRes, {
    "list 200": (r) => r.status === 200,
    "list rows array": (r) => Array.isArray(r.json("data.rows")),
  });

  sleep(randomIntBetween(100, 300) / 1000);
}
