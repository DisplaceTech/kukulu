// The usage record's contract (mcp/metrics.mjs). Later tasks add the adapter,
// the counters, METRICS.json and scripts/compare-flights.mjs.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { finish, ok, eq, like, ROOT, mkDir, mkRepo, cleanroomRepo, plannedRepo, runHook, setState, withServer, writeFile, readFile, hasFile, markTasks, git, buildBundle } from "./harness.mjs";
import { rolesUsage, appendEntry, readEntries } from "../mcp/cleanroom.mjs";
import { METRICS_VERSION, USAGE_KEYS, validateUsageRecord, buildMetrics, usageFromChain, compareMetrics } from "../mcp/metrics.mjs";

const json = (x) => JSON.stringify(x);
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

// ---------------------------------------------------------------- usage, roles and totals (P2-05)

{
  const fixture = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, "test", "fixtures", "metrics", name), "utf8"));
  const json = (x) => JSON.stringify(x);
  const full = fixture("full.inputs.json");
  const rec = (role, models, extra = {}) => ({ v: 1, harness: "claude-code", session: `s-${role}`, agent: role === "controller" ? null : `kukulu-${role}`, role, stage: "implement", round: 0, models, first: "2026-11-14T10:00:00.000Z", last: "2026-11-14T10:30:00.000Z", activeMs: 10000, toolCalls: 1, toolErrors: 0, apiErrors: 0, cost: 0.5, ...extra });
  const m = (requests, input, output, cacheRead = 0, cacheWrite = 0) => ({ requests, input, output, cacheRead, cacheWrite });
  const route = { implementer: { model: "spark/q", runner: "spark", locality: "local", family: "qwen" }, reviewer: { model: "opus", runner: "anthropic", locality: "remote", family: "claude" } };
  const build = (records, extra = {}) => buildMetrics({ routing: route, usage: { source: "chain", chainHead: null, records }, ...extra });

  const b = build([rec("implementer", { "q-a": m(3, 100, 40, 10, 5), "q-b": m(1, 20, 10) }), rec("implementer", { "q-a": m(2, 5, 5) }, { activeMs: 5000 })]);
  eq(json([b.roles.implementer.requests, b.roles.implementer.input, b.roles.implementer.output, b.roles.implementer.cacheRead, b.roles.implementer.cacheWrite]), "[6,125,55,10,5]", "a role's entry sums its records' models");
  eq(json(b.roles.implementer.reported), '["q-a","q-b"]', "...and lists the reported models sorted");
  eq(b.roles.implementer.activeSeconds + "|" + b.roles.implementer.outputPerActiveSecond, "15|3.7", "outputPerActiveSecond is output over active seconds, to one decimal (55 / 15 s)");
  eq(json(b.roles.implementer.toolCalls), "2", "tool counts sum");
  eq(json(b.roles.summarizer), json({ model: null, runner: null, locality: null, family: null, usage: null, reported: null, requests: null, input: null, output: null, cacheRead: null, cacheWrite: null, activeSeconds: null, outputPerActiveSecond: null, toolCalls: null, toolErrors: null, apiErrors: null, cost: null }), "a missing summarizer record gives usage null and every token field null");
  eq(json(b.totals.missing), '["planner","reviewer","summarizer","controller"]', "...and totals.missing lists the roles without records, in order");
  eq(json([b.totals.requests, b.totals.input, b.totals.output]), "[6,125,55]", "totals sum only the roles that have records");
  const none = buildMetrics({});
  eq(json([none.totals.requests, none.totals.input, none.totals.output, none.totals.missing.length, none.usage]), "[null,null,null,5,null]", "a flight with no usage records has every role missing and null totals, and usage is null without the input");
  eq(json(Object.keys(none.roles)), '["planner","implementer","reviewer","summarizer","controller"]', "roles has the five keys in USAGE_ROLES order");
  eq(build([rec("reviewer", { x: m(1, 1, 1) })]).roles.reviewer.cost, 0.5, "cost is the sum for a role on the anthropic runner");
  eq(build([rec("reviewer", { x: m(1, 1, 1) }, { cost: 0.1 }), rec("reviewer", { x: m(1, 1, 1) }, { cost: 0.2, session: "s2", first: "2026-11-14T11:00:00.000Z" })]).roles.reviewer.cost, 0.3, "...rounded to six decimals");
  eq(build([rec("implementer", { x: m(1, 1, 1) })]).roles.implementer.cost, null, "cost is null for a local runner even when the records carry one");
  eq(build([rec("reviewer", { x: m(1, 1, 1) }), rec("reviewer", { x: m(1, 1, 1) }, { cost: null, session: "s2" })]).roles.reviewer.cost, null, "cost is null when one record has none");
  eq(build([rec("controller", { x: m(1, 1, 1) })]).roles.controller.cost, null, "the controller's cost is null");
  const ctl = build([rec("controller", { x: m(1, 10, 1) }, { session: "A" }), rec("controller", { x: m(2, 30, 2) }, { session: "A" }), rec("controller", { x: m(4, 5, 4) }, { session: "B" })]);
  eq(json([ctl.roles.controller.requests, ctl.roles.controller.input, ctl.usage]), json([6, 35, { source: "chain", records: 2, chainHead: null }]), "the controller keeps the last record per session and sums across sessions (usage.records counts what was summed)");
  const rep = (source) => buildMetrics({ routing: route, usage: { source, chainHead: null, records: [rec("implementer", { x: m(1, 10, 1) }), rec("implementer", { x: m(3, 30, 3) })] } });
  eq(rep("usage.jsonl").roles.implementer.requests + "|" + rep("usage.jsonl").usage.records, "3|1", "in general mode a later record with the same session, agent and first supersedes the earlier one");
  eq(rep("chain").roles.implementer.requests + "|" + rep("chain").usage.records, "4|2", "from the chain every role record is summed");
  const bad = build([rec("implementer", { x: m(1, 1, 1) }), { v: 1, harness: "claude-code", session: null, agent: null, role: "implementer", error: "ENOENT" }, { ...rec("implementer", { x: m(9, 9, 9) }), v: 2 }, "junk", null]);
  eq(bad.roles.implementer.requests + "|" + bad.usage.records, "1|1", "an error record and an invalid record are not counted");
  eq(build([rec("implementer", { x: m(1, 1, 1) }, { activeMs: null })]).roles.implementer.outputPerActiveSecond, null, "outputPerActiveSecond is null without active time");
  eq(json(buildMetrics(fixture("v0-8-0.inputs.json"))), json(fixture("v0-8-0.expected.json")), "the v0-8-0 fixture still builds to its exact metrics");

  // every field of the object is named in docs/metrics.md
  const paths = new Set();
  const MAPS = { "wall.stageSeconds": "<stage>", "wall.activateSeconds": "<runner>", roles: "<role>", "friction.feedback": "<category>" };
  const walk = (value, at) => {
    if (value === null && MAPS[at]) return; // a null map is covered by the build that fills it
    if (Array.isArray(value)) {
      if (value.length && value[0] !== null && typeof value[0] === "object") walk(value[0], `${at}[]`);
      else paths.add(at);
    } else if (value !== null && typeof value === "object" && at !== "rounds[].sources") {
      const entries = Object.entries(value);
      if (MAPS[at]) for (const [, v] of entries.slice(0, 1)) walk(v, `${at}.${MAPS[at]}`);
      else for (const [k, v] of entries) walk(v, at ? `${at}.${k}` : k);
    } else paths.add(at);
  };
  walk(buildMetrics(full), "");
  walk(buildMetrics(fixture("v0-8-0.inputs.json")), "");
  const doc = fs.readFileSync(path.join(ROOT, "docs", "metrics.md"), "utf8");
  const absent = [...paths].filter((p) => !doc.includes(`\`${p}\``));
  eq(absent.join(", "), "", "docs/metrics.md names every field of METRICS.json");
  ok(paths.size > 60, `...walked ${paths.size} paths`);
}

// ---------------------------------------------------------------- kukulu_metrics (P2-06)

{
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const usageLine = (role, extra = {}) => JSON.stringify({ v: 1, harness: "claude-code", session: `s-${role}`, agent: role === "controller" ? null : `kukulu-${role}`, role, stage: "implement", round: 0, models: { "m-x": { requests: 2, input: 10, output: 5, cacheRead: 0, cacheWrite: 0 } }, first: "2026-11-14T10:00:00.000Z", last: "2026-11-14T10:10:00.000Z", activeMs: 1000, toolCalls: 3, toolErrors: 0, apiErrors: 0, cost: 0.25, ...extra });
  const repo = plannedRepo({ config: { verify: ["true"] } });
  writeFile(repo, ".kukulu/metrics/usage.jsonl", [usageLine("implementer"), "{not json", usageLine("reviewer"), usageLine("controller")].join("\n") + "\n");
  await withServer(repo, async ({ call }) => {
    const before = { status: git(repo, ["status", "--porcelain"]), head: git(repo, ["rev-parse", "HEAD"]), files: fs.readdirSync(path.join(repo, ".kukulu")).sort().join(",") };
    const m = await call("kukulu_metrics");
    eq(m.v + "|" + m.plugin, `1|${pkg.version}`, "kukulu_metrics returns the metrics object with v 1 and the plugin version");
    eq(m.usage.source + "|" + m.usage.records, "usage.jsonl|3", "it reads usage.jsonl in general mode, and a corrupt usage line is skipped");
    eq(m.roles.implementer.requests + "|" + m.roles.reviewer.requests + "|" + m.roles.controller.requests, "2|2|2", "...with the roles summed");
    eq(json(m.totals.missing), '["planner","summarizer"]', "...and the roles without a record missing");
    eq(m.roles.implementer.model !== null && m.roles.implementer.runner === "anthropic", true, "the routing facts come from the resolved routing");
    eq(m.mode + "|" + m.enforcement, "general|null", "a project without a genesis is general");
    const after = { status: git(repo, ["status", "--porcelain"]), head: git(repo, ["rev-parse", "HEAD"]), files: fs.readdirSync(path.join(repo, ".kukulu")).sort().join(",") };
    eq(json(after), json(before), "it writes nothing and moves no HEAD");
  });
  const fresh = mkRepo();
  await withServer(fresh, async ({ call }) => {
    const m = await call("kukulu_metrics");
    eq(json([m.spec, m.flight, m.caps ?? m.outcome.caps, m.tasks.total, m.wall.seconds, m.tree.filesChanged === 0 ? null : 1, m.counters ?? null, m.friction.verifyRuns]), "[null,null,null,null,null,null,null,null]", "in a fresh repository every sourceless field is null (a repository with no commits since the base has a tree of zeros)");
    eq(m.usage.records, 0, "...and no usage file is no records");
  });
  const bad = plannedRepo();
  writeFile(bad, "docs/kukulu.json", "{ not json");
  await withServer(bad, async ({ call }) => {
    const a = await call("kukulu_status");
    const b = await call("kukulu_metrics");
    eq(b.error, a.error, "it refuses what kukulu_status refuses");
    ok(typeof b.error === "string" && b.error.length > 0, "...with a message");
  });
  const build = plannedRepo({ config: { verify: ["true"] } });
  git(build, ["checkout", "-q", "-b", "build/2026-11-14"]);
  writeFile(build, "a.txt", "one\n");
  git(build, ["add", "-A"]);
  git(build, ["commit", "-qm", "P0-01: a"]);
  writeFile(build, "b.txt", "two\nthree\n");
  git(build, ["add", "-A"]);
  git(build, ["commit", "-qm", "P0-02: b"]);
  await withServer(build, async ({ call }) => {
    const m = await call("kukulu_metrics");
    eq(json(m.tree), '{"commits":2,"filesChanged":2,"insertions":3,"deletions":0}', "tree counts the commits since the merge base");
    ok(!/\b[0-9a-f]{40}\b/.test(json(m)), "...and no commit hash is in the output");
  });

  // after an archive the archived flight is read; once the next flight starts, the live one
  const flight = plannedRepo({ config: { verify: ["true"], flight: "w1-share", maxRounds: 4, maxRoundsHard: 5 } });
  git(flight, ["checkout", "-q", "-b", "build/2026-11-14"]);
  markTasks(flight, { "P0-01": "x", "P0-02": "x", "P0-03": "x" });
  writeFile(flight, "docs/HANDOFF.md", "# handoff\n");
  writeFile(flight, "docs/REVIEW.md", "# Review\nRound: 1\n**Verdict**: APPROVED\n");
  writeFile(flight, "docs/SUMMARY.md", "# summary\n");
  writeFile(flight, ".kukulu/feedback.jsonl", '{"at":"x","stage":"implement","round":0,"category":"stall","message":"m","source":"agent"}\n');
  setState(flight, { round: 0, implemented: true, reviewed: true, verdict: "APPROVED", summarized: true, rounds: [{ round: 1, fixTasks: 0, verdict: "APPROVED" }] });
  git(flight, ["add", "-A"]);
  git(flight, ["commit", "-qm", "chore: build summary"]);
  // a real flight's kukulu_run_start has excluded the directory by now
  fs.appendFileSync(path.join(flight, ".git", "info", "exclude"), ".kukulu/metrics/\n");
  writeFile(flight, ".kukulu/metrics/usage.jsonl", usageLine("implementer") + "\n");
  await withServer(flight, async ({ call }) => {
    ok(!(await call("kukulu_flight_archive", {})).error, "the flight archives");
    const m = await call("kukulu_metrics");
    eq(m.flight + "|" + json(m.outcome.caps) + "|" + m.outcome.verdict + "|" + m.tasks.total + "|" + m.friction.feedback.stall, 'w1-share|{"maxRounds":4,"maxRoundsHard":5}|APPROVED|3|1', "after an archive it reads the archived state, config and feedback");
    eq(m.usage.records + "|" + m.roles.implementer.requests, "1|2", "...and the live .kukulu/metrics/");
    writeFile(flight, "docs/SPEC.md", "# Next - Specification\n");
    git(flight, ["add", "-A"]);
    git(flight, ["commit", "-qm", "spec: the next flight"]);
    const next = await call("kukulu_next");
    eq(next.stage, "plan", "the next flight's first stage starts");
    const live = await call("kukulu_metrics");
    eq(json([live.flight, live.outcome.caps, live.tasks.total, live.spec.title]), '[null,null,null,"Next - Specification"]', "once the next flight's first stage has started, the live flight is read again");
  });
}

// ---------------------------------------------------------------- usage from the chain (P2-07)

{
  const m = (requests, input, output, cacheRead = 0, cacheWrite = 0) => ({ requests, input, output, cacheRead, cacheWrite });
  const entry = (role, data, extra = {}) => ({ kind: "usage", role, session: "s-1", stage: "implement", tool: null, decision: null, hash: "h".repeat(64), data, ...extra });
  const full = (role, models) => ({ v: 1, harness: "claude-code", session: "s-1", agent: role === "controller" ? null : `kukulu-${role}`, role, stage: "implement", round: 0, models, first: "2026-11-14T10:00:00.000Z", last: "2026-11-14T10:10:00.000Z", activeMs: 1000, toolCalls: 1, toolErrors: 0, apiErrors: 0, cost: 0.5 });
  const got = usageFromChain([
    entry("kukulu-implementer", full("implementer", { a: m(1, 2, 3) })),
    entry("kukulu:reviewer", full("reviewer", { a: m(1, 2, 3) })),
    entry("session", full("controller", { a: m(1, 2, 3) })),
    entry("session", { models: { a: m(1, 1, 1) } }),
    entry("kukulu-planner", { error: "ENOENT: no such file\nmore" }),
    entry("general-purpose", full("implementer", { a: m(9, 9, 9) })),
    { kind: "allowed", role: "kukulu-implementer", hash: "x".repeat(64) },
  ]);
  eq(json(got.records.map((r) => [r.role, r.agent])), '[["implementer","kukulu-implementer"],["reviewer","kukulu:reviewer"],["controller",null],["planner","kukulu-planner"]]', "usageFromChain maps role agents and the controller and skips other entries");
  eq(json(got.records[3]), '{"v":1,"harness":"unknown","session":"s-1","agent":"kukulu-planner","role":"planner","error":"ENOENT: no such file"}', "...an entry holding an error becomes the error form");
  const old = usageFromChain([entry("kukulu-implementer", { models: { a: m(2, 10, 5) }, first: "2026-01-01T00:00:00.000Z", last: "2026-01-01T00:01:00.000Z", cost: 0.5 })]);
  eq(json(Object.keys(old.records[0])) + "|" + validateUsageRecord(old.records[0]).length, json(USAGE_KEYS) + "|0", "a 0.8.x usage entry still counts, with the missing fields null");
  eq(json([old.records[0].activeMs, old.records[0].stage, old.records[0].harness, old.records[0].session]), '[null,null,"unknown","s-1"]', "...");
  eq(usageFromChain([entry("kukulu-implementer", {}, { hash: "1".repeat(64) }), entry("kukulu-reviewer", {}, { hash: "2".repeat(64) })]).chainHead, "2".repeat(64), "chainHead is the last entry's hash");
  eq(usageFromChain([]).chainHead + "|" + usageFromChain(undefined).records.length, "null|0", "...and null for no entries");

  // the per-role sums equal the verifier's recount of the same log
  const ROLES4 = ["planner", "implementer", "reviewer", "summarizer"];
  const routed = Object.fromEntries(ROLES4.map((role) => [role, { model: "opus", runner: "anthropic", endpoint: "https://api.anthropic.com", locality: "remote", identity: { source: "vendor-asserted" }, family: "claude" }]));
  const old8 = (log, role, models, cost) => appendEntry(log, { kind: "usage", stage: "implement", role, tool: null, decision: null, data: { models, first: "2026-01-01T00:00:00.000Z", last: "2026-01-01T00:01:00.000Z", cost } });
  const b = buildBundle(path.join(mkDir("kukulu-bundle-"), "bundle"), { roles: routed, extra: (log) => {
    old8(log, "kukulu-implementer", { opus: m(3, 100, 40, 10, 5) }, 0.5);
    old8(log, "kukulu:implementer", { opus: m(1, 20, 10) }, 0.25);
    old8(log, "kukulu-reviewer", { opus: m(2, 7, 3) }, 0.1);
    appendEntry(log, { kind: "usage", stage: "review", role: "session", tool: null, decision: null, data: { ...full("controller", { opus: m(50, 9999, 999) }) } });
  } });
  const chain = usageFromChain(b.entries);
  const built = buildMetrics({ usage: { source: "chain", ...chain } });
  const recount = rolesUsage(b.entries);
  const sums = (u) => ["requests", "input", "output", "cacheRead", "cacheWrite"].map((k) => u[k]);
  eq(json(ROLES4.map((r) => (built.roles[r].usage === null ? null : sums(built.roles[r])))), json(ROLES4.map((r) => (recount[r].usage.requests === 0 ? null : sums(recount[r].usage)))), "each role's token sums equal rolesUsage's recount of the same log");
  eq(json(["implementer", "reviewer"].map((r) => sums(built.roles[r]))), json(["implementer", "reviewer"].map((r) => sums(b.manifest.roles[r].usage))), "...and the manifest's roles.<role>.usage");
  eq(built.usage.chainHead, b.entries.at(-1).hash, "usage.chainHead is the log's head");
  eq(built.roles.controller.requests, 50, "the controller's entry is counted for the controller only");

  // kukulu_metrics in clean-room mode
  const repo = cleanroomRepo();
  const env = { CLAUDE_PROJECT_DIR: repo, CLAUDE_PLUGIN_ROOT: ROOT, HOME: mkDir("kukulu-home-") };
  await withServer(repo, async ({ call }) => {
    await call("kukulu_next");
    const stopHook = (extra) => runHook(LOGGER, { hook_event_name: "SubagentStop", agent_type: "kukulu-implementer", agent_transcript_path: FULL, session_id: "s-9", cwd: repo, ...extra }, env);
    stopHook({});
    stopHook({ agent_type: "kukulu-reviewer" });
    runHook(LOGGER, { hook_event_name: "Stop", transcript_path: FULL, session_id: "s-9", cwd: repo }, env);
    writeFile(repo, ".kukulu/metrics/usage.jsonl", JSON.stringify(full("implementer", { stray: m(99, 99, 99) })) + "\n");
    const log = readEntries(path.join(repo, ".kukulu", "cleanroom", "log.jsonl"));
    const metrics = await call("kukulu_metrics");
    eq(metrics.usage.source + "|" + metrics.usage.chainHead + "|" + metrics.usage.records, `chain|${log.at(-1).hash}|3`, "kukulu_metrics in clean-room mode reports usage.source chain and the log's head");
    ok(!("stray" in Object.fromEntries(Object.values(metrics.roles).flatMap((r) => (r.reported ?? []).map((n) => [n, 1])))), "a stray usage.jsonl is not read in clean-room mode");
    eq(metrics.mode + "|" + metrics.enforcement, "clean-room|hook", "mode and enforcement come from the genesis entry");
    eq(metrics.roles.implementer.requests, 5, "...with the roles summed from the chain (the fixture transcript's five requests)");
    // after an archive the chain is read from the archived log
    setState(repo, { summarized: true, implemented: true, reviewed: true, verdict: "APPROVED", round: 0 });
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-qm", "chore: summarized"]);
    const archived = await call("kukulu_flight_archive", { slug: "cr-flight" });
    ok(!archived.error, `the clean-room flight archives${archived.error ? ` (${archived.error})` : ""}`);
    ok(hasFile(repo, "docs/flights/cr-flight/cleanroom/log.jsonl") && !hasFile(repo, ".kukulu/cleanroom/log.jsonl"), "...moving its log");
    const after = await call("kukulu_metrics");
    const archivedLog = readEntries(path.join(repo, "docs", "flights", "cr-flight", "cleanroom", "log.jsonl"));
    eq(after.usage.source + "|" + after.usage.records + "|" + after.usage.chainHead, `chain|3|${archivedLog.at(-1).hash}`, "after an archive the chain is read from the archived log (its head includes the archive checkpoint)");
    eq(after.mode + "|" + after.flight, "clean-room|cr-flight", "...with the archived flight's mode");
  });
}

// ---------------------------------------------------------------- compareMetrics and scripts/compare-flights.mjs (P2-10)

{
  const FIX = path.join(ROOT, "test", "fixtures", "metrics");
  const SCRIPT = path.join(ROOT, "scripts", "compare-flights.mjs");
  const A = path.join(FIX, "a.METRICS.json");
  const B = path.join(FIX, "b.METRICS.json");
  const a = JSON.parse(fs.readFileSync(A, "utf8"));
  const b = JSON.parse(fs.readFileSync(B, "utf8"));
  const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", cwd: ROOT });
  const rowOf = (c, section, label) => c.sections[section].find((r) => r.label === label);
  const before = JSON.stringify(a) + JSON.stringify(b);
  const c = compareMetrics(a, b);
  eq(json(Object.keys(c.sections)) + "|" + c.v, '["outcome","wall","rounds","roles","friction"]|1', "compareMetrics is pure and returns the five sections");
  eq(JSON.stringify(a) + JSON.stringify(b), before, "...leaving its inputs as they were");
  eq(json(c.header.sameSpec) + "|" + c.header.a.flight + "|" + c.header.b.mode, "false|flight-a|clean-room", "the header names each flight and says the specs differ");
  eq(rowOf(c, "roles", "implementer requests").diff, 180, "a numeric row's diff is b minus a");
  eq(rowOf(c, "outcome", "verdict").diff + "|" + rowOf(c, "roles", "implementer model").diff + "|" + rowOf(c, "outcome", "halted").diff, "=|differs|null", "an equal non-number is =, an unequal one differs, a null side has no diff");
  const sum = rowOf(c, "roles", "summarizer requests");
  eq(sum.a + "|" + sum.b + "|" + sum.diff, "6|not recorded|null", "a missing role is not recorded and its diff is null");
  eq(rowOf(c, "roles", "summarizer model").b, "sonnet", "...while its model, runner and family keep their values");
  const total = rowOf(c, "roles", "totals requests");
  eq(json(total.b) + "|" + total.diff, '{"value":407,"partial":["summarizer"]}|null', "a total that leaves a role out is partial, and has no diff");
  eq(json(c.sections.wall.map((r) => r.label)), '["seconds","stage plan","stage implement","stage review","stage summarize","activate spark","idle"]', "wall rows list the stages in order, then the runners");
  eq(rowOf(c, "rounds", "round 3 findings").b, null, "a round only one flight has is null on the other side");
  eq(json(compareMetrics(a, a).header.sameSpec) + "|" + json(compareMetrics({}, {}).header.sameSpec), "true|false", "the same spec hash is the same spec, and no hash is not");
  ok(compareMetrics(null, undefined).sections.outcome.length === 7, "compareMetrics never throws on a missing object");

  const text = run(A, B);
  eq(text.status + "|" + text.stdout, "0|" + fs.readFileSync(path.join(FIX, "compare.expected.txt"), "utf8"), "compare-flights prints the exact text for the two fixtures");
  eq(run(A, B, "--json").stdout, fs.readFileSync(path.join(FIX, "compare.expected.json"), "utf8"), "--json prints compareMetrics' exact object");
  const tmp = mkDir("kukulu-cmp-");
  fs.mkdirSync(path.join(tmp, "a"));
  fs.copyFileSync(A, path.join(tmp, "a", "METRICS.json"));
  eq(run(path.join(tmp, "a"), B).stdout, text.stdout, "a directory holding METRICS.json is read");
  ok(/different specs; the comparison below is not like for like/.test(text.stdout), "different spec hashes print the not-like-for-like line");
  ok(!/not like for like/.test(run(A, A).stdout), "the same spec prints no such line");
  ok(/summarizer requests +6 +not recorded/.test(text.stdout) && /totals requests +206 +407 partial \(summarizer not recorded\)/.test(text.stdout), "the text says not recorded and partial");
  for (const [name, args, re] of [
    ["one argument", [A], /^compare-flights: give exactly two flights\nusage: /],
    ["an unknown option", [A, B, "--wat"], /^compare-flights: unknown option --wat\nusage: /],
    ["a missing path", [A, path.join(tmp, "nope")], /^compare-flights: .*nope does not exist\n$/],
    ["a directory without METRICS.json", [A, tmp], /^compare-flights: .* has no METRICS\.json; pass the file, or a directory that holds one\n$/],
    ["a file that is not JSON", [A, (() => { const f = path.join(tmp, "x.json"); fs.writeFileSync(f, "{nope"); return f; })()], /^compare-flights: .*x\.json is not JSON \(/],
    ["a wrong version", [A, (() => { const f = path.join(tmp, "v2.json"); fs.writeFileSync(f, JSON.stringify({ ...a, v: 2 })); return f; })()], /^compare-flights: .*v2\.json is metrics version 2; this script reads version 1\n$/],
  ]) {
    const r = run(...args);
    ok(r.status === 2 && r.stdout === "" && re.test(r.stderr), `exit 2 for ${name}: ${r.stderr.split("\n")[0]}`);
  }
  const listing = (d) => fs.readdirSync(d, { recursive: true }).sort().join(",");
  const listed = listing(FIX);
  run(A, B);
  run(A, B, "--json");
  eq(listing(FIX), listed, "compare-flights writes no file");
}

// ---------------------------------------------------------------- compare-flights --trees (P2-11)

{
  const FIX = path.join(ROOT, "test", "fixtures", "metrics");
  const SIM = path.join(ROOT, "test", "fixtures", "similarity");
  const SCRIPT = path.join(ROOT, "scripts", "compare-flights.mjs");
  const A = path.join(FIX, "a.METRICS.json");
  const B = path.join(FIX, "b.METRICS.json");
  const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", cwd: ROOT });
  const r = run(A, B, "--trees", path.join(SIM, "a"), path.join(SIM, "b"));
  eq(r.status + "|" + r.stdout, "0|" + fs.readFileSync(path.join(FIX, "compare-trees.expected.txt"), "utf8"), "--trees on test/fixtures/similarity/a and b prints the exact sixth section");
  like(r.stdout, /\nTrees\n  files +2 +2 +0\n  lines +129 +125 +-4\n/, "...with the file and line counts and their difference");
  const self = run(A, B, "--trees", path.join(SIM, "b"), path.join(SIM, "b"));
  ok(/ngram_jaccard@5 +1\.0000/.test(self.stdout) && /ident_jaccard +1\.0000/.test(self.stdout), "--trees scores a tree against itself at 1.0000");

  // directories named .git, node_modules and target are skipped
  const tmp = mkDir("kukulu-trees-");
  for (const side of ["a", "b"]) fs.cpSync(path.join(SIM, side), path.join(tmp, side), { recursive: true });
  const countsOf = (out) => /files +(\d+) +(\d+)/.exec(out).slice(1).join(",");
  const base = countsOf(run(A, B, "--trees", path.join(tmp, "a"), path.join(tmp, "b")).stdout);
  for (const d of [".git", "node_modules", "target"]) {
    fs.mkdirSync(path.join(tmp, "a", d), { recursive: true });
    fs.writeFileSync(path.join(tmp, "a", d, "skipped.rs"), "fn skipped() {}\n");
  }
  eq(countsOf(run(A, B, "--trees", path.join(tmp, "a"), path.join(tmp, "b")).stdout), base, "--trees skips .git, node_modules and target");

  const js = JSON.parse(run(A, B, "--json", "--trees", path.join(SIM, "a"), path.join(SIM, "b")).stdout);
  eq(json([js.trees.a, js.trees.b]) + "|" + Object.keys(js.trees.similarity).length + "|" + json(Object.keys(js.sections)), '[{"files":2,"lines":129},{"files":2,"lines":125}]|7|["outcome","wall","rounds","roles","friction"]', "--json carries trees");
  eq(json(Object.keys(JSON.parse(run(A, B, "--json").stdout))), '["v","header","sections"]', "...and no trees without --trees");

  const bad = (name, args, re) => {
    const o = run(...args);
    ok(o.status === 2 && o.stdout === "" && re.test(o.stderr), `exit 2 for ${name}: ${o.stderr.split("\n")[0]}`);
  };
  bad("a --trees path that is not a directory", [A, B, "--trees", path.join(SIM, "a", "rle.rs"), path.join(SIM, "b")], /^compare-flights: .*rle\.rs is not a directory\n$/);
  bad("a missing --trees path", [A, B, "--trees", path.join(tmp, "nope"), path.join(SIM, "b")], /^compare-flights: .*nope is not a directory\n$/);
  const empty = path.join(tmp, "empty");
  fs.mkdirSync(empty);
  fs.writeFileSync(path.join(empty, "notes.txt"), "no source\n");
  bad("a tree with no source file", [A, B, "--trees", empty, path.join(SIM, "b")], /^compare-flights: .*empty has no file with a known source extension\n$/);
  bad("--trees with one directory", [A, B, "--trees", path.join(SIM, "a")], /^compare-flights: --trees takes two directories\nusage: /);

  // the script's language map equals the server's DEFAULT_SIMILARITY_LANGUAGES
  const pairsIn = (file, name) => {
    const text = fs.readFileSync(path.join(ROOT, file), "utf8");
    const body = new RegExp(`const ${name} = \\{([^}]*)\\};`).exec(text)?.[1] ?? "";
    return [...body.matchAll(/"(\.\w+)": "(\w+)"/g)].map((m) => `${m[1]}=${m[2]}`).sort().join(",");
  };
  const fromServer = pairsIn("mcp/server.mjs", "DEFAULT_SIMILARITY_LANGUAGES");
  ok(fromServer.length > 20, "the server's language map was found");
  eq(pairsIn("scripts/compare-flights.mjs", "TREE_LANGUAGES"), fromServer, "the script's language map equals the server's DEFAULT_SIMILARITY_LANGUAGES");
}

finish();
