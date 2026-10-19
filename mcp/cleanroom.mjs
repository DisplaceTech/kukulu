// Clean-room mode: the pure, synchronous functions the server, the hook scripts
// and the tests share. Nothing in this file starts a process, exits, prints or
// awaits: the callers own I/O and exit codes, which is what lets the same code
// run inside a hook and inside the test suite (SPEC section 4).

import { createHash } from "node:crypto";

/** A policy or log problem the caller reports: the server maps it to a ToolError, the hooks print its message. */
export class CleanroomError extends Error {
  constructor(message) {
    super(message);
    this.name = "CleanroomError";
  }
}

const TASK_ID = /^[PR]\d+-\d+$/;
const POLICY_KEYS = ["version", "deny", "allow", "lockdown", "protected"];
const DENY_KEYS = ["tools", "network", "paths", "pathPatterns", "words", "commandPatterns"];
const ALLOW_KEYS = ["paths", "urls"];
const LOCKDOWN_KEYS = ["after"];
const PATTERN_KEYS = ["id", "pattern", "flags", "shouldMatch", "shouldNotMatch"];

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

function stringArray(value, where) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new CleanroomError(`policy ${where} must be an array of non-empty strings`);
  value.forEach((entry, i) => {
    if (typeof entry !== "string" || !entry) throw new CleanroomError(`policy ${where}[${i}] must be a non-empty string`);
  });
  return value.slice();
}

function onlyKeys(object, allowed, where) {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) throw new CleanroomError(`policy ${where ? `${where} ` : ""}has an unknown key '${key}'; the legal keys are ${allowed.join(", ")}`);
  }
}

/** Validate one `pathPatterns` or `commandPatterns` list, self-testing every fixture the way constraints are. */
function patternList(value, where) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new CleanroomError(`policy ${where} must be an array of { id, pattern, flags?, shouldMatch, shouldNotMatch }`);
  const seen = new Set();
  return value.map((entry, i) => {
    const at = `${where}[${i}]`;
    if (!isObject(entry)) throw new CleanroomError(`policy ${at} must be an object { id, pattern, flags?, shouldMatch, shouldNotMatch }`);
    if (typeof entry.id !== "string" || !entry.id) throw new CleanroomError(`policy ${at}.id must be a non-empty string`);
    const label = `${where} '${entry.id}'`;
    onlyKeys(entry, PATTERN_KEYS, label);
    if (seen.has(entry.id)) throw new CleanroomError(`policy ${where} defines the id '${entry.id}' more than once; ids must be unique`);
    seen.add(entry.id);
    if (typeof entry.pattern !== "string" || !entry.pattern) throw new CleanroomError(`policy ${label} must have a non-empty 'pattern'`);
    if (entry.flags !== undefined && typeof entry.flags !== "string") throw new CleanroomError(`policy ${label}.flags must be a string`);
    let re;
    try {
      re = new RegExp(entry.pattern, entry.flags || "");
    } catch (e) {
      throw new CleanroomError(`policy ${label} has an invalid pattern: ${e.message}`);
    }
    for (const kind of ["shouldMatch", "shouldNotMatch"]) {
      const lines = entry[kind];
      if (!Array.isArray(lines) || !lines.length || !lines.every((l) => typeof l === "string")) {
        throw new CleanroomError(`policy ${label} must have at least one '${kind}' fixture line (an array of strings)`);
      }
    }
    // Test with a fresh regex per line: a global or sticky flag keeps state between calls.
    const matches = (line) => new RegExp(re.source, re.flags).test(line);
    for (const line of entry.shouldMatch) {
      if (!matches(line)) throw new CleanroomError(`policy ${label}: shouldMatch ${JSON.stringify(line)} did not match`);
    }
    for (const line of entry.shouldNotMatch) {
      if (matches(line)) throw new CleanroomError(`policy ${label}: shouldNotMatch ${JSON.stringify(line)} matched`);
    }
    return { id: entry.id, pattern: entry.pattern, ...(entry.flags ? { flags: entry.flags } : {}), shouldMatch: entry.shouldMatch.slice(), shouldNotMatch: entry.shouldNotMatch.slice() };
  });
}

/**
 * Parse and validate `docs/cleanroom.json` (SPEC section 5.2). Every bad shape
 * and every unknown key is a refusal that names the key path, and every
 * pattern's fixtures are checked on load, so a rule that disagrees with its own
 * examples never reaches a flight. Returns the policy with defaults filled.
 */
export function loadPolicy(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new CleanroomError(`policy is not valid JSON: ${e.message}`);
  }
  if (!isObject(raw)) throw new CleanroomError("policy must be a JSON object");
  onlyKeys(raw, POLICY_KEYS, "");
  if (raw.version !== 1) throw new CleanroomError(`policy version must be 1 (got ${JSON.stringify(raw.version)}); this release reads schema version 1 only`);

  const deny = raw.deny === undefined ? {} : raw.deny;
  if (!isObject(deny)) throw new CleanroomError("policy deny must be an object");
  onlyKeys(deny, DENY_KEYS, "deny");
  if (deny.network !== undefined && typeof deny.network !== "boolean") throw new CleanroomError("policy deny.network must be a boolean (true or false)");

  const allow = raw.allow === undefined ? {} : raw.allow;
  if (!isObject(allow)) throw new CleanroomError("policy allow must be an object");
  onlyKeys(allow, ALLOW_KEYS, "allow");

  const lockdown = raw.lockdown === undefined ? {} : raw.lockdown;
  if (!isObject(lockdown)) throw new CleanroomError("policy lockdown must be an object");
  onlyKeys(lockdown, LOCKDOWN_KEYS, "lockdown");
  if (lockdown.after !== undefined && (typeof lockdown.after !== "string" || !TASK_ID.test(lockdown.after))) {
    throw new CleanroomError(`policy lockdown.after must be a task id such as "P0-10" (got ${JSON.stringify(lockdown.after)})`);
  }

  return {
    version: 1,
    deny: {
      tools: stringArray(deny.tools, "deny.tools"),
      network: deny.network ?? true,
      paths: stringArray(deny.paths, "deny.paths"),
      pathPatterns: patternList(deny.pathPatterns, "deny.pathPatterns"),
      words: stringArray(deny.words, "deny.words"),
      commandPatterns: patternList(deny.commandPatterns, "deny.commandPatterns"),
    },
    allow: {
      paths: stringArray(allow.paths, "allow.paths"),
      urls: stringArray(allow.urls, "allow.urls"),
    },
    lockdown: { after: lockdown.after ?? null },
    protected: stringArray(raw.protected, "protected"),
  };
}

/** SHA-256 of a file's bytes, as lowercase hex; a string is hashed as UTF-8. */
export function policyHash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
