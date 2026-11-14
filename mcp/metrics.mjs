// The usage record's contract: one schema for every harness, one adapter per
// harness. Pure on purpose: it reads nothing and writes nothing, so the hooks,
// the server and the comparison script can share it.

export const METRICS_VERSION = 1;
export const USAGE_ROLES = ["planner", "implementer", "reviewer", "summarizer", "controller"];
export const USAGE_KEYS = [
  "v", "harness", "session", "agent", "role", "stage", "round", "models",
  "first", "last", "activeMs", "toolCalls", "toolErrors", "apiErrors", "cost",
];
const ERROR_KEYS = ["v", "harness", "session", "agent", "role", "error"];
const MODEL_KEYS = ["requests", "input", "output", "cacheRead", "cacheWrite"];

const isPlain = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const isNat = (x) => Number.isInteger(x) && x >= 0;
const isText = (x) => typeof x === "string" && x.length > 0;

export function validateUsageRecord(record) {
  try {
    if (!isPlain(record)) return [`record: must be a plain object, got ${record === null ? "null" : Array.isArray(record) ? "an array" : typeof record}`];
    const problems = [];
    const isError = "error" in record;
    const want = isError ? ERROR_KEYS : USAGE_KEYS;
    for (const k of Object.keys(record)) if (!want.includes(k)) problems.push(`${k}: unknown key; ${isError ? "an error record" : "a usage record"} has only ${want.join(", ")}`);
    for (const k of want) if (!(k in record)) problems.push(`${k}: missing; every key of the record must be present (use null when unknown)`);
    const has = (k) => k in record;
    if (has("v") && record.v !== METRICS_VERSION) problems.push(`v: must be ${METRICS_VERSION}`);
    if (has("harness") && !isText(record.harness)) problems.push("harness: must be a non-empty string");
    for (const k of ["session", "agent"]) if (has(k) && record[k] !== null && !isText(record[k])) problems.push(`${k}: must be a non-empty string or null`);
    if (has("role") && !USAGE_ROLES.includes(record.role)) problems.push(`role: must be one of ${USAGE_ROLES.join(", ")}`);
    if (isError) {
      if (has("error") && !isText(record.error)) problems.push("error: must be a non-empty string");
      return problems;
    }
    if (has("stage") && record.stage !== null && !isText(record.stage)) problems.push("stage: must be a non-empty string or null");
    if (has("round") && record.round !== null && !isNat(record.round)) problems.push("round: must be an integer of at least 0 or null");
    if (has("models")) {
      if (!isPlain(record.models)) problems.push("models: must be a plain object");
      else {
        for (const [name, m] of Object.entries(record.models)) {
          if (!isPlain(m)) { problems.push(`models.${name}: must be a plain object`); continue; }
          for (const k of Object.keys(m)) if (!MODEL_KEYS.includes(k)) problems.push(`models.${name}.${k}: unknown key`);
          for (const k of MODEL_KEYS) {
            if (!(k in m)) problems.push(`models.${name}.${k}: missing`);
            else if (!isNat(m[k])) problems.push(`models.${name}.${k}: must be an integer of at least 0`);
          }
        }
      }
    }
    for (const k of ["first", "last"]) {
      if (has(k) && record[k] !== null && !(typeof record[k] === "string" && !Number.isNaN(Date.parse(record[k])))) problems.push(`${k}: must be a timestamp string Date.parse accepts, or null`);
    }
    for (const k of ["activeMs", "toolCalls", "toolErrors", "apiErrors"]) {
      if (has(k) && record[k] !== null && !isNat(record[k])) problems.push(`${k}: must be an integer of at least 0 or null`);
    }
    if (has("cost") && record.cost !== null && !(typeof record.cost === "number" && Number.isFinite(record.cost) && record.cost >= 0)) problems.push("cost: must be a number of at least 0 or null");
    return problems;
  } catch (e) {
    return [`record: could not be validated (${e?.message ?? e})`];
  }
}

// ---------------------------------------------------------------- METRICS.json

const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const secs = (ms) => Math.round(ms / 1000);
const stamp = (at) => (typeof at === "string" ? Date.parse(at) : NaN);

/** The timeline's spans (a `start` closed by the next `end`; `activate` records are neither), with an open one closed at `now` when it is given. */
function spansOf(timeline, now) {
  const spans = [];
  let open = null;
  for (const r of timeline) {
    if (!isObj(r)) continue;
    if (r.event === "start") open = r;
    else if (r.event === "end" && open) {
      spans.push({ stage: open.stage, round: open.round, ms: Math.max(0, stamp(r.at) - stamp(open.at)) });
      open = null;
    }
  }
  if (open && Number.isFinite(now)) spans.push({ stage: open.stage, round: open.round, ms: Math.max(0, now - stamp(open.at)) });
  return { spans, open };
}

function wallOf(timeline, nowText) {
  const none = { startedAt: null, endedAt: null, seconds: null, stageSeconds: null, activateSeconds: null, idleSeconds: null };
  if (!Array.isArray(timeline) || !timeline.length) return none;
  const records = timeline.filter((r) => isObj(r) && Number.isFinite(stamp(r.at)));
  if (!records.length) return none;
  const now = stamp(nowText);
  const { spans, open } = spansOf(records, now);
  const startedAt = records[0].at;
  const endedAt = open && Number.isFinite(now) ? nowText : records.at(-1).at;
  const seconds = secs(stamp(endedAt) - stamp(startedAt));
  const stageMs = {};
  for (const s of spans) stageMs[s.stage] = (stageMs[s.stage] ?? 0) + s.ms;
  const stageSeconds = Object.fromEntries(Object.entries(stageMs).map(([k, v]) => [k, secs(v)]));
  const activateMs = {};
  for (const r of records) if (r.event === "activate" && r.ok === true && typeof r.runner === "string" && Number.isFinite(r.ms)) activateMs[r.runner] = (activateMs[r.runner] ?? 0) + r.ms;
  const activateSeconds = Object.fromEntries(Object.entries(activateMs).map(([k, v]) => [k, secs(v)]));
  const sum = (o) => Object.values(o).reduce((t, v) => t + v, 0);
  return { startedAt, endedAt, seconds, stageSeconds, activateSeconds, idleSeconds: seconds - sum(stageSeconds) - sum(activateSeconds) };
}

function roundsOf(state, timeline, nowText) {
  if (!isObj(state) || !Array.isArray(state.rounds)) return null;
  const { spans } = spansOf(Array.isArray(timeline) ? timeline : [], stamp(nowText));
  const seconds = (stage, round) => {
    const mine = spans.filter((s) => s.stage === stage && s.round === round);
    return mine.length ? secs(mine.reduce((t, s) => t + s.ms, 0)) : null;
  };
  return state.rounds.map((r) => ({
    round: r.round ?? null,
    // Review round N reviews the build of timeline round N - 1: the build itself is round 0.
    implementSeconds: Number.isInteger(r.round) ? seconds("implement", r.round - 1) : null,
    reviewSeconds: Number.isInteger(r.round) ? seconds("review", r.round - 1) : null,
    findings: r.fixTasks ?? null,
    sources: r.sources ?? null,
    verdict: r.verdict ?? null,
    nonConverging: r.nonConverging ?? false,
  }));
}

function treeOf(git) {
  const none = { commits: null, filesChanged: null, insertions: null, deletions: null };
  if (!isObj(git) || git.mergeBase === null || git.mergeBase === undefined) return none;
  const commits = Number.isInteger(git.commits) ? git.commits : null;
  if (typeof git.shortstat !== "string") return { ...none, commits };
  const part = (re) => Number(re.exec(git.shortstat)?.[1] ?? 0);
  return {
    commits,
    filesChanged: part(/(\d+) files? changed/),
    insertions: part(/(\d+) insertions?\(\+\)/),
    deletions: part(/(\d+) deletions?\(-\)/),
  };
}

/**
 * Usage records from verified chain entries (SPEC B-05): one per `usage` entry of a role agent, and the controller's
 * (entry role `session`, `data.role` controller). An entry written by 0.8.x, whose data is `{ models, first, last, cost }`,
 * still counts, with the fields it lacks `null`. `chainHead` is the last entry's hash.
 */
export function usageFromChain(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const records = [];
  for (const e of list) {
    if (!isObj(e) || e.kind !== "usage") continue;
    const named = typeof e.role === "string" ? /^kukulu[-:](planner|implementer|reviewer|summarizer)$/.exec(e.role) : null;
    const data = isObj(e.data) ? e.data : {};
    let role;
    let agent = null;
    if (named) {
      role = named[1];
      agent = e.role;
    } else if (e.role === "session" && data.role === "controller") role = "controller";
    else continue;
    const base = { v: METRICS_VERSION, harness: data.harness ?? "unknown", session: e.session ?? null, agent, role };
    if (typeof data.error === "string" && data.error) {
      records.push({ ...base, error: data.error.split("\n")[0] });
      continue;
    }
    records.push(Object.fromEntries(USAGE_KEYS.map((k) => [k, k in base ? base[k] : (data[k] ?? null)])));
  }
  return { records, chainHead: list.length && typeof list.at(-1)?.hash === "string" ? list.at(-1).hash : null };
}

const TOKEN_KEYS = ["requests", "input", "output", "cacheRead", "cacheWrite"];
const PER_ROLE_NULLS = ["reported", ...TOKEN_KEYS, "activeSeconds", "outputPerActiveSecond", "toolCalls", "toolErrors", "apiErrors", "cost", "costSource"];

// ⚠️ ASSUMPTION: Anthropic first-party list prices, dollars per million tokens, as published on RATES_AS_OF.
// An adapter whose harness reports no cost leaves the record's cost null, so such a record is priced from its token
// counts here. Only claude-* ids are listed, so a local model is never priced. Cache writes are priced at the
// 1-hour TTL (twice input), the TTL every write in the recorded sessions used; Haiku 5.5's above-100K-token tier
// is not modelled.
export const RATES_AS_OF = "2026-11-03";
export const CACHE_WRITE_MULTIPLIER = 2;
export const RATES = {
  "claude-fable-5-2": { input: 8, output: 40, cacheRead: 0.2 },
  "claude-mythos-5-2": { input: 8, output: 40, cacheRead: 0.2 },
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25 },
  "claude-mythos-5-1": { input: 10, output: 50, cacheRead: 0.25 },
  "claude-fable-5": { input: 10, output: 50, cacheRead: 1 },
  "claude-mythos-5": { input: 10, output: 50, cacheRead: 1 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-opus-4-7": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-opus-4-6": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1 },
};

/** The rate of a reported model name: exact id after dropping a `[…]` suffix and a `-YYYYMMDD` date; `null` when unlisted. */
export function rateFor(name) {
  if (typeof name !== "string") return null;
  const id = name.toLowerCase().replace(/\[[^\]]*\]$/, "").replace(/-\d{8}$/, "");
  return Object.hasOwn(RATES, id) ? RATES[id] : null;
}

/** The list-price cost of a record's `models`, in dollars; `null` when a model with tokens has no rate. */
export function priceModels(models) {
  if (!isObj(models)) return null;
  let total = 0;
  for (const [name, m] of Object.entries(models)) {
    const tokens = m.input + m.output + m.cacheRead + m.cacheWrite;
    if (tokens === 0) continue; // an API-error row (`<synthetic>`) bills nothing
    const r = rateFor(name);
    if (!r) return null;
    total += (m.input * r.input + m.output * r.output + m.cacheRead * r.cacheRead + m.cacheWrite * r.input * CACHE_WRITE_MULTIPLIER) / 1e6;
  }
  return Math.round(total * 1e6) / 1e6;
}

/** The records that count: valid full records, the controller's last per session, and in general mode the last of a repeated stop. */
function countedRecords(usage) {
  const valid = (Array.isArray(usage?.records) ? usage.records : []).filter((r) => isObj(r) && !("error" in r) && validateUsageRecord(r).length === 0);
  const lastOf = (list, keyOf) => {
    const kept = new Map();
    for (const r of list) kept.set(keyOf(r), r);
    return [...kept.values()];
  };
  const controller = lastOf(valid.filter((r) => r.role === "controller"), (r) => String(r.session));
  const others = valid.filter((r) => r.role !== "controller");
  return [...(usage.source === "usage.jsonl" ? lastOf(others, (r) => JSON.stringify([r.session, r.agent, r.first])) : others), ...controller];
}

function rolesAndTotals(usage, routing) {
  const records = usage ? countedRecords(usage) : [];
  const roles = {};
  const missing = [];
  const sums = { requests: 0, input: 0, output: 0, cost: 0 };
  let costKnown = true;
  for (const role of USAGE_ROLES) {
    const route = role !== "controller" && isObj(routing) && isObj(routing[role]) ? routing[role] : {};
    const head = { model: route.model ?? null, runner: route.runner ?? null, locality: route.locality ?? null, family: route.family ?? null };
    const mine = records.filter((r) => r.role === role);
    if (!mine.length) {
      roles[role] = { ...head, usage: null, ...Object.fromEntries(PER_ROLE_NULLS.map((k) => [k, null])) };
      missing.push(role);
      continue;
    }
    const tokens = Object.fromEntries(TOKEN_KEYS.map((k) => [k, 0]));
    const reported = new Set();
    for (const r of mine) for (const [name, m] of Object.entries(r.models)) {
      reported.add(name);
      for (const k of TOKEN_KEYS) tokens[k] += m[k];
    }
    const sumOf = (key) => {
      const values = mine.map((r) => r[key]).filter((v) => v !== null);
      return values.length ? values.reduce((t, v) => t + v, 0) : null;
    };
    const activeMs = sumOf("activeMs");
    // A role on a non-Anthropic runner is never priced, even when its model name looks like one; the controller has
    // no routed runner, so it is priced from the model names alone (a local model has no rate).
    const priceable = role === "controller" || head.runner === "anthropic";
    const costs = mine.map((r) => (typeof r.cost === "number" ? { value: r.cost, source: "reported" } : { value: priceModels(r.models), source: "rates" }));
    const costed = priceable && costs.every((c) => c.value !== null);
    const sources = [...new Set(costs.map((c) => c.source))];
    roles[role] = {
      ...head,
      reported: [...reported].sort(),
      ...tokens,
      activeSeconds: activeMs === null ? null : secs(activeMs),
      outputPerActiveSecond: activeMs ? Math.round((tokens.output / (activeMs / 1000)) * 10) / 10 : null,
      toolCalls: sumOf("toolCalls"),
      toolErrors: sumOf("toolErrors"),
      apiErrors: sumOf("apiErrors"),
      cost: costed ? Math.round(costs.reduce((t, c) => t + c.value, 0) * 1e6) / 1e6 : null,
      costSource: costed ? (sources.length === 1 ? sources[0] : "mixed") : null,
    };
    for (const k of ["requests", "input", "output"]) sums[k] += tokens[k];
    if (roles[role].cost === null) costKnown = false;
    else sums.cost += roles[role].cost;
  }
  const any = missing.length < USAGE_ROLES.length;
  return {
    count: records.length,
    roles,
    totals: { requests: any ? sums.requests : null, input: any ? sums.input : null, output: any ? sums.output : null, cost: any && costKnown ? Math.round(sums.cost * 1e6) / 1e6 : null, missing },
  };
}

/**
 * The metrics object of docs/metrics.md from plain data. Reads no file and no clock; a missing input is a `null`
 * field, never a throw and never a zero. Holds counts, timestamps and content hashes, never a commit hash.
 */
export function buildMetrics(inputs = {}) {
  const i = isObj(inputs) ? inputs : {};
  const state = isObj(i.state) ? i.state : null;
  const counters = isObj(i.counters) ? i.counters : null;
  const genesis = isObj(i.genesis) ? i.genesis : null;
  const counter = (k) => (counters && Number.isInteger(counters[k]) ? counters[k] : null);
  const rounds = state && Array.isArray(state.rounds) ? state.rounds : null;
  const approved = rounds?.find((r) => r?.verdict === "APPROVED");
  const tasks = isObj(i.tasks) ? i.tasks : null;
  const feedback = Array.isArray(i.feedback)
    ? Object.fromEntries(Object.entries(i.feedback.reduce((o, e) => ({ ...o, [e?.category ?? "other"]: (o[e?.category ?? "other"] ?? 0) + 1 }), { restart: 0, "runner-drift": 0 })).sort(([a], [b]) => (a < b ? -1 : 1)))
    : null;
  const spec = isObj(i.spec) && typeof i.spec.title === "string" && typeof i.spec.sha256 === "string" ? { title: i.spec.title, sha256: i.spec.sha256 } : null;
  const timeline = state && Array.isArray(state.timeline) ? state.timeline : null;
  const usageIn = isObj(i.usage) ? i.usage : null;
  const per = rolesAndTotals(usageIn, i.routing);
  return {
    v: METRICS_VERSION,
    plugin: i.plugin ?? null,
    flight: i.flight ?? null,
    spec,
    harness: state && Array.isArray(state.harness) && state.harness.length ? state.harness : [{ name: "unknown", version: null }],
    usage: usageIn ? { source: usageIn.source ?? null, records: per.count, chainHead: usageIn.chainHead ?? null } : null,
    mode: genesis ? (genesis.mode ?? "clean-room") : "general",
    enforcement: genesis ? ("enforcement" in genesis ? genesis.enforcement : "hook") : null,
    outcome: {
      verdict: state ? (state.verdict ?? null) : null,
      halted: state ? (state.halted ?? null) : null,
      reviews: rounds ? rounds.length : null,
      fixRounds: state && Number.isInteger(state.round) ? state.round : null,
      approvedAtRound: approved && Number.isInteger(approved.round) ? approved.round : null,
      caps: isObj(i.caps) ? { maxRounds: i.caps.maxRounds ?? null, maxRoundsHard: i.caps.maxRoundsHard ?? null } : null,
    },
    wall: wallOf(timeline, i.now),
    rounds: roundsOf(state, timeline, i.now),
    roles: per.roles,
    totals: per.totals,
    tasks: {
      total: tasks && Number.isInteger(tasks.total) ? tasks.total : null,
      done: tasks && Number.isInteger(tasks.done) ? tasks.done : null,
      blocked: tasks && Number.isInteger(tasks.blocked) ? tasks.blocked : null,
      skipped: tasks && Number.isInteger(tasks.skipped) ? tasks.skipped : null,
      reopened: counter("tasksReopened"),
    },
    friction: {
      feedback,
      guardReblocks: counter("guardReblocks"),
      verifyRuns: counter("verifyRuns"),
      verifyFailures: counter("verifyFailures"),
      activateFailures: counter("activateFailures"),
    },
    tree: treeOf(i.git),
  };
}

// ---------------------------------------------------------------- comparing two flights

const NOT_RECORDED = "not recorded";
const STAGE_ORDER = ["plan", "implement", "review", "summarize"];
const FACT_ROLES = ["model", "runner", "family"];
const USAGE_ROWS = ["requests", "input", "output", "activeSeconds", "outputPerActiveSecond", "toolErrors", "cost"];

const orderedStages = (names) => [...STAGE_ORDER.filter((s) => names.includes(s)), ...names.filter((s) => !STAGE_ORDER.includes(s)).sort()];

/** `b - a` for numbers, `=` for equal non-numbers, `differs` for unequal ones, `null` when either side has no comparable value. */
function diffOf(a, b) {
  const plain = (x) => (isObj(x) && "partial" in x ? undefined : x);
  const [x, y] = [plain(a), plain(b)];
  if (x === undefined || y === undefined || x === null || y === null || x === NOT_RECORDED || y === NOT_RECORDED) return null;
  if (typeof x === "number" && typeof y === "number") return Math.round((y - x) * 1e6) / 1e6;
  return x === y ? "=" : "differs";
}

/**
 * Two metrics objects side by side (SPEC D-01), as plain data: a header and five sections of `{ label, a, b, diff }` rows.
 * A role with no usage record is `not recorded`, never 0, and a total that leaves a role out carries it in `partial`.
 */
export function compareMetrics(a, b) {
  const side = (m) => (isObj(m) ? m : {});
  const [A, B] = [side(a), side(b)];
  const row = (label, va, vb) => ({ label, a: va ?? null, b: vb ?? null, diff: diffOf(va ?? null, vb ?? null) });
  const num = (m, ...p) => p.reduce((o, k) => (isObj(o) ? o[k] : undefined), m) ?? null;
  const keysOf = (...objs) => [...new Set(objs.flatMap((o) => (isObj(o) ? Object.keys(o) : [])))];

  const outcome = [
    ["verdict", ["outcome", "verdict"]], ["halted", ["outcome", "halted"]], ["reviews", ["outcome", "reviews"]], ["fixRounds", ["outcome", "fixRounds"]],
    ["approvedAtRound", ["outcome", "approvedAtRound"]], ["maxRounds", ["outcome", "caps", "maxRounds"]], ["maxRoundsHard", ["outcome", "caps", "maxRoundsHard"]],
  ].map(([label, p]) => row(label, num(A, ...p), num(B, ...p)));

  const stages = orderedStages(keysOf(A.wall?.stageSeconds, B.wall?.stageSeconds));
  const runners = keysOf(A.wall?.activateSeconds, B.wall?.activateSeconds).sort();
  const wall = [
    row("seconds", num(A, "wall", "seconds"), num(B, "wall", "seconds")),
    ...stages.map((s) => row(`stage ${s}`, num(A, "wall", "stageSeconds", s), num(B, "wall", "stageSeconds", s))),
    ...runners.map((r) => row(`activate ${r}`, num(A, "wall", "activateSeconds", r), num(B, "wall", "activateSeconds", r))),
    row("idle", num(A, "wall", "idleSeconds"), num(B, "wall", "idleSeconds")),
  ];

  const roundList = (m) => (Array.isArray(m.rounds) ? m.rounds : []);
  const roundNumbers = [...new Set([...roundList(A), ...roundList(B)].map((r) => r?.round).filter(Number.isInteger))].sort((x, y) => x - y);
  const rounds = roundNumbers.flatMap((n) => {
    const [ra, rb] = [roundList(A).find((r) => r?.round === n), roundList(B).find((r) => r?.round === n)];
    return ["findings", "implementSeconds", "reviewSeconds"].map((k) => row(`round ${n} ${k}`, ra?.[k], rb?.[k]));
  });

  const roles = [];
  for (const role of USAGE_ROLES) {
    const [ea, eb] = [A.roles?.[role], B.roles?.[role]];
    for (const k of FACT_ROLES) roles.push(row(`${role} ${k}`, ea?.[k], eb?.[k]));
    for (const k of USAGE_ROWS) {
      const val = (e) => (isObj(e) ? (e.usage === null ? NOT_RECORDED : (e[k] ?? null)) : null);
      roles.push(row(`${role} ${k}`, val(ea), val(eb)));
    }
  }
  for (const k of ["requests", "input", "output", "cost"]) {
    const val = (m) => {
      if (!isObj(m.totals)) return null;
      const missing = Array.isArray(m.totals.missing) ? m.totals.missing : [];
      return missing.length ? { value: m.totals[k] ?? null, partial: missing } : (m.totals[k] ?? null);
    };
    roles.push(row(`totals ${k}`, val(A), val(B)));
  }

  const categories = keysOf(A.friction?.feedback, B.friction?.feedback).sort();
  const friction = [
    ...categories.map((c) => row(`feedback ${c}`, num(A, "friction", "feedback", c), num(B, "friction", "feedback", c))),
    row("guardReblocks", num(A, "friction", "guardReblocks"), num(B, "friction", "guardReblocks")),
    row("verifyRuns", num(A, "friction", "verifyRuns"), num(B, "friction", "verifyRuns")),
    row("verifyFailures", num(A, "friction", "verifyFailures"), num(B, "friction", "verifyFailures")),
    row("tasksReopened", num(A, "tasks", "reopened"), num(B, "tasks", "reopened")),
    row("activateFailures", num(A, "friction", "activateFailures"), num(B, "friction", "activateFailures")),
  ];

  const head = (m) => ({ flight: m.flight ?? null, harness: Array.isArray(m.harness) ? m.harness : null, plugin: m.plugin ?? null, mode: m.mode ?? null, specSha256: m.spec?.sha256 ?? null });
  const [ha, hb] = [head(A), head(B)];
  return {
    v: METRICS_VERSION,
    header: { a: ha, b: hb, sameSpec: typeof ha.specSha256 === "string" && ha.specSha256 === hb.specSha256 },
    sections: { outcome, wall, rounds, roles, friction },
  };
}
