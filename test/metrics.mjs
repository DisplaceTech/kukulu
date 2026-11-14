// The usage record's contract (mcp/metrics.mjs). Later tasks add the adapter,
// the counters, METRICS.json and scripts/compare-flights.mjs.

import { finish, ok, eq } from "./harness.mjs";
import { METRICS_VERSION, USAGE_KEYS, validateUsageRecord } from "../mcp/metrics.mjs";

const example = () => ({
  v: 1,
  harness: "claude-code",
  session: "s-1",
  agent: "kukulu-implementer",
  role: "implementer",
  stage: "implement",
  round: 1,
  models: { "model-a": { requests: 41, input: 812345, output: 20991, cacheRead: 700112, cacheWrite: 9120 } },
  first: "2026-11-14T03:11:15.916Z",
  last: "2026-11-14T04:02:40.101Z",
  activeMs: 1432876,
  toolCalls: 388,
  toolErrors: 7,
  apiErrors: 0,
  cost: 4.812345,
});

eq(METRICS_VERSION, 1, "METRICS_VERSION is 1 and USAGE_KEYS lists the fifteen fields in order");
eq(USAGE_KEYS.join(","), "v,harness,session,agent,role,stage,round,models,first,last,activeMs,toolCalls,toolErrors,apiErrors,cost", "...in order");
eq(JSON.stringify(validateUsageRecord(example())), "[]", "SPEC B-01's example record is valid");
{
  const r = { ...example(), session: null, agent: null, stage: null, round: null, first: null, last: null, activeMs: null, toolCalls: null, toolErrors: null, apiErrors: null, cost: null };
  eq(JSON.stringify(validateUsageRecord(r)), "[]", "a record with every nullable field null is valid");
}
eq(JSON.stringify(validateUsageRecord({ v: 1, harness: "claude-code", session: null, agent: null, role: "controller", error: "unreadable" })), "[]", "an error record is valid");

const bad = (name, field, mutate) => {
  const r = example();
  const m = mutate(r);
  const out = m === undefined ? r : m;
  const problems = validateUsageRecord(out);
  ok(problems.some((p) => p.startsWith(`${field}:`) || p.startsWith(`${field}.`)), `validateUsageRecord names the field: ${name} (${problems.join("; ")})`);
};
bad("v 2", "v", (r) => { r.v = 2; });
bad("an empty harness", "harness", (r) => { r.harness = ""; });
bad("role null", "role", (r) => { r.role = null; });
bad("role 'operator'", "role", (r) => { r.role = "operator"; });
bad("round -1", "round", (r) => { r.round = -1; });
bad("a models entry missing cacheWrite", "models", (r) => { delete r.models["model-a"].cacheWrite; });
bad("a negative input", "models", (r) => { r.models["model-a"].input = -1; });
bad("activeMs 1.5", "activeMs", (r) => { r.activeMs = 1.5; });
bad("cost -1", "cost", (r) => { r.cost = -1; });
bad("first 'yesterday at noon'", "first", (r) => { r.first = "yesterday at noon"; });
bad("an unknown key", "extra", (r) => { r.extra = 1; });
bad("a missing key", "cost", (r) => { delete r.cost; });
bad("an error record with an extra key", "stage", () => ({ v: 1, harness: "h", session: null, agent: null, role: "planner", error: "x", stage: "plan" }));
bad("an array", "record", () => []);
bad("null", "record", () => null);

{
  let threw = false;
  try {
    for (const x of [undefined, 1, "x", { models: 5 }, { error: 1 }, { models: { a: null } }, Object.create(null)]) validateUsageRecord(x);
  } catch { threw = true; }
  ok(!threw, "validateUsageRecord never throws");
}

finish();
