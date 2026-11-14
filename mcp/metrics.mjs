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
