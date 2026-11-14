// The usage record's contract (mcp/metrics.mjs). Later tasks add the adapter,
// the counters, METRICS.json and scripts/compare-flights.mjs.

import fs from "node:fs";
import path from "node:path";
import { finish, ok, eq, like, ROOT, mkDir, cleanroomRepo, plannedRepo, runHook, setState } from "./harness.mjs";
import { rolesUsage } from "../mcp/cleanroom.mjs";
import { METRICS_VERSION, USAGE_KEYS, validateUsageRecord, buildMetrics } from "../mcp/metrics.mjs";

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

// ---------------------------------------------------------------- general mode (P0-03)

{
  const hook = (repo, payload, env = {}) => runHook(LOGGER, { hook_event_name: "SubagentStop", agent_type: "kukulu-implementer", agent_transcript_path: FULL, session_id: "s-1", cwd: repo, ...payload }, { CLAUDE_PROJECT_DIR: repo, CLAUDE_PLUGIN_ROOT: ROOT, HOME: mkDir("kukulu-home-"), ...env });
  const lines = (repo) => (fs.existsSync(path.join(repo, ".kukulu", "metrics", "usage.jsonl")) ? fs.readFileSync(path.join(repo, ".kukulu", "metrics", "usage.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  const repo = plannedRepo();
  setState(repo, { round: 0, timeline: [{ event: "start", stage: "implement", round: 0 }] });
  const r = hook(repo, {});
  eq(r.status, 0, "the hook exits 0 in general mode");
  const got = lines(repo);
  eq(got.length, 1, "general mode appends one usage record on SubagentStop");
  eq(JSON.stringify(validateUsageRecord(got[0])), "[]", "...valid by validateUsageRecord");
  eq(got[0].activeMs + "|" + got[0].role + "|" + got[0].stage + "|" + got[0].round, "17000|implementer|implement|0", "...equal to the adapter's record");
  hook(repo, {});
  eq(lines(repo).length, 2, "a second stop appends a second line");
  hook(repo, { agent_type: "general-purpose" });
  hook(repo, { agent_type: undefined });
  eq(lines(repo).length, 2, "another agent type writes nothing");
  const post = runHook(LOGGER, { hook_event_name: "PostToolUse", tool_name: "Read", tool_input: {}, cwd: repo }, { CLAUDE_PROJECT_DIR: repo, HOME: mkDir("kukulu-home-") });
  eq(post.status + "|" + lines(repo).length, "0|2", "PostToolUse writes nothing");
  const bad = hook(repo, { agent_transcript_path: path.join(repo, "nope.jsonl") });
  eq(bad.status + "|" + bad.stdout + bad.stderr, "0|", "an unreadable transcript exits 0 silently");
  eq(Object.keys(lines(repo).at(-1)).join(","), "v,harness,session,agent,role,error", "...and appends the error record");
  const sock = hook(repo, {}, { KUKULU_LOG_SOCKET: path.join(mkDir("kukulu-sock-"), "x.sock") });
  eq(sock.status + "|" + lines(repo).length, "0|3", "KUKULU_LOG_SOCKET set: exit 0 and no file written");
  const plain = mkDir("kukulu-plain-");
  const none = hook(plain, {});
  eq(none.status + "|" + none.stdout + none.stderr + "|" + fs.existsSync(path.join(plain, ".kukulu")), "0||false", "no docs/kukulu.json: exit 0, no file, no output");
  const cr = stopRepo();
  stop(cr);
  eq(fs.existsSync(path.join(cr, ".kukulu", "metrics", "usage.jsonl")), false, "clean-room mode writes no usage.jsonl line");
  eq(logOf(cr).filter((e) => e.kind === "usage").length, 1, "...and the chain has the entry");
}

// ---------------------------------------------------------------- the controller on Stop (P0-04)

{
  const env = (repo) => ({ CLAUDE_PROJECT_DIR: repo, CLAUDE_PLUGIN_ROOT: ROOT, HOME: mkDir("kukulu-home-") });
  const stopHook = (repo, extra = {}) => runHook(LOGGER, { hook_event_name: "Stop", transcript_path: FULL, session_id: "s-c", cwd: repo, ...extra }, env(repo));
  const lines = (repo) => (fs.existsSync(path.join(repo, ".kukulu", "metrics", "usage.jsonl")) ? fs.readFileSync(path.join(repo, ".kukulu", "metrics", "usage.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  const repo = plannedRepo();
  setState(repo, { round: 1, timeline: [{ event: "start", stage: "review", round: 1 }] });
  const r = stopHook(repo);
  eq(r.status + "|" + r.stdout + r.stderr, "0|", "Stop exits 0 silently in general mode");
  const want = {
    v: 1, harness: "claude-code", session: "s-c", agent: null, role: "controller", stage: "review", round: 1,
    models: {
      "m-one": { requests: 2, input: 300, output: 40, cacheRead: 1000, cacheWrite: 50 },
      "<synthetic>": { requests: 1, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      "m-two": { requests: 1, input: 10, output: 5, cacheRead: 5, cacheWrite: 0 },
    },
    first: "2026-11-14T10:00:04.000Z", last: "2026-11-14T10:00:20.000Z", activeMs: 18000, toolCalls: 3, toolErrors: 1, apiErrors: 1, cost: null,
  };
  eq(JSON.stringify(lines(repo)[0]), JSON.stringify(want), "Stop appends a controller record in general mode");
  eq(JSON.stringify(validateUsageRecord(lines(repo)[0])), "[]", "...and it is valid");
  ok(!("m-side" in lines(repo)[0].models), "a controller record skips sidechain rows");
  stopHook(repo);
  eq(lines(repo).length, 2, "two Stops of one session append two cumulative records");
  const plain = mkDir("kukulu-plain-");
  const quiet = stopHook(plain);
  eq(quiet.status + "|" + quiet.stdout + quiet.stderr + "|" + fs.existsSync(path.join(plain, ".kukulu")), "0||false", "Stop without docs/kukulu.json is silent");
  const cr = stopRepo();
  runHook(LOGGER, { hook_event_name: "Stop", transcript_path: FULL, session_id: "s-c", cwd: cr }, env(cr));
  const entry = logOf(cr).filter((e) => e.kind === "usage").at(-1);
  eq(entry.role + "|" + entry.data.role, "session|controller", "Stop in clean-room mode appends a usage entry with role session and data.role controller");
  eq(fs.existsSync(path.join(cr, ".kukulu", "metrics", "usage.jsonl")), false, "...and writes no usage.jsonl");
  const roles = rolesUsage(logOf(cr));
  eq(Object.values(roles).reduce((t, v) => t + v.usage.requests, 0), 0, "rolesUsage does not count the controller's entry");
}

// ---------------------------------------------------------------- buildMetrics (P2-04)

{
  const fixture = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, "test", "fixtures", "metrics", name), "utf8"));
  const json = (x) => JSON.stringify(x);
  eq(json(buildMetrics(fixture("v0-8-0.inputs.json"))), json(fixture("v0-8-0.expected.json")), "the recorded v0-8-0 flight builds to its exact metrics");
  const empty = buildMetrics({});
  eq(Object.keys(empty).join(","), "v,plugin,flight,spec,harness,usage,mode,enforcement,outcome,wall,rounds,roles,totals,tasks,friction,tree", "an empty input builds an object with every top-level key and no throw");
  eq(Object.keys(buildMetrics()).length, 16, "...also with no argument");
  eq(json(empty.wall), '{"startedAt":null,"endedAt":null,"seconds":null,"stageSeconds":null,"activateSeconds":null,"idleSeconds":null}', "no timeline gives null wall fields");

  const at = (sec) => `2026-01-01T00:${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}.000Z`;
  const tl = [
    { event: "start", stage: "plan", round: 0, at: at(0) },
    { event: "end", stage: "plan", round: 0, at: at(10) },
    { event: "activate", stage: "implement", round: 0, runner: "spark", served: "s", reported: "s", ms: 2400, ok: true, at: at(12) },
    { event: "activate", stage: "implement", round: 0, runner: "spark", served: "s", reported: null, ms: 9000, ok: false, at: at(13) },
    { event: "start", stage: "implement", round: 0, at: at(14) },
    { event: "end", stage: "implement", round: 0, at: at(114) },
    { event: "start", stage: "review", round: 0, at: at(120) },
    { event: "end", stage: "review", round: 0, at: at(150) },
    { event: "start", stage: "implement", round: 1, at: at(160) },
    { event: "end", stage: "implement", round: 1, at: at(190) },
    { event: "start", stage: "review", round: 1, at: at(200) },
  ];
  const rounds = [
    { round: 1, fixTasks: 2, sources: { review: 2, mutation: 0, blocked: 0 }, verdict: "CHANGES REQUESTED" },
    { round: 2, fixTasks: 0, verdict: "APPROVED", nonConverging: false },
  ];
  const withNow = buildMetrics({ state: { timeline: tl, rounds, round: 1, verdict: "APPROVED" }, now: at(260) });
  eq(withNow.wall.endedAt + "|" + withNow.wall.seconds, `${at(260)}|260`, "an open span counts to now and endedAt is now");
  eq(json(withNow.wall.stageSeconds), '{"plan":10,"implement":130,"review":90}', "...in the stage seconds");
  eq(json(withNow.wall.activateSeconds), '{"spark":2}', "activate records are no span and sum per runner, ok ones only (2.4 s rounds to 2)");
  eq(withNow.wall.idleSeconds, 260 - 230 - 2, "idleSeconds is seconds minus stage and activate seconds");
  const noNow = buildMetrics({ state: { timeline: tl } });
  eq(noNow.wall.endedAt + "|" + json(noNow.wall.stageSeconds), `${at(200)}|{"plan":10,"implement":130,"review":30}`, "an open span without now ends at the last record and is left out of the stage seconds");
  eq(json(withNow.rounds.map((r) => [r.round, r.implementSeconds, r.reviewSeconds])), "[[1,100,30],[2,30,60]]", "a round's implement and review seconds come from the spans of the round before it");
  eq(withNow.rounds[0].nonConverging + "|" + json(withNow.rounds[1].sources), "false|null", "...with nonConverging false and sources null when absent");
  eq(withNow.outcome.approvedAtRound, 2, "approvedAtRound is the first APPROVED round");
  eq(buildMetrics({ state: { rounds: [{ round: 1, verdict: "CHANGES REQUESTED" }] } }).outcome.approvedAtRound, null, "...else null");
  const halted = buildMetrics({ state: { halted: "round 4 exceeds the hard cap", verdict: "CHANGES REQUESTED", round: 3, rounds: [{ round: 1, verdict: "CHANGES REQUESTED" }] }, caps: { maxRounds: 3, maxRoundsHard: 6 } });
  eq(halted.outcome.halted + "|" + halted.outcome.approvedAtRound + "|" + json(halted.outcome.caps), 'round 4 exceeds the hard cap|null|{"maxRounds":3,"maxRoundsHard":6}', "a halted flight keeps its halt reason and a null approvedAtRound");
  const fb = buildMetrics({ feedback: [{ category: "tool-refusal" }, { category: "restart" }, { category: "tool-refusal" }] });
  eq(json(fb.friction.feedback), '{"restart":1,"runner-drift":0,"tool-refusal":2}', "feedback is counted by category with restart and runner-drift always present");
  eq(json(buildMetrics({ feedback: [] }).friction.feedback), '{"restart":0,"runner-drift":0}', "...also with no entries");
  const nullCounters = buildMetrics({ counters: null });
  eq(json([nullCounters.friction.guardReblocks, nullCounters.friction.verifyRuns, nullCounters.tasks.reopened]), "[null,null,null]", "counters null gives null friction counters, never 0");
  const counted = buildMetrics({ counters: { verifyRuns: 5, verifyFailures: 2, guardReblocks: null, tasksReopened: 1, activateFailures: 0 } });
  eq(json([counted.friction.verifyRuns, counted.friction.verifyFailures, counted.friction.guardReblocks, counted.friction.activateFailures, counted.tasks.reopened]), "[5,2,null,0,1]", "...and each counter passes through, a null one staying null");
  const MB = "a".repeat(40);
  const tree = buildMetrics({ git: { commits: 58, shortstat: " 31 files changed, 2904 insertions(+), 112 deletions(-)", mergeBase: MB } }).tree;
  eq(json(tree), '{"commits":58,"filesChanged":31,"insertions":2904,"deletions":112}', "the shortstat line parses");
  eq(json(buildMetrics({ git: { commits: 1, shortstat: " 1 file changed, 3 insertions(+)", mergeBase: MB } }).tree), '{"commits":1,"filesChanged":1,"insertions":3,"deletions":0}', "...with an omitted part as 0");
  eq(json(buildMetrics({ git: { commits: 0, shortstat: "", mergeBase: MB } }).tree), '{"commits":0,"filesChanged":0,"insertions":0,"deletions":0}', "...an empty line as zeros");
  eq(json(buildMetrics({ git: { commits: 4, shortstat: " 1 file changed", mergeBase: null } }).tree), '{"commits":null,"filesChanged":null,"insertions":null,"deletions":null}', "a null merge base gives a null tree");
  ok(!/\b[0-9a-f]{40}\b/.test(json(buildMetrics({ plugin: "0.9.0", flight: "v0-9-0", git: { commits: 3, shortstat: " 1 file changed, 1 insertion(+)", mergeBase: MB }, state: { rounds }, spec: { title: "t", sha256: "b".repeat(64) } }))), "no 40-hex string is in the output");
  const gen = (g) => buildMetrics({ genesis: g });
  eq(json([buildMetrics({}).mode, buildMetrics({}).enforcement, gen({}).mode, gen({}).enforcement, gen({ mode: "control-positive", enforcement: "container+proxy" }).mode, gen({ enforcement: null }).enforcement]), '["general",null,"clean-room","hook","control-positive",null]', "mode and enforcement come from genesis, with the 0.7.x defaults");
  eq(json(buildMetrics({ state: { harness: [{ name: "claude-code", version: "1" }] } }).harness), '[{"name":"claude-code","version":"1"}]', "the harness list is state.harness");
}

finish();
