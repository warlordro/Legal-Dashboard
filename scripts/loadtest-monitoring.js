// k6 load test for the monitoring CRUD + manual-trigger surface.
//
// Goal: validate that the Hono router + better-sqlite3 path holds the
// CP-7 envelope (p95 < 500ms, error rate < 1%) at 1000 jobs and ~50 RPS
// of mixed reads + manual-runs. This is what gates web-mode deploy: a
// stop-the-world locked SQLite write would otherwise show up here and
// kill the cutover plan.
//
// HOW TO RUN (NOT executed in CI yet — manual smoke):
//   1. Start the backend with monitoring enabled:
//        MONITORING_ENABLED=1 npm run dev:backend
//   2. Seed 1000 jobs (k6 setup() does this once for the test run).
//   3. Run the load profile:
//        k6 run scripts/loadtest-monitoring.js
//
// THRESHOLDS (CP-7 standard):
//   - http_req_duration p(95) < 500ms
//   - http_req_failed rate    < 1%
// Run is FAIL if either threshold is breached.
//
// NOT covered here:
//   - Concurrent claim contention from a real running scheduler tick
//     (manual-run + tick race is integration-tested in scheduler.test.ts).
//   - SOAP backend latency — runner is the NoopRunner shape under web mode.
//
// Config knobs via env:
//   BASE_URL=http://127.0.0.1:3002 (default)
//   AUTH_HEADER=...                (sets Authorization on every req if set)

import http from "k6/http";
import { check, sleep } from "k6";
import { SharedArray } from "k6/data";
import { randomIntBetween } from "https://jslib.k6.io/k6-utils/1.4.0/index.js";

const BASE_URL = __ENV.BASE_URL || "http://127.0.0.1:3002";
const AUTH = __ENV.AUTH_HEADER || "";
const SEED_COUNT = 1000;

export const options = {
  scenarios: {
    mixed: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 25 }, // warmup
        { duration: "60s", target: 50 }, // steady
        { duration: "30s", target: 0 }, // ramp down
      ],
      gracefulRampDown: "10s",
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<500"],
    http_req_failed: ["rate<0.01"],
  },
};

function jsonHeaders() {
  const h = { "Content-Type": "application/json" };
  if (AUTH) h["Authorization"] = AUTH;
  return h;
}

// setup() runs ONCE before VUs start. Seeds the 1000 jobs.
export function setup() {
  const ids = [];
  for (let i = 0; i < SEED_COUNT; i++) {
    const sector = (i % 6) + 1; // 1..6
    const body = {
      kind: "dosar_soap",
      target: { numar_dosar: `${10000 + i}/${100 + sector}/2024` },
      cadence_sec: 14400,
      client_request_id: `loadtest-seed-${i}`,
    };
    const res = http.post(
      `${BASE_URL}/api/v1/monitoring/jobs`,
      JSON.stringify(body),
      { headers: jsonHeaders() },
    );
    if (res.status !== 201 && res.status !== 200) {
      throw new Error(
        `seed failed at i=${i}: status=${res.status} body=${res.body}`,
      );
    }
    const parsed = res.json();
    ids.push(parsed.data.id);
  }
  return { ids };
}

// Per-VU loop: 80% list reads, 15% single GET, 5% manual run.
export default function (data) {
  const ids = data.ids;
  const r = Math.random();

  if (r < 0.8) {
    // Listing — the most common dashboard call.
    const page = randomIntBetween(1, 20);
    const res = http.get(
      `${BASE_URL}/api/v1/monitoring/jobs?page=${page}&pageSize=50&active=true`,
      { headers: jsonHeaders() },
    );
    check(res, {
      "list 200": (r) => r.status === 200,
      "list has rows": (r) => Array.isArray(r.json("data.rows")),
    });
  } else if (r < 0.95) {
    // Single GET.
    const id = ids[randomIntBetween(0, ids.length - 1)];
    const res = http.get(`${BASE_URL}/api/v1/monitoring/jobs/${id}`, {
      headers: jsonHeaders(),
    });
    check(res, { "get 200": (r) => r.status === 200 });
  } else {
    // Manual trigger. Many will collide with in-flight (409) — that is
    // legitimate, NOT a failure: the route is doing its job. Accept 202
    // and 409 alike. 503 (scheduler unavailable) is also acceptable in a
    // pure CRUD smoke run that didn't enable the scheduler.
    const id = ids[randomIntBetween(0, ids.length - 1)];
    const res = http.post(
      `${BASE_URL}/api/v1/monitoring/jobs/${id}/run`,
      null,
      { headers: jsonHeaders() },
    );
    check(res, {
      "run 202/409/503": (r) =>
        r.status === 202 || r.status === 409 || r.status === 503,
    });
  }

  sleep(randomIntBetween(100, 300) / 1000);
}
