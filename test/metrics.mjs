// The usage record's contract (mcp/metrics.mjs). Later tasks add the adapter,
// the counters, METRICS.json and scripts/compare-flights.mjs.

import fs from "node:fs";
import path from "node:path";
import { finish, ok, eq, like, ROOT, mkDir, cleanroomRepo, runHook, setState } from "./harness.mjs";
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

// ---------------------------------------------------------------- the adapter (P0-02)

const LOGGER = path.join(ROOT, "scripts", "cleanroom-log.mjs");
const FIXDIR = path.join(ROOT, "test", "fixtures", "transcripts");
const FULL = path.join(FIXDIR, "agent-full.jsonl");
const logOf = (repo) => fs.readFileSync(path.join(repo, ".kukulu", "cleanroom", "log.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const stopRepo = (timeline = [{ event: "start", stage: "implement", round: 0 }]) => {
  const repo = cleanroomRepo();
  setState(repo, { cleanroom: { genesis: "a".repeat(64) }, round: 0, timeline });
  return repo;
};
const stop = (repo, extra = {}) => {
  runHook(LOGGER, { hook_event_name: "SubagentStop", agent_type: "kukulu-implementer", agent_transcript_path: FULL, session_id: "s-1", cwd: repo, ...extra }, { CLAUDE_PROJECT_DIR: repo, CLAUDE_PLUGIN_ROOT: ROOT, HOME: mkDir("kukulu-home-") });
  return logOf(repo).filter((e) => e.kind === "usage").at(-1).data;
};
const withTranscript = (text) => {
  const f = path.join(mkDir("kukulu-tr-"), "t.jsonl");
  fs.writeFileSync(f, text);
  return f;
};

{
  const repo = stopRepo();
  const data = stop(repo);
  const want = {
    v: 1, harness: "claude-code", session: "s-1", agent: "kukulu-implementer", role: "implementer", stage: "implement", round: 0,
    models: {
      "m-one": { requests: 2, input: 300, output: 40, cacheRead: 1000, cacheWrite: 50 },
      "m-side": { requests: 1, input: 999, output: 999, cacheRead: 0, cacheWrite: 0 },
      "<synthetic>": { requests: 1, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      "m-two": { requests: 1, input: 10, output: 5, cacheRead: 5, cacheWrite: 0 },
    },
    first: "2026-11-14T10:00:04.000Z", last: "2026-11-14T10:00:20.000Z", activeMs: 17000, toolCalls: 4, toolErrors: 2, apiErrors: 1, cost: null,
  };
  eq(JSON.stringify(data), JSON.stringify(want), "the fixture transcript gives the exact usage record");
  eq(JSON.stringify(validateUsageRecord(data)), "[]", "the record passes validateUsageRecord");
  eq(data.models["m-one"].requests + "|" + data.models["m-one"].output, "2|40", "a repeated requestId is counted once, by its first row");
  eq(data.activeMs, 17000, "an attachment row before a request does not zero its active time");
  eq(data.cost, null, "a missing costUSD makes cost null");
  const sub = stop(repo, { agent_transcript_path: path.join(FIXDIR, "subagent.jsonl") });
  eq(sub.cost, 0.043, "every counted row with a costUSD gives the sum");
  eq(stop(repo, { agent_type: "kukulu:reviewer" }).role, "reviewer", "kukulu:reviewer maps to role reviewer");
  eq(stop(repo, { agent_type: "general-purpose" }).role, null, "another agent type gets role null");
  const bad = stop(repo, { agent_transcript_path: path.join(repo, "nope.jsonl") });
  eq(Object.keys(bad).join(","), "v,harness,session,agent,role,error", "an unreadable transcript gives the six-key error record");
  eq(JSON.stringify(validateUsageRecord(bad)), "[]", "...which validates");
  const empty = stop(repo, { agent_transcript_path: withTranscript('{"type":"user"}\n') });
  like(empty.error, /no assistant line with usage/, "a transcript with nothing to count gives the error record");
  eq(Object.keys(empty).join(","), "v,harness,session,agent,role,error", "...with six keys");
}
{
  // The log is only written once state holds a genesis, so "no state" is a state with neither round nor timeline.
  const repo = cleanroomRepo();
  setState(repo, { cleanroom: { genesis: "a".repeat(64) } });
  const d = stop(repo);
  eq(d.stage + "|" + d.round, "null|null", "a state with no round or timeline gives stage null and round null");
}
{
  const d = stop(stopRepo([{ event: "start", stage: "implement", round: 0 }, { event: "end", stage: "implement", round: 0 }]));
  eq(d.stage, null, "a closed span gives stage null");
}

finish();
