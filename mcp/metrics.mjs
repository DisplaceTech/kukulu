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
  return {
    v: METRICS_VERSION,
    plugin: i.plugin ?? null,
    flight: i.flight ?? null,
    spec,
    harness: state && Array.isArray(state.harness) && state.harness.length ? state.harness : [{ name: "unknown", version: null }],
    usage: null,
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
    roles: null,
    totals: null,
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
