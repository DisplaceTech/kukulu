// Clean-room mode: the pure, synchronous functions the server, the hook scripts
// and the tests share. Nothing in this file starts a process, exits, prints or
// awaits: the callers own I/O and exit codes, which is what lets the same code
// run inside a hook and inside the test suite (SPEC section 4).

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

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

// ---------------------------------------------------------------- the hash chain

export const ENTRY_KEYS = ["seq", "prev", "at", "kind", "stage", "task", "role", "model", "session", "tool", "target", "decision", "reason"];
export const KINDS = ["genesis", "allowed", "denied", "human", "gate", "checkpoint", "score", "attest", "resume"];
export const ZERO_HASH = "0".repeat(64);

// ⚠️ ASSUMPTION: a logged target longer than this is cut; cleanflate's log used the same bound.
export const TARGET_MAX = 4000;

const LOCK_WAIT_MS = 2000;
const LOCK_RETRY_MS = 10;

/** A string cut to TARGET_MAX characters; anything else passes through. */
export const truncateTarget = (s) => (typeof s === "string" && s.length > TARGET_MAX ? s.slice(0, TARGET_MAX) : s);

/**
 * The bytes a hash covers: `JSON.stringify` of the entry's fields in ENTRY_KEYS
 * order, then `data` when there is one, and nothing else. A field this format
 * does not know is refused rather than dropped, because a dropped field would
 * be a field the hash does not protect.
 */
export function canonical(entry) {
  const known = new Set([...ENTRY_KEYS, "data", "hash"]);
  for (const key of Object.keys(entry)) {
    if (!known.has(key)) throw new CleanroomError(`log entry has an unknown field '${key}'; the fields are ${ENTRY_KEYS.join(", ")} and data`);
  }
  const ordered = {};
  for (const key of ENTRY_KEYS) ordered[key] = entry[key] === undefined ? null : entry[key];
  if (entry.data !== undefined) ordered.data = entry.data;
  return JSON.stringify(ordered);
}

/** SHA-256 hex of `prev + "\n" + canonical(entry)`. */
export const entryHash = (prev, entry) => createHash("sha256").update(`${prev}\n${canonical(entry)}`).digest("hex");

export const logPathFor = (root, env = {}) => env.KUKULU_CLEANROOM_LOG || path.join(root, ".kukulu", "cleanroom", "log.jsonl");

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function withLock(logPath, fn) {
  const lock = `${logPath}.lock`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      fs.mkdirSync(lock);
      break;
    } catch (e) {
      if (e.code !== "EEXIST") throw new CleanroomError(`cannot take the clean-room log lock ${lock}: ${e.message}`);
      if (Date.now() >= deadline) {
        throw new CleanroomError(`the clean-room log lock ${lock} has been held for over ${LOCK_WAIT_MS / 1000} seconds; if no kukulu process is writing the log, remove that directory and try again`);
      }
      sleepSync(LOCK_RETRY_MS);
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
}

const NON_CALLER_FIELDS = new Set(["seq", "prev", "at", "hash"]);

/**
 * Append one entry to the log under a directory lock, so the hook scripts and
 * the server can write at the same time without forking the chain. The caller
 * supplies the descriptive fields; `seq`, `prev`, `at` and `hash` are ours.
 */
export function appendEntry(logPath, fields) {
  for (const key of Object.keys(fields)) {
    if (NON_CALLER_FIELDS.has(key)) throw new CleanroomError(`appendEntry fills '${key}' itself; do not pass it`);
  }
  if (!KINDS.includes(fields.kind)) throw new CleanroomError(`log entry kind must be one of ${KINDS.join(", ")} (got ${JSON.stringify(fields.kind)})`);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  return withLock(logPath, () => {
    let prev = ZERO_HASH;
    let seq = 1;
    if (fs.existsSync(logPath)) {
      const last = fs.readFileSync(logPath, "utf8").split("\n").filter(Boolean).pop();
      if (last) {
        let parsed;
        try {
          parsed = JSON.parse(last);
        } catch {
          throw new CleanroomError(`the last line of ${logPath} is not JSON; the chain is broken, so nothing more can be appended`);
        }
        prev = parsed.hash;
        seq = parsed.seq + 1;
      }
    }
    const entry = { seq, prev, at: new Date().toISOString() };
    for (const key of ENTRY_KEYS) if (!(key in entry)) entry[key] = fields[key] === undefined ? null : key === "target" ? truncateTarget(fields[key]) : fields[key];
    if (fields.data !== undefined) entry.data = fields.data;
    for (const key of Object.keys(fields)) {
      if (!ENTRY_KEYS.includes(key) && key !== "data") throw new CleanroomError(`log entry has an unknown field '${key}'; the fields are ${ENTRY_KEYS.join(", ")} and data`);
    }
    const stored = { ...entry, hash: entryHash(prev, entry) };
    const fd = fs.openSync(logPath, "a");
    try {
      fs.writeSync(fd, `${JSON.stringify(stored)}\n`);
    } finally {
      fs.closeSync(fd);
    }
    return stored;
  });
}

/** The log's entries in order; an absent file is an empty log. A line that is not JSON is reported by verifyChain, not here. */
export function readEntries(logPath) {
  if (!fs.existsSync(logPath)) return [];
  return fs.readFileSync(logPath, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

/**
 * Recompute the whole chain from its lines: every line parses, carries exactly
 * the format's keys in order, numbers `seq` densely from 1, links `prev` to the
 * line before and hashes to its own `hash`. `firstBad` names the first line that
 * fails and why.
 */
export function verifyChain(lines) {
  const entries = [];
  let tip = ZERO_HASH;
  for (let i = 0; i < lines.length; i++) {
    const bad = (reason, seq = null) => ({ ok: false, entries, tip, firstBad: { line: i + 1, seq, reason } });
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      return bad("the line is not valid JSON");
    }
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return bad("the line is not a JSON object");
    const want = [...ENTRY_KEYS, ...("data" in entry ? ["data"] : []), "hash"];
    if (Object.keys(entry).join(",") !== want.join(",")) return bad(`the keys are not exactly ${want.join(", ")}, in that order`, entry.seq ?? null);
    if (entry.seq !== i + 1) return bad(`seq is ${JSON.stringify(entry.seq)} but this is entry ${i + 1}; an entry was dropped, added or reordered`, entry.seq);
    if (entry.prev !== tip) return bad("prev does not match the previous entry's hash", entry.seq);
    const { hash, ...rest } = entry;
    if (entryHash(entry.prev, rest) !== hash) return bad("the hash does not match the entry's content; the entry was edited", entry.seq);
    entries.push(entry);
    tip = hash;
  }
  return { ok: true, entries, tip, firstBad: null };
}

// ---------------------------------------------------------------- entry fields from a hook payload

/** What a tool call acted on, as the log records it (SPEC D-05); always cut to TARGET_MAX. */
export function targetOf(toolName, toolInput) {
  const input = typeof toolInput === "object" && toolInput !== null && !Array.isArray(toolInput) ? toolInput : {};
  const parts = (pairs) => pairs.filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => `${k}=${v}`).join(" ");
  let target;
  switch (toolName) {
    case "Read":
    case "Write":
    case "Edit":
    case "MultiEdit":
      target = String(input.file_path ?? "");
      break;
    case "NotebookEdit":
      target = String(input.notebook_path ?? "");
      break;
    case "Grep":
      target = parts([["path", input.path], ["glob", input.glob], ["pattern", input.pattern]]);
      break;
    case "Glob":
      target = parts([["path", input.path], ["pattern", input.pattern]]);
      break;
    case "WebFetch":
      target = String(input.url ?? "");
      break;
    case "WebSearch":
      target = String(input.query ?? "");
      break;
    case "Bash":
      target = String(input.command ?? "");
      break;
    case "Agent":
    case "Task":
      target = `${input.subagent_type ?? ""}: ${input.description ?? ""}`;
      break;
    default: {
      let compact;
      try {
        compact = JSON.stringify(input);
      } catch {
        compact = String(input);
      }
      target = `${toolName} ${compact}`;
    }
  }
  return truncateTarget(target);
}

/** The project files an entry's stage and task come from. Reads only; each is null when absent or unreadable. */
export function projectContext(root) {
  const text = (rel) => {
    try {
      return fs.readFileSync(path.join(root, rel), "utf8");
    } catch {
      return null;
    }
  };
  const json = (rel) => {
    try {
      const v = JSON.parse(text(rel));
      return v && typeof v === "object" ? v : null;
    } catch {
      return null;
    }
  };
  return { progress: text("docs/PROGRESS.md"), lock: json(".kukulu/implement.lock"), state: json(".kukulu/state.json") };
}

const STAGE_OF_AGENT = { planner: "plan", implementer: "implement", reviewer: "review", summarizer: "summarize" };

/**
 * Whether the hooks should write to the log: once the flight has its genesis (or
 * a log already exists). Before genesis there is no chain to extend, and after an
 * archive moved the log away a stray entry would make the next genesis entry 2.
 */
export const loggingActive = (context, logPath) => Boolean(context?.state?.cleanroom?.genesis) || fs.existsSync(logPath);

/** The descriptive fields of an entry for a hook payload and the project's context. */
export function entryFields(hookInput, context = {}) {
  const input = hookInput && typeof hookInput === "object" ? hookInput : {};
  const agent = typeof input.agent_type === "string" && input.agent_type ? input.agent_type : null;
  const round = [context.lock?.round, context.state?.round].find((r) => Number.isInteger(r)) ?? 0;
  const implementStage = round >= 1 ? "fix" : "implement";
  let stage = null;
  if (agent) {
    const role = /(?:^|[-:])(planner|implementer|reviewer|summarizer)$/.exec(agent)?.[1];
    stage = role === "implementer" ? implementStage : role ? STAGE_OF_AGENT[role] : null;
  } else if (context.lock) {
    stage = implementStage;
  }
  const task = typeof context.progress === "string" ? /^- \[~\] (\S+)/m.exec(context.progress)?.[1] ?? null : null;
  return {
    stage,
    task,
    role: agent ?? "session",
    model: typeof input.model === "string" && input.model ? input.model : null,
    session: typeof input.session_id === "string" && input.session_id ? input.session_id : null,
    tool: typeof input.tool_name === "string" && input.tool_name ? input.tool_name : null,
    target: targetOf(input.tool_name, input.tool_input),
  };
}

// ---------------------------------------------------------------- the signing key and checkpoints

/** `sha256:` + hex of SHA-256 over the public key's SPKI DER: the key's identity in the log and the manifest. */
export function keyFingerprint(publicKey) {
  const der = publicKey.export({ type: "spki", format: "der" });
  return `sha256:${createHash("sha256").update(der).digest("hex")}`;
}

/** Create an Ed25519 key pair at `keyPath` (PKCS#8 PEM, mode 0600) and `<keyPath>.pub` (SPKI PEM). Never overwrites a key. */
export function generateKey(keyPath) {
  if (fs.existsSync(keyPath)) throw new CleanroomError(`a signing key already exists at ${keyPath}; refusing to overwrite it, since every earlier checkpoint was signed with it`);
  fs.mkdirSync(path.dirname(keyPath), { recursive: true, mode: 0o700 });
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  fs.writeFileSync(keyPath, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  fs.chmodSync(keyPath, 0o600);
  fs.writeFileSync(`${keyPath}.pub`, publicKey.export({ type: "spki", format: "pem" }));
  return { privateKey, publicKey, fingerprint: keyFingerprint(publicKey) };
}

/** Read a PEM Ed25519 private key; a key of any other kind, or an unreadable file, is a refusal naming the path. */
export function loadKey(keyPath) {
  let privateKey;
  try {
    privateKey = createPrivateKey(fs.readFileSync(keyPath, "utf8"));
  } catch (e) {
    throw new CleanroomError(`cannot read an Ed25519 signing key at ${keyPath}: ${e.message}`);
  }
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new CleanroomError(`the signing key at ${keyPath} is a ${privateKey.asymmetricKeyType} key; clean-room checkpoints are signed with Ed25519 only`);
  }
  const publicKey = createPublicKey(privateKey);
  return { privateKey, publicKey, fingerprint: keyFingerprint(publicKey) };
}

export const CHECKPOINT_KEYS = ["chainTip", "git", "policyHash", "guardHash", "loggerHash", "hooksHash", "keyFingerprint", "event"];

/** The bytes a checkpoint signature covers: the data rebuilt in CHECKPOINT_KEYS order, nothing else. */
function checkpointBytes(data) {
  const rest = Object.keys(data).filter((k) => k !== "signature");
  if ([...rest].sort().join(",") !== [...CHECKPOINT_KEYS].sort().join(",")) {
    throw new CleanroomError(`checkpoint data must have exactly the fields ${CHECKPOINT_KEYS.join(", ")} (plus signature)`);
  }
  const ordered = {};
  for (const key of CHECKPOINT_KEYS) ordered[key] = data[key];
  return Buffer.from(JSON.stringify(ordered), "utf8");
}

/** `data` with a base64 Ed25519 `signature` over its canonical bytes. */
export function signCheckpoint(data, privateKey) {
  return { ...data, signature: sign(null, checkpointBytes(data), privateKey).toString("base64") };
}

/** True when `entry` is a checkpoint whose signature verifies, over exactly the fields it carries, with `publicKey`. */
export function verifyCheckpoint(entry, publicKey) {
  try {
    if (!entry || entry.kind !== "checkpoint" || !entry.data || typeof entry.data.signature !== "string") return false;
    return verify(null, checkpointBytes(entry.data), publicKey, Buffer.from(entry.data.signature, "base64"));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- Bash segments and paths

/**
 * Split a Bash command into its top-level segments on unquoted `;`, `&&`,
 * `||`, `|`, `&` and newlines, so a `|` inside a quoted regex is never taken
 * for a pipe. Single quotes are literal, double quotes honour backslash
 * escapes, and a backslash outside quotes escapes the next character. An `&`
 * that is part of a redirection (`2>&1`, `&>file`) does not end a segment.
 */
export function splitSegments(command) {
  const segments = [];
  let current = "";
  let quote = null;
  const cut = () => {
    segments.push(current);
    current = "";
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote === "'") {
      current += c;
      if (c === "'") quote = null;
      continue;
    }
    if (quote === '"') {
      current += c;
      if (c === "\\" && i + 1 < command.length) current += command[++i];
      else if (c === '"') quote = null;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      current += c;
    } else if (c === "\\" && i + 1 < command.length) {
      current += c + command[++i];
    } else if (c === ";" || c === "\n") {
      cut();
    } else if (c === "&") {
      const redirect = /[<>]/.test(command[i - 1] ?? "") || command[i + 1] === ">";
      if (redirect) current += c;
      else {
        if (command[i + 1] === "&") i++;
        cut();
      }
    } else if (c === "|") {
      if (command[i + 1] === "|") i++;
      cut();
    } else current += c;
  }
  segments.push(current);
  return segments.map((s) => s.trim()).filter(Boolean);
}

/** The words of one segment with quoting removed, the way a shell would hand them to the command. */
export function shellWords(segment) {
  const words = [];
  let current = "";
  let started = false;
  let quote = null;
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i];
    if (quote === "'") {
      if (c === "'") quote = null;
      else current += c;
    } else if (quote === '"') {
      if (c === '"') quote = null;
      else if (c === "\\" && i + 1 < segment.length) current += segment[++i];
      else current += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      started = true;
    } else if (c === "\\" && i + 1 < segment.length) {
      current += segment[++i];
      started = true;
    } else if (/\s/.test(c)) {
      if (started) words.push(current);
      current = "";
      started = false;
    } else {
      current += c;
      started = true;
    }
  }
  if (started) words.push(current);
  return words;
}

const WRAPPERS = new Set(["sudo", "env", "time", "command", "xargs", "nice"]);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * The command a segment runs: the first token that is neither a `NAME=value`
 * assignment nor a wrapper (`sudo env time command xargs nice`) with its flags.
 * `word` is the command's base name; `args` are the tokens after it.
 */
export function commandWord(tokens) {
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (ASSIGNMENT.test(t)) {
      i++;
      continue;
    }
    const base = path.basename(t);
    if (WRAPPERS.has(base)) {
      i++;
      while (i < tokens.length && tokens[i].startsWith("-")) {
        const flag = tokens[i++];
        if (base === "nice" && flag === "-n" && i < tokens.length) i++;
      }
      continue;
    }
    return { word: base, raw: t, args: tokens.slice(i + 1) };
  }
  return { word: null, raw: null, args: [] };
}

/** The path a token stands for: for `--opt=value`, the value; otherwise the token. */
export const tokenPath = (token) => (/^--?[A-Za-z][\w-]*=/.test(token) ? token.slice(token.indexOf("=") + 1) : token);

/** Contains a `/`, or starts with `~` or `.`, and is not a URL. */
export function isPathLike(token) {
  const t = tokenPath(token);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return false;
  return t.includes("/") || t.startsWith("~") || t.startsWith(".");
}

/** The nearest existing ancestor's real path with the rest re-attached, so a file that does not exist yet still resolves through a symlinked directory. */
function realPathOf(p) {
  let head = p;
  const rest = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(head), ...rest.reverse());
    } catch {
      const parent = path.dirname(head);
      if (parent === head) return p;
      rest.push(path.basename(head));
      head = parent;
    }
  }
}

/**
 * Every form of a path the rules must check: expanded (`~`), made absolute
 * against `cwd`, normalized, and, when the real location differs (a symlinked
 * repository), that too.
 */
export function canonicalPaths(p, { cwd, home }) {
  let expanded = p;
  if (p === "~") expanded = home;
  else if (p.startsWith("~/")) expanded = path.join(home, p.slice(2));
  const normalized = path.normalize(path.isAbsolute(expanded) ? expanded : path.resolve(cwd, expanded));
  const real = realPathOf(normalized);
  return real !== normalized ? [normalized, real] : [normalized];
}

// ---------------------------------------------------------------- the guard's decision

// Bash commands that reach the network, fixed here so the policy cannot widen or narrow the list. A two-word
// entry matches the command word and its first argument (`git clone`, `npm i`).
export const NETWORK_COMMANDS = [
  "curl", "wget", "gh", "ssh", "scp", "nc", "git clone", "git fetch", "git pull", "pip download", "cargo vendor", "cargo download",
  "npm install", "npm i", "npm ci", "go get", "composer install",
];
export const READ_FAMILY = new Set(
  "cat less more head tail grep egrep fgrep rg ag ack find fd locate ls tree sed awk bat strings xxd od hexdump file zcat zless zgrep view vi vim nano emacs".split(" "),
);
export const WRITE_FAMILY = new Set("cp mv rm tee sed truncate chmod chown ln install dd git".split(" "));
const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
const PATH_TOOLS = new Set(["Read", "Glob", "Grep", ...WRITE_TOOLS]);
const NO_ISSUES = Object.freeze({ decision: "allowed", reason: null });
const denied = (reason) => ({ decision: "denied", reason });

/** Whether a task is `[x]` in the PROGRESS text. */
const taskDone = (progressText, id) => new RegExp(`^- \\[x\\] ${id}\\b`, "m").test(progressText);

/**
 * Lockdown ends the `allow.urls` exemption: false without `lockdown.after` or
 * without a PROGRESS text; true once that task is `[x]`, or when no task is
 * left open.
 */
export function lockdownActive(policy, progressText) {
  if (!policy.lockdown?.after || typeof progressText !== "string") return false;
  if (taskDone(progressText, policy.lockdown.after)) return true;
  const tasks = progressText.split("\n").filter((l) => /^- \[[ ~x!-]\] \S/.test(l));
  return tasks.length > 0 && !tasks.some((l) => /^- \[[ ~]\]/.test(l));
}

const underPrefix = (p, prefix) => {
  const bare = prefix.length > 1 ? prefix.replace(/\/+$/, "") : prefix;
  return p === bare || p.startsWith(bare === "/" ? "/" : `${bare}/`);
};

/** A policy path entry made absolute: `~` is home, a relative entry is repo-relative. */
const resolvePrefix = (entry, root, home) => canonicalPaths(entry, { cwd: root, home })[0];

/**
 * Decide one tool call against the policy (SPEC D-03). Pure: `env` carries the
 * project `root`, the user's `home`, the PROGRESS text (for lockdown) and the
 * `protected` prefixes. The first rule that matches denies.
 */
export function evaluate(policy, hookInput, env) {
  const input = hookInput && typeof hookInput === "object" ? hookInput : {};
  const tool = typeof input.tool_name === "string" ? input.tool_name : "";
  const args = input.tool_input && typeof input.tool_input === "object" && !Array.isArray(input.tool_input) ? input.tool_input : {};
  const { root, home } = env;
  const cwd = typeof input.cwd === "string" && input.cwd ? input.cwd : root;
  const lockdown = lockdownActive(policy, env.progressText);
  const prefixes = (list) => list.map((e) => resolvePrefix(e, root, home));
  const denyPaths = prefixes(policy.deny.paths);
  const allowPaths = prefixes(policy.allow.paths);
  const protectedPaths = env.protected ?? prefixes(policy.protected);
  const forms = (p) => canonicalPaths(p, { cwd, home });
  const inRepo = (p) => forms(p).some((f) => underPrefix(f, root));
  const exempt = (p) => forms(p).some((f) => allowPaths.some((a) => underPrefix(f, a)));
  const wordIn = (text) => {
    const lower = String(text).toLowerCase();
    return policy.deny.words.some((w) => lower.includes(w.toLowerCase()));
  };
  const regexes = (list) => list.map((p) => ({ id: p.id, re: new RegExp(p.pattern, p.flags || "") }));
  const pathPatterns = regexes(policy.deny.pathPatterns);
  const commandPatterns = regexes(policy.deny.commandPatterns);

  /** The deny.paths / pathPatterns / protected verdict for one path, or null. */
  const pathVerdict = (p, { write = false } = {}) => {
    for (const f of forms(p)) {
      if (write && protectedPaths.some((x) => underPrefix(f, x))) return denied(`protected path: ${f}`);
    }
    for (const f of forms(p)) {
      if (denyPaths.some((x) => underPrefix(f, x))) return denied(`denied path: ${f} (deny.paths)`);
      const hit = pathPatterns.find((x) => new RegExp(x.re.source, x.re.flags).test(f));
      if (hit) return denied(`denied path: ${f} (pathPatterns ${hit.id})`);
    }
    return null;
  };

  // 1. tools denied outright
  if (policy.deny.tools.includes(tool)) return denied(`tool ${tool} is denied by deny.tools`);
  // 2. WebSearch
  if (tool === "WebSearch" && policy.deny.network) return denied("network access is denied (WebSearch)");
  // 3. WebFetch
  if (tool === "WebFetch" && policy.deny.network) {
    if (lockdown) return denied("WebFetch is denied: lockdown is active");
    if (policy.allow.urls.includes(String(args.url ?? ""))) return NO_ISSUES;
    return denied(`WebFetch is denied: ${args.url ?? "(no url)"} is not in allow.urls`);
  }

  if (PATH_TOOLS.has(tool)) {
    const target = tool === "NotebookEdit" ? args.notebook_path : args.file_path;
    const isSearch = tool === "Glob" || tool === "Grep";
    const base = isSearch ? args.path || cwd : target;
    // 4. protected paths, for every write tool
    if (WRITE_TOOLS.has(tool) && typeof base === "string" && base) {
      const v = forms(base).find((f) => protectedPaths.some((x) => underPrefix(f, x)));
      if (v) return denied(`protected path: ${v}`);
    }
    // 5. deny.paths, pathPatterns and forbidden words
    if (typeof base === "string" && base) {
      const v = pathVerdict(base);
      if (v) return v;
      if (!isSearch && wordIn(base) && !exempt(base)) return denied(`forbidden word in path: ${base}`);
    }
    if (isSearch) {
      const fields = tool === "Glob" ? [["pattern", args.pattern]] : [["glob", args.glob], ["pattern", args.pattern]];
      const baseExempt = typeof base === "string" && exempt(base);
      for (const [name, value] of fields) {
        if (typeof value === "string" && wordIn(value) && !baseExempt) return denied(`forbidden word in ${name}: ${value}`);
      }
      if (typeof base === "string" && wordIn(base) && !baseExempt) return denied(`forbidden word in path: ${base}`);
    }
    return NO_ISSUES;
  }

  if (tool === "Bash") {
    const command = String(args.command ?? "");
    for (const segment of splitSegments(command)) {
      const tokens = shellWords(segment);
      const { word, args: rest } = commandWord(tokens);
      if (word === null) continue;

      // 6a. network commands
      if (policy.deny.network) {
        const first = rest.find((t) => !t.startsWith("-"));
        const name = NETWORK_COMMANDS.includes(word) ? word : first && NETWORK_COMMANDS.includes(`${word} ${first}`) ? `${word} ${first}` : null;
        if (name) {
          const urls = tokens.filter((t) => /^https?:\/\//i.test(t));
          const allowedFetch = (word === "curl" || word === "wget") && !lockdown && urls.length > 0 && urls.every((u) => policy.allow.urls.includes(u));
          if (!allowedFetch) return denied(`network command ${name} is denied`);
        }
      }
      // 6b. any token under deny.paths or matching a pathPattern
      const pathTokens = rest.filter(isPathLike);
      for (const t of pathTokens) {
        const v = pathVerdict(tokenPath(t));
        if (v) return v;
      }
      // 6c. read-family commands and forbidden words
      if (READ_FAMILY.has(word)) {
        for (const t of pathTokens) {
          if (wordIn(t) && !exempt(tokenPath(t))) return denied(`forbidden word in path argument: ${t}`);
        }
        const outside = pathTokens.length ? pathTokens.some((t) => !inRepo(tokenPath(t))) : !inRepo(cwd);
        if (outside) {
          for (const t of rest) {
            if (!isPathLike(t) && wordIn(t)) return denied(`forbidden word in command outside the repository: ${t}`);
          }
        }
      }
      // 6d. write-family commands and redirections on protected paths
      const redirects = redirectTargets(tokens);
      if (WRITE_FAMILY.has(word)) {
        if (word === "git" && rest[0] === "config" && rest.some((t) => /core\.hookspath/i.test(t))) return denied("protected path: git config core.hooksPath");
        for (const t of pathTokens) {
          const f = forms(tokenPath(t)).find((x) => protectedPaths.some((p) => underPrefix(x, p)));
          if (f) return denied(`protected path: ${f}`);
        }
      }
      for (const t of redirects) {
        const f = forms(t).find((x) => protectedPaths.some((p) => underPrefix(x, p)));
        if (f) return denied(`protected path: ${f}`);
      }
      // 6e. command patterns
      const hit = commandPatterns.find((x) => new RegExp(x.re.source, x.re.flags).test(segment));
      if (hit) return denied(`commandPatterns ${hit.id}`);
    }
    return NO_ISSUES;
  }

  // 7. everything else, Agent, Task, Skill and every mcp__ tool included
  return NO_ISSUES;
}

/** The targets of `>` and `>>` redirections in a segment's tokens, with their fd prefixes (`2>`, `&>`) removed. */
function redirectTargets(tokens) {
  const targets = [];
  for (let i = 0; i < tokens.length; i++) {
    const m = /^(?:\d+|&)?>>?(.*)$/.exec(tokens[i]);
    if (!m) continue;
    const inline = m[1].replace(/^&\d*$/, "");
    if (inline) targets.push(inline);
    else if (!/^&\d*$/.test(m[1]) && tokens[i + 1] !== undefined) targets.push(tokens[++i]);
  }
  return targets;
}
