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
      // `>|` is a clobbering redirection (`echo x >| file`), not a pipe.
      if (current.endsWith(">")) current += c;
      else {
        if (command[i + 1] === "|") i++;
        cut();
      }
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
      else if (c === "\\" && i + 1 < segment.length) {
        // Inside double quotes a backslash only escapes $ ` " \ and newline; before anything else it stays (env -S needs `\_`).
        if ('$`"\\\n'.includes(segment[i + 1])) current += segment[++i];
        else current += c;
      } else current += c;
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

const WRAPPERS = new Set(["sudo", "env", "time", "command", "xargs", "nice", "exec", "nohup", "timeout", "stdbuf", "setsid"]);
// Options whose value is the next token, per wrapper, short and long.
const VALUED_OPTIONS = Object.fromEntries(
  Object.entries({
    sudo: "-u -g -h -p -C -D -r -t -U -R -T --chroot --command-timeout --user --group --host --prompt --close-from --chdir --role --type --other-user",
    env: "-u -C -P --unset --chdir",
    timeout: "-s -k --signal --kill-after",
    nice: "-n --adjustment",
    xargs: "-n -L -P -I -d -E -s -a --max-args --max-procs --delimiter --max-chars --arg-file",
    stdbuf: "-i -o -e --input --output --error",
    time: "-o -f --output --format",
  }).map(([k, v]) => [k, new Set(v.split(" "))]),
);
// Per wrapper: the valued short letters and the valued long names, for scanOption.
const VALUED_SPEC = Object.fromEntries(
  Object.entries(VALUED_OPTIONS).map(([k, set]) => {
    const names = [...set];
    return [
      k,
      {
        short: new Set(names.filter((n) => /^-[^-]$/.test(n)).map((n) => n[1])),
        long: new Set(names.filter((n) => n.startsWith("--"))),
        optShort: new Set(),
        optLong: new Set(),
      },
    ];
  }),
);
VALUED_SPEC.env.short.add("S");
VALUED_SPEC.env.long.add("--split-string");
// GNU xargs gives these an OPTIONAL argument that is only ever attached (-i[str], --replace[=str]); the next token is the command.
for (const l of "ile") VALUED_SPEC.xargs.optShort.add(l);
for (const n of ["--replace", "--max-lines", "--eof"]) VALUED_SPEC.xargs.optLong.add(n);

/**
 * Read one option token the way getopt does. `spec` is `{ short: Set of valued letters, long: Set of valued
 * long names with their `--` }`. A short bundle `-abc` is scanned letter by letter: the first valued letter takes
 * the rest of the token, or the next token when it is last. A long option is exact, `--name=value`, or any prefix
 * that names exactly one valued long option. Returns null when the token takes no value, else `{ name, value }`
 * with `name` the letter or the full long name and `value` null when the next token holds it.
 */
export function scanOption(token, spec) {
  if (!spec || !token.startsWith("-") || token === "-" || token === "--") return null;
  if (token.startsWith("--")) {
    const eq = token.indexOf("=");
    const given = eq === -1 ? token : token.slice(0, eq);
    const all = [...spec.long, ...(spec.optLong || [])];
    const full = all.includes(given) ? [given] : all.filter((n) => n.startsWith(given));
    if (full.length !== 1) return null;
    const optional = spec.optLong && spec.optLong.has(full[0]);
    return { name: full[0], value: eq === -1 ? (optional ? "" : null) : token.slice(eq + 1) };
  }
  for (let k = 1; k < token.length; k++) {
    if (spec.optShort && spec.optShort.has(token[k])) return { name: token[k], value: token.slice(k + 1) };
    if (spec.short.has(token[k])) return { name: token[k], value: k + 1 < token.length ? token.slice(k + 1) : null };
  }
  return null;
}
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * The command a segment runs: the first token that is neither a `NAME=value`
 * assignment nor a wrapper (`sudo env time command xargs nice exec nohup timeout stdbuf setsid`) with its flags.
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
        const opt = scanOption(flag, VALUED_SPEC[base]);
        if (!opt) continue;
        // env -S / --split-string: GNU env splits the value into words that are parsed as further arguments, so they take the flag's place.
        if (base === "env" && (opt.name === "S" || opt.name === "--split-string")) {
          const fromNext = opt.value === null;
          if (fromNext && i >= tokens.length) continue;
          const words = shellWords((fromNext ? tokens[i] : opt.value).replaceAll("\\_", " "));
          tokens = [...tokens.slice(0, i - 1), ...words, ...tokens.slice(fromNext ? i + 1 : i)];
          i--;
          continue;
        }
        // The value of a valued option is not the command (`sudo -u root curl ...`); an attached value is part of the flag token.
        if (opt.value === null && i < tokens.length) i++;
      }
      // timeout's first operand is its duration, not the command.
      if (base === "timeout" && i < tokens.length && /^\d+(?:\.\d+)?[smhd]?$/.test(tokens[i])) i++;
      continue;
    }
    return { word: base, raw: t, args: tokens.slice(i + 1) };
  }
  return { word: null, raw: null, args: [] };
}

/** The path a token stands for: for `--opt=value` and `of=value` (dd), the value; otherwise the token. */
export const tokenPath = (token) => (/^(?:--?[A-Za-z][\w-]*|[A-Za-z_]\w*)=/.test(token) ? token.slice(token.indexOf("=") + 1) : token);

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
 * The paths no write tool or write-family command may touch (SPEC D-10): the
 * rules, the evidence, the configuration that selects them, the hooks that
 * enforce them, the plugin that holds the hooks, and the signing key. `env`
 * carries what the caller knows: `{ root, home, policyPath, pluginRoot, keyPath,
 * planExists }`; a missing piece is skipped. `docs/kukulu.json` is protected
 * from the moment the plan exists, because the planner writes it before that.
 */
export function protectedPaths(policy, env) {
  const { root, home, policyPath, pluginRoot, keyPath, planExists } = env;
  const list = [];
  if (policyPath) list.push(policyPath);
  if (root) {
    list.push(path.join(root, ".kukulu", "cleanroom"), path.join(root, ".kukulu", "state.json"));
    if (planExists) list.push(path.join(root, "docs", "kukulu.json"));
    list.push(path.join(root, ".claude", "settings.json"), path.join(root, ".claude", "settings.local.json"), path.join(root, ".claude", "hooks"), path.join(root, ".mcp.json"));
  }
  if (pluginRoot) list.push(pluginRoot);
  if (home) list.push(path.join(home, ".claude", "plugins"), path.join(home, ".claude", "settings.json"));
  if (keyPath) list.push(keyPath, `${keyPath}.pub`);
  if (root) list.push(path.join(root, ".git", "hooks"), path.join(root, ".git", "config"), path.join(root, ".git", "info"));
  list.push(...policy.protected.map((e) => resolvePrefix(e, root, home)));
  return list.map((p) => path.normalize(p));
}

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
  // Where a `cd` earlier in the command has moved the shell; every relative token and the "outside the repository" clause resolve against it.
  let shellCwd = cwd;
  // `cd -` returns here: the directory before the last `cd`.
  let previousCwd = cwd;
  const writeForms = (p, base = shellCwd) => canonicalPaths(p, { cwd: base, home });
  const lockdown = lockdownActive(policy, env.progressText);
  const prefixes = (list) => list.map((e) => resolvePrefix(e, root, home));
  // The signing key is read-denied like a deny.paths entry; its public half and every other protected file stay readable.
  const denyPaths = [...prefixes(policy.deny.paths), ...(env.keyPath ? [env.keyPath] : [])];
  const allowPaths = prefixes(policy.allow.paths);
  const protectedList = env.protected ?? protectedPaths(policy, env);
  const forms = (p) => canonicalPaths(p, { cwd: shellCwd, home });
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
      if (write && protectedList.some((x) => underPrefix(f, x))) return denied(`protected path: ${f}`);
    }
    for (const f of forms(p)) {
      if (denyPaths.some((x) => underPrefix(f, x))) return denied(`denied path: ${f} (deny.paths)`);
      const hit = pathPatterns.find((x) => new RegExp(x.re.source, x.re.flags).test(f));
      if (hit) return denied(`denied path: ${f} (pathPatterns ${hit.id})`);
    }
    return null;
  };

  /** The deny.paths entry a glob or a recursive operand can reach (see reachesDenied), as a verdict, or null. */
  const reachVerdict = (token, base, recursive) => {
    for (const f of canonicalPaths(tokenPath(token), { cwd: base, home })) {
      const d = reachesDenied(f, denyPaths, recursive);
      if (d) return denied(`denied path: ${d} (deny.paths) is reached by ${token}, which ${recursive ? "a recursive read would search" : "a glob matches"}`);
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
      const v = forms(base).find((f) => protectedList.some((x) => underPrefix(f, x)));
      if (v) return denied(`protected path: ${v}`);
    }
    // 5. deny.paths, pathPatterns and forbidden words
    if (typeof base === "string" && base) {
      const v = pathVerdict(base);
      if (v) return v;
      if (!isSearch && wordIn(base) && !exempt(base)) return denied(`forbidden word in path: ${base}`);
    }
    if (tool === "Glob" && typeof args.pattern === "string") {
      if (/^[/~]/.test(args.pattern)) {
        const v = pathVerdict(args.pattern);
        if (v) return v;
      }
      // The pattern is resolved against the search root, wildcards and `..` included.
      const v = reachVerdict(args.pattern, typeof base === "string" && base ? forms(base)[0] : cwd, false);
      if (v) return v;
    }
    // A search reaches everything under its root.
    if (isSearch && typeof base === "string" && base) {
      const v = reachVerdict(base, cwd, true);
      if (v) return v;
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

  if (tool === "Bash") return bashVerdict(String(args.command ?? ""), 0);

  // 7. everything else, Agent, Task, Skill and every mcp__ tool included
  return NO_ISSUES;

  /** Rule 6 for one command string; substitutions, `sh -c` and `eval` strings are judged as further commands. */
  function bashVerdict(command, depth) {
    if (depth > 4) return NO_ISSUES;
    const { text, inner } = extractSubstitutions(command);
    for (const sub of inner) {
      const v = bashVerdict(sub, depth + 1);
      if (v.decision === "denied") return v;
    }
    const subshells = [];
    // Nesting of `case ... in`, inside which a leading `pattern)` is an arm and not a command.
    let caseDepth = 0;
    for (const raw of splitSegments(text)) {
      const { segment, opens, closes, entersCase, leavesCase } = stripGrouping(raw, caseDepth > 0);
      if (entersCase) caseDepth++;
      if (leavesCase && caseDepth > 0) caseDepth--;
      // A `(` starts a subshell: a `cd` inside it does not outlive its `)`.
      for (let k = 0; k < opens; k++) subshells.push(shellCwd);
      const settle = () => {
        for (let k = 0; k < closes && subshells.length; k++) shellCwd = subshells.pop();
      };
      const tokens = shellWords(segment).map((t) => (home ? t.replaceAll("${HOME}", home).replace(/\$HOME(?![A-Za-z0-9_])/g, () => home) : t));
      const { word, args: rest } = commandWord(tokens);
      if (word === null) {
        settle();
        continue;
      }
      // A string handed to a shell or to eval is a command line of its own.
      const shellString = /^(?:ba|z|da|k)?sh$/.test(word) ? rest[rest.findIndex((t) => /^-[A-Za-z]*c[A-Za-z]*$/.test(t)) + 1] : word === "eval" ? rest.join(" ") : undefined;
      if (typeof shellString === "string" && (word === "eval" || rest.some((t) => /^-[A-Za-z]*c[A-Za-z]*$/.test(t)))) {
        const v = bashVerdict(shellString, depth + 1);
        if (v.decision === "denied") return v;
      }
      // The segment is judged with every rule below, so a `cd ~/.cargo/registry` operand is a token under 6b; the directory it names takes effect afterwards.
      // 6a. network commands
      if (policy.deny.network) {
        const first = word === "git" ? gitSubcommand(rest) : rest.find((t) => !t.startsWith("-"));
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
        // A pattern, script or program operand is text, not a path: only the "outside the repository" clause judges it.
        const patterns = patternOperands(word, rest);
        const realPaths = rest.filter((t, i) => isPathLike(t) && !patterns.has(i));
        for (const t of realPaths) {
          if (wordIn(t) && !exempt(tokenPath(t))) return denied(`forbidden word in path argument: ${t}`);
        }
        const outside = realPaths.length ? realPaths.some((t) => !inRepo(tokenPath(t))) : !inRepo(".");
        if (outside) {
          for (let i = 0; i < rest.length; i++) {
            const t = rest[i];
            if (patterns.has(i) && isPathLike(t) && wordIn(t)) return denied(`forbidden word in path argument: ${t} (a pattern in a command outside the repository)`);
            if (!isPathLike(t) && wordIn(t)) return denied(`forbidden word in command outside the repository: ${t}`);
          }
        }
      }
      // A cd/pushd operand and a read-family path operand count as paths with or without a `/`: they resolve against the directory an earlier `cd` moved to.
      // Judged after 6c so a forbidden word keeps its own reason.
      {
        const textOperands = patternOperands(word, rest);
        const bare = word === "cd" || word === "pushd" || READ_FAMILY.has(word);
        for (let i = 0; bare && i < rest.length; i++) {
          if (isPathLike(rest[i]) || textOperands.has(i) || rest[i].startsWith("-")) continue;
          const v = pathVerdict(rest[i]);
          if (v) return v;
        }
      }
      // A glob token, and the operands of a recursive form, reach more than the path they name.
      const textual = patternOperands(word, rest);
      // A bare operand (`cat r*`, `cd r*`) is a path too, and so is any operand under a directory a `cd` moved to by glob.
      const bareWord = word === "cd" || word === "pushd" || READ_FAMILY.has(word);
      for (let i = 0; i < rest.length; i++) {
        const reaching = isPathLike(rest[i]) || (bareWord && !rest[i].startsWith("-"));
        if (reaching && !textual.has(i) && (/[*?[{]/.test(tokenPath(rest[i])) || (bareWord && /[*?[{]/.test(shellCwd)))) {
          const v = reachVerdict(rest[i], shellCwd, false);
          if (v) return v;
        }
      }
      for (const t of recursiveOperands(word, rest) ?? []) {
        const v = reachVerdict(t, shellCwd, true);
        if (v) return v;
      }
      // 6d. write-family commands and redirections on protected paths
      const redirects = redirectTargets(segment).flatMap((t) => braceExpand(t));
      const allArgs = rest;
      let writeDenied = null;
      if (WRITE_FAMILY.has(word)) {
        // The shell expands braces before the command runs, so `rm -rf {docs,src}` is `rm -rf docs src`.
        const rest = allArgs.flatMap((t) => braceExpand(t));
        if (word === "git" && rest[0] === "config" && rest.some((t) => /core\.hookspath/i.test(t))) return denied("protected path: git config core.hooksPath");
        // Every non-option operand of a write-family command is a path, with or without a `/`.
        // git's `-C dir` moves the operands that follow its subcommand.
        const git = word === "git" ? gitParts(rest) : null;
        const gitCwd = git ? git.dirs.reduce((base, d) => canonicalPaths(tokenPath(d), { cwd: base, home })[0], shellCwd) : shellCwd;
        rest.forEach((t, i) => {
          if (writeDenied) return;
          if (!(!t.startsWith("-") || isPathLike(t))) return;
          const f = writeForms(tokenPath(t), git && i > git.subIndex ? gitCwd : shellCwd).find((x) => protectedList.some((p) => underPrefix(x, p)));
          if (f) {
            writeDenied = denied(`protected path: ${f}`);
            return;
          }
          const w = wildcardNames(writeForms(tokenPath(t), git && i > git.subIndex ? gitCwd : shellCwd), protectedList);
          if (w) writeDenied = denied(`protected path: ${w} (can be named by the wildcard ${t})`);
        });
        if (writeDenied) return writeDenied;
        // cp, mv, ln and install into a directory write `<directory>/<basename of source>`, a path no operand names.
        const landed = destinationPaths(word, rest);
        for (const { target } of landed.targets) {
          const forms = writeForms(target);
          const f = forms.find((x) => protectedList.some((p) => underPrefix(x, p) || (landed.recursive && underPrefix(p, x))));
          if (f) return denied(`protected path: ${f} (${word} writes it into ${landed.dir})`);
          const w = wildcardNames(forms, protectedList);
          if (w) return denied(`protected path: ${w} (can be named by the wildcard ${target})`);
        }
        // A destructive form also destroys everything under the operand, so a protected path below it counts.
        for (const t of destructiveOperands(word, rest)) {
          const f = writeForms(tokenPath(t), gitCwd).find((x) => protectedList.some((p) => underPrefix(p, x)));
          if (f) return denied(`protected path: ${f} (contains a protected path)`);
          const g = globHit(writeForms(tokenPath(t), gitCwd), protectedList);
          if (g) return denied(`protected path: ${g} (matched by the glob ${t})`);
        }
        // The hooks append to the log on every call, so a form that restores the worktree to the last commit erases the denied entries since.
        if (git) {
          const hit = worktreeDiscard(git, rest);
          if (hit) {
            const logPath = protectedList.find((p) => path.basename(p) === "cleanroom" && path.basename(path.dirname(p)) === ".kukulu");
            const f = hit.pathspecs.length
              ? hit.pathspecs.flatMap((t) => writeForms(tokenPath(t), gitCwd)).find((x) => protectedList.some((p) => underPrefix(x, p) || underPrefix(p, x)))
              : logPath ?? protectedList[0];
            if (f) return denied(`protected path: ${f} (git ${hit.form} discards uncommitted changes, among them the log's entries)`);
          }
        }
      }
      for (const t of redirects) {
        const f = writeForms(t).find((x) => protectedList.some((p) => underPrefix(x, p)));
        if (f) return denied(`protected path: ${f}`);
        const w = wildcardNames(writeForms(t), protectedList);
        if (w) return denied(`protected path: ${w} (can be named by the wildcard ${t})`);
      }
      // 6e. command patterns
      const hit = commandPatterns.find((x) => new RegExp(x.re.source, x.re.flags).test(segment));
      if (hit) return denied(`commandPatterns ${hit.id}`);
      // A `cd` or `pushd` moves every later relative operand (`cd docs && rm cleanroom.json`, `cd ~/.cargo && cat registry/x`).
      if (word === "cd" || word === "pushd") {
        const dir = rest.find((t) => !t.startsWith("-") || t === "-");
        const before = shellCwd;
        if (dir === "-") shellCwd = previousCwd;
        // A bare `cd` or `cd --` goes to HOME.
        else if (dir === undefined) shellCwd = home ?? shellCwd;
        else if (!/^[<>]/.test(dir)) shellCwd = canonicalPaths(tokenPath(dir), { cwd: shellCwd, home })[0];
        previousCwd = before;
      }
      settle();
    }
    return NO_ISSUES;
  }
}

// Valued options of cp, mv, ln and install, for scanOption.
const COPY_SPEC = {
  short: new Set("tSmog"),
  long: new Set(["--target-directory", "--suffix", "--mode", "--owner", "--group"]),
};

// Every long option of GNU cp, so a prefix is read only when it names exactly one (`--rec` is --recursive, `--r` is nothing).
const CP_LONG = (
  "--archive --attributes-only --backup --copy-contents --debug --dereference --force --interactive --link --no-clobber --no-dereference " +
  "--no-preserve --no-target-directory --one-file-system --parents --preserve --recursive --reflink --remove-destination --sparse " +
  "--strip-trailing-slashes --symbolic-link --target-directory --suffix --update --verbose --context --help --version"
).split(" ");
const cpLong = (t) => {
  const given = t.split("=")[0];
  if (CP_LONG.includes(given)) return given;
  const hits = CP_LONG.filter((n) => n.startsWith(given));
  return hits.length === 1 ? hits[0] : null;
};

/**
 * Where cp, mv, ln and install put their sources: the -t/--target-directory
 * value, else the last operand, is the destination directory, and each source
 * lands at `<directory>/<basename>`. A source whose basename is `.` or `..`
 * stands for the directory itself. `recursive` is a cp -r/-R/-a.
 */
function destinationPaths(word, rest) {
  const none = { dir: null, recursive: false, targets: [] };
  if (!["cp", "mv", "ln", "install"].includes(word)) return none;
  let dir = null;
  const operands = [];
  let recursive = false;
  let noTargetDir = false;
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i];
    if (t === "--") {
      operands.push(...rest.slice(i + 1));
      break;
    }
    let opt = null;
    if (word === "cp" && t.startsWith("--")) {
      // cp resolves its own long options: `--o` is --one-file-system there, not install's --owner.
      const full = cpLong(t);
      if (full === "--target-directory" || full === "--suffix") {
        const eq = t.indexOf("=");
        opt = { name: full, value: eq === -1 ? null : t.slice(eq + 1) };
      }
    } else if (t.startsWith("-")) opt = scanOption(t, COPY_SPEC);
    if (opt) {
      const value = opt.value ?? rest[++i];
      if (opt.name === "t" || opt.name === "--target-directory") dir = value ?? dir;
      // A bundle's letters before the valued one still count (`cp -rt docs`).
      if (word === "cp" && !t.startsWith("--")) {
        const before = t.slice(1, t.search(/[tSmog]/));
        if (/[rRa]/.test(before)) recursive = true;
        if (before.includes("T")) noTargetDir = true;
      }
    } else if (t.startsWith("-") && t.length > 1) {
      if (word === "cp" && !t.startsWith("--")) {
        if (/^-[A-Za-z]*[rRa][A-Za-z]*$/.test(t)) recursive = true;
        if (/^-[A-Za-z]*T/.test(t)) noTargetDir = true;
      } else if (word === "cp") {
        const full = cpLong(t);
        if (full === "--recursive" || full === "--archive") recursive = true;
        if (full === "--no-target-directory") noTargetDir = true;
      } else if (/^-[A-Za-z]*T/.test(t) && !t.startsWith("--")) noTargetDir = true;
    } else operands.push(t);
  }
  const sources = dir === null ? operands.slice(0, -1) : operands;
  // -T: the last operand is the destination itself, so every source stands for it.
  const asSelf = noTargetDir && dir === null && operands.length > 1;
  if (dir === null) dir = operands.length > 1 ? operands[operands.length - 1] : null;
  if (dir === null) return none;
  const targets = sources.map((src) => {
    const trimmed = src.replace(/\/+$/, "");
    const base = path.basename(trimmed);
    // `cp -r src/ dst` writes dst/src: only a `.` or `..` basename names the directory itself.
    const standsForDir = asSelf || base === "." || base === ".." || base === "";
    return { target: standsForDir ? dir : `${dir.replace(/\/+$/, "") || "/"}/${base}`, standsForDir };
  });
  return { dir, recursive, targets };
}

/**
 * The indexes of `rest` that are a pattern, script or program rather than a
 * path: the pattern of grep/rg/ag/ack, the script of sed, the program of awk,
 * and the value of find's -name/-path/-regex tests.
 */
function patternOperands(word, rest) {
  const found = new Set();
  const isOption = (t) => t.startsWith("-") && t.length > 1;
  if (word === "find") {
    rest.forEach((t, i) => {
      if (/^-(?:name|iname|path|ipath|wholename|iwholename|regex|iregex)$/.test(t) && i + 1 < rest.length) found.add(i + 1);
    });
    return found;
  }
  const kind = /^(?:e?grep|fgrep|rg|ag|ack)$/.test(word) ? "grep" : word === "sed" ? "sed" : word === "awk" ? "awk" : null;
  if (!kind) return found;
  // Options whose next token is their value and not an operand.
  const valued = kind === "grep" ? /^-[ABCmdDgtTjM]$/ : kind === "awk" ? /^-[Fv]$/ : /^-[lL]$/;
  const explicit = kind === "grep" ? /^(?:-e|--regexp)$/ : /^(?:-e|--expression)$/;
  let sawExplicit = false;
  let firstOperand = -1;
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i];
    if (explicit.test(t) && i + 1 < rest.length) {
      sawExplicit = true;
      found.add(++i);
    } else if (/^(?:-f|--file)$/.test(t) && kind !== "awk") {
      sawExplicit = true;
      i++;
    } else if (t === "-f" && kind === "awk") {
      sawExplicit = true;
      i++;
    } else if (isOption(t)) {
      if (valued.test(t)) i++;
    } else if (firstOperand === -1) firstOperand = i;
  }
  if (!sawExplicit && firstOperand !== -1) found.add(firstOperand);
  return found;
}

/** The text of a command with each `$(...)`, backtick and `<(...)` / `>(...)` body cut out, and those bodies; single quotes hide a body. */
function extractSubstitutions(command) {
  const inner = [];
  let text = "";
  let quote = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote === "'") {
      text += c;
      if (c === "'") quote = null;
      continue;
    }
    if (c === "\\") {
      text += c + (command[i + 1] ?? "");
      i++;
      continue;
    }
    if (c === "'" && quote === null) {
      quote = "'";
      text += c;
      continue;
    }
    if (c === '"') quote = quote === '"' ? null : '"';
    if (c === "`") {
      const end = command.indexOf("`", i + 1);
      const stop = end === -1 ? command.length : end;
      inner.push(command.slice(i + 1, stop));
      text += "SUBST";
      i = stop;
    } else if (command[i + 1] === "(" && (c === "$" || (quote === null && (c === "<" || c === ">")))) {
      let depth = 1;
      let j = i + 2;
      for (; j < command.length && depth > 0; j++) {
        if (command[j] === "(") depth++;
        else if (command[j] === ")") depth--;
      }
      inner.push(command.slice(i + 2, depth === 0 ? j - 1 : j));
      text += "SUBST";
      i = j - 1;
    } else text += c;
  }
  return { text, inner };
}

/** The first git argument that is not one of git's global options (`-C dir`, `-c k=v`, `--git-dir=...`), i.e. its subcommand. */
function gitSubcommand(rest) {
  return gitParts(rest).sub;
}

/** The subcommand of a git argument list, where it sits, and the `-C` directories before it. */
function gitParts(rest) {
  const dirs = [];
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i];
    if (!t.startsWith("-")) return { sub: t, subIndex: i, dirs };
    if (["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--super-prefix"].includes(t)) {
      if (t === "-C" && i + 1 < rest.length) dirs.push(rest[i + 1]);
      i++;
    }
  }
  return { sub: undefined, subIndex: rest.length, dirs };
}

/** One path component as a regular expression: `*`, `?`, `[..]` and `{a,b}` are the shell's, everything else literal. */
function globRe(component) {
  const body = component
    .replace(/[.+^$()|\\]/g, "\\$&")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\{([^{}]*)\}/g, (_, alts) => `(?:${alts.split(",").join("|")})`);
  try {
    return new RegExp(`^${body}$`);
  } catch {
    return /^$/;
  }
}

/**
 * The deny.paths entry that the absolute path `f`, which may hold wildcards,
 * can reach: `f` names it or something under it, a `**` component can lead to
 * it, or, when `recursive`, `f` is a directory that contains it. A wildcard
 * component is matched against the entry's component at the same depth.
 */
function reachesDenied(f, denyPaths, recursive) {
  const g = f.split("/").filter(Boolean);
  for (const d of denyPaths) {
    const e = d.split("/").filter(Boolean);
    for (let i = 0; ; i++) {
      if (i >= e.length) return d;
      if (i >= g.length) {
        if (recursive) return d;
        break;
      }
      if (g[i] === "**") return d;
      if (g[i] !== e[i] && !globRe(g[i]).test(e[i])) break;
    }
  }
  return null;
}

/**
 * The operands a recursive form searches or copies, or null when the command
 * is not one: grep -r, rg, ag, ack, find, ls -R, tree, cp -r, tar and rsync.
 * With no operand a search starts at `.`.
 */
function recursiveOperands(word, rest) {
  const flagged = (re, long) => rest.some((t) => re.test(t) || (long && long.test(t)));
  const plain = (list) => list.filter((t) => !t.startsWith("-"));
  if (/^(?:e?grep|fgrep)$/.test(word)) {
    if (!flagged(/^-[A-Za-z]*[rR][A-Za-z]*$/, /^--(?:dereference-)?recursive$|^--directories=recurse$/)) return null;
    const text = patternOperands(word, rest);
    const list = rest.filter((t, i) => !text.has(i) && !t.startsWith("-"));
    return list.length ? list : ["."];
  }
  if (/^(?:rg|ag|ack)$/.test(word)) {
    const text = patternOperands(word, rest);
    const list = rest.filter((t, i) => !text.has(i) && !t.startsWith("-"));
    return list.length ? list : ["."];
  }
  if (word === "find") {
    const start = [];
    for (const t of rest) {
      if (/^-[HLP]$/.test(t)) continue;
      if (t.startsWith("-") || t === "(" || t === "!") break;
      start.push(t);
    }
    return start.length ? start : ["."];
  }
  if (word === "ls") {
    if (!flagged(/^-[A-Za-z]*R[A-Za-z]*$/, /^--recursive$/)) return null;
    const list = plain(rest);
    return list.length ? list : ["."];
  }
  if (word === "tree") {
    const list = plain(rest);
    return list.length ? list : ["."];
  }
  if (word === "cp") return flagged(/^-[A-Za-z]*[rRa][A-Za-z]*$/, /^--(?:recursive|archive)$/) ? plain(rest) : null;
  if (word === "tar" || word === "rsync") return plain(rest);
  return null;
}

/**
 * The alternatives of a token's first top-level `{a,b}` group, expanded
 * recursively as the shell does (`docs/{a,}` is `docs/a` and `docs/`). A `${`
 * is a variable, a group without a comma is literal, and an expansion past
 * 256 words is left as written.
 */
function braceExpand(token, budget = { left: 256 }) {
  for (let i = 0; i < token.length; i++) {
    if (token[i] === "\\") {
      i++;
      continue;
    }
    if (token[i] !== "{" || token[i - 1] === "$") continue;
    let depth = 0;
    const commas = [];
    let close = -1;
    for (let j = i; j < token.length; j++) {
      if (token[j] === "{") depth++;
      else if (token[j] === "}" && --depth === 0) {
        close = j;
        break;
      } else if (token[j] === "," && depth === 1) commas.push(j);
    }
    if (close === -1 || !commas.length) continue;
    const alts = [];
    let from = i + 1;
    for (const c of [...commas, close]) {
      alts.push(token.slice(from, c));
      from = c + 1;
    }
    if (alts.length > budget.left) return [token];
    budget.left -= alts.length;
    const head = token.slice(0, i);
    const tail = token.slice(close + 1);
    return alts.flatMap((a) => braceExpand(head + a + tail, budget));
  }
  return [token];
}

/**
 * The protected path that a wildcard in one of `forms` can name, or a path
 * under it, or null. Each wildcard component is matched against the protected
 * path's component at the same depth; like the shell's, a leading `*`, `?` or
 * `[` does not match a name that starts with a dot.
 */
function wildcardNames(forms, protectedList) {
  for (const f of forms) {
    if (!/[*?[]/.test(f)) continue;
    const g = f.split("/").filter(Boolean);
    for (const p of protectedList) {
      const e = p.split("/").filter(Boolean);
      if (g.length < e.length) continue;
      if (e.every((c, i) => g[i] === c || (/[*?[]/.test(g[i]) && !(c.startsWith(".") && /^[*?[]/.test(g[i])) && globRe(g[i]).test(c)))) return p;
    }
  }
  return null;
}

/**
 * A glob operand's verdict: the protected path whose next component, below the
 * glob's literal directory, the glob's first wildcard component matches, or null.
 */
function globHit(forms, protectedList) {
  for (const f of forms) {
    const parts = f.split("/");
    const at = parts.findIndex((c) => /[*?[]/.test(c));
    if (at === -1) continue;
    const dir = parts.slice(0, at).join("/") || "/";
    const re = globRe(parts[at]);
    for (const p of protectedList) {
      if (p === dir || !underPrefix(p, dir)) continue;
      const next = p.slice(dir === "/" ? 1 : dir.length + 1).split("/")[0];
      if (re.test(next)) return p;
    }
  }
  return null;
}

/**
 * A git form that restores the worktree to the last commit (stash, reset
 * --hard|--merge|--keep, checkout -f, switch -f|--discard-changes): its name
 * and the pathspecs it is limited to, or null.
 */
function worktreeDiscard({ sub, subIndex }, rest) {
  const args = rest.slice(subIndex + 1);
  const flags = args.filter((t) => t.startsWith("-"));
  const dd = args.indexOf("--");
  const afterDashes = dd === -1 ? [] : args.slice(dd + 1);
  if (sub === "stash") {
    // The value of -m/--message is a message, not the subcommand: `git stash -m wip` is a push.
    const first = args.find((t, i) => !t.startsWith("-") && !/^(?:-m|--message)$/.test(args[i - 1] ?? ""));
    if (first !== undefined && first !== "push" && first !== "save") return null;
    if (first === "save") return { form: "stash", pathspecs: [] };
    const operands = [];
    for (let i = first === "push" ? args.indexOf("push") + 1 : 0; i < args.length; i++) {
      if (args[i] === "--") {
        operands.push(...args.slice(i + 1));
        break;
      }
      if (/^(?:-m|--message)$/.test(args[i])) i++;
      else if (!args[i].startsWith("-")) operands.push(args[i]);
    }
    return { form: "stash", pathspecs: operands };
  }
  if (sub === "reset" && flags.some((t) => /^--(?:hard|merge|keep)$/.test(t))) return { form: "reset --hard", pathspecs: afterDashes };
  if (sub === "checkout" && flags.some((t) => t === "--force" || /^-[A-Za-z]*f[A-Za-z]*$/.test(t))) return { form: "checkout -f", pathspecs: afterDashes };
  if (sub === "read-tree" && flags.some((t) => /^-[A-Za-z]*u[A-Za-z]*$/.test(t)) && flags.some((t) => t === "--reset" || /^-[A-Za-z]*m[A-Za-z]*$/.test(t))) return { form: "read-tree -u", pathspecs: [] };
  if (sub === "switch" && flags.some((t) => t === "--force" || t === "--discard-changes" || /^-[A-Za-z]*f[A-Za-z]*$/.test(t))) return { form: "switch -f", pathspecs: [] };
  return null;
}

/**
 * A segment without the shell grammar around its command: leading `(`, `{`,
 * `!` and the reserved words if/then/elif/else/while/until/do, a function
 * header (`f()`, `function f`), `case <word> in`, a case arm's `pattern)` (only
 * `inCase`) and `esac`, and trailing `)`. `opens` and `closes` count the
 * subshell parentheses removed; `entersCase` and `leavesCase` report the case
 * keywords.
 */
function stripGrouping(raw, inCase = false) {
  let segment = raw.trim();
  let opens = 0;
  let closes = 0;
  let entersCase = false;
  let leavesCase = false;
  for (;;) {
    const m = /^(?:\(|\{(?=\s|$)|!(?=\s)|(?:if|then|elif|else|while|until|do)(?=\s|$)|function\s+[\w.:-]+(?:\s*\(\s*\))?(?=\s|\{|$)|[\w.:-]+\s*\(\s*\)(?=\s|\{|$)|case\s+\S+\s+in(?=\s|$)|esac(?=\s|$))\s*/.exec(segment);
    if (m) {
      if (m[0].startsWith("(")) opens++;
      if (m[0].startsWith("case")) entersCase = true;
      if (m[0].startsWith("esac")) leavesCase = true;
      segment = segment.slice(m[0].length);
      continue;
    }
    const arm = inCase || entersCase ? /^\(?[^\s()]+\)\s*/.exec(segment) : null;
    if (!arm) break;
    segment = segment.slice(arm[0].length);
  }
  for (;;) {
    const m = /\s*\)\s*$/.exec(segment);
    if (!m || /\\$/.test(segment.slice(0, m.index))) break;
    closes++;
    segment = segment.slice(0, m.index);
  }
  return { segment, opens, closes, entersCase, leavesCase };
}

/**
 * The operands a destructive write-family form removes, moves away or rewrites
 * wholesale: rm, mv sources, recursive chmod/chown, and git rm/mv/checkout/
 * restore/clean.
 */
function destructiveOperands(word, rest) {
  const operands = (list) => list.filter((t) => !t.startsWith("-"));
  if (word === "rm") return operands(rest);
  if (word === "mv") return operands(rest).slice(0, -1);
  // Not only recursively: `chmod 000 docs` hides docs/cleanroom.json from the guard's own existence check.
  if (word === "chmod" || word === "chown") return operands(rest);
  if (word === "git") {
    const { sub, subIndex, dirs } = gitParts(rest);
    if (["rm", "mv", "checkout", "restore", "clean"].includes(sub)) {
      const list = operands(rest.slice(subIndex + 1));
      // `git -C dir clean -fdx` rewrites the whole of dir.
      if (!list.length && dirs.length) return ["."];
      return sub === "mv" ? list.slice(0, -1) : list;
    }
  }
  return [];
}

/**
 * The targets of `>` and `>>` redirections in one segment, with their fd
 * prefixes (`2>`, `&>`) removed. Scans the raw text, so a redirection glued to
 * the word before it (`echo hi>file`) is seen, and a `>` inside quotes is not.
 */
function redirectTargets(segment) {
  const targets = [];
  let quote = null;
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i];
    if (quote) {
      if (c === "\\" && quote === '"') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') quote = c;
    else if (c === "\\") i++;
    else if (c === ">") {
      let j = i + 1;
      if (segment[j] === ">" || segment[j] === "|") j++;
      if (segment[j] === "&" && /^&(\d+|-)(\s|$)/.test(segment.slice(j))) {
        i = j;
        continue;
      }
      if (segment[j] === "&") j++;
      const word = shellWords(segment.slice(j).replace(/^\s+/, "").split(/[\s<>]/)[0] ?? "")[0];
      if (word) targets.push(word);
      i = j - 1;
    }
  }
  return targets;
}

// ---------------------------------------------------------------- coverage gaps

/** What the guard cannot see, stated in every bundle's manifest as coverage.knownLimits (SPEC D-03). */
export const KNOWN_LIMITS = [
  "Interpreter escapes (python3 -c, node -e) are not parsed, so a path or word inside the quoted program is not seen.",
  "Shell variables other than $HOME, and strings assembled at run time (a base64 decode, a variable holding a command), are not expanded, so a path or command built that way is not seen.",
  "Subprocesses of a make target are not individual tool calls, so what they read is not logged.",
  "MCP server internals are not tool calls, so what a server reads on its own is not logged.",
  "Hooks load at session start, so a session that writes the policy is not covered until the next one; the gate's liveness check catches a session with no hooks at all.",
  "Commands that run a command from their arguments (find -exec, watch, parallel, busybox) and programs outside the fixed network and write lists (unlink, shred, perl -i, cargo fetch, rsync) are not recognized.",
  "pathPatterns regexes are matched on the paths a call names, not on the files a recursive read or a glob reaches below a directory.",
];

/**
 * The places the log does not vouch for the work, from the entries and the
 * lines of commits.txt (<sha>\x1f<%G?>\x1f<subject>\x1f<stage>\x1f<task>). The
 * kinds, shapes and order are the ones scripts/verify-attestation.mjs recomputes,
 * which has its own copy of these definitions so a bundle can be checked alone.
 */
export function coverageGaps(entries, commitLines, { idleGapHours }) {
  if (typeof idleGapHours !== "number" || !(idleGapHours > 0)) throw new CleanroomError("coverageGaps needs idleGapHours, a positive number of hours");
  const commits = commitLines.filter(Boolean).map((line) => {
    const [sha, signature, subject, stage] = line.split("\x1f");
    return { sha, signature, subject, stage: stage ?? "" };
  });
  const gaps = [];
  for (let i = 1; i < entries.length; i++) {
    if (entries[i].kind === "gate" && entries[i - 1].kind === "gate") gaps.push({ kind: "silent-gates", from: entries[i - 1].seq, to: entries[i].seq });
  }
  for (const c of commits) if (c.stage === "") gaps.push({ kind: "untrailed-commit", sha: c.sha, subject: c.subject });
  for (const e of entries) if (e.kind === "human" && e.data?.kind === "intervention") gaps.push({ kind: "intervention", seq: e.seq });
  for (let i = 1; i < entries.length; i++) {
    const a = entries[i - 1];
    const b = entries[i];
    if (a.stage === null || a.stage !== b.stage) continue;
    const hours = (Date.parse(b.at) - Date.parse(a.at)) / 3600000;
    if (hours > idleGapHours) gaps.push({ kind: "idle", from: a.seq, to: b.seq, hours: Math.round(hours * 100) / 100 });
  }
  for (const c of commits) if (c.signature === "N" || c.signature === "B") gaps.push({ kind: "unsigned-commit", sha: c.sha });
  return gaps;
}

// ---------------------------------------------------------------- what an attestation counts

/** The tools whose calls can read something, for the manifest's readCapable count. */
export const READ_CAPABLE_TOOLS = ["Read", "Glob", "Grep", "Bash", "WebFetch"];
export const VERDICT_CLASSES = ["prior-art attempt", "false positive", "offline test"];

/**
 * The counts a manifest carries, from the log's entries alone: the denials with
 * the operator's verdicts on them, the calls the guard decided, and the human
 * entries. A verdict counts when it names a denied entry's seq; the latest
 * one for a denial wins. scripts/verify-attestation.mjs recounts all of it.
 */
export function summarizeEntries(entries) {
  const denied = entries.filter((e) => e.kind === "denied");
  const byReason = {};
  for (const e of denied) {
    const reason = e.reason ?? "(no reason)";
    byReason[reason] = (byReason[reason] ?? 0) + 1;
  }
  const verdictOf = new Map();
  for (const e of entries) {
    const m = e.kind === "human" && e.data?.kind === "verdict" ? /^#(\d+): (prior-art attempt|false positive|offline test)\b/.exec(e.target ?? "") : null;
    if (m && denied.some((d) => d.seq === Number(m[1]))) verdictOf.set(Number(m[1]), m[2]);
  }
  const verdicts = Object.fromEntries(VERDICT_CLASSES.map((c) => [c, 0]));
  for (const c of verdictOf.values()) verdicts[c] += 1;
  verdicts.unclassified = denied.filter((d) => !verdictOf.has(d.seq)).length;

  const calls = entries.filter((e) => e.kind === "allowed" || e.kind === "denied");
  const count = (list, key) => {
    const out = {};
    for (const e of list) {
      const k = e[key] ?? "(none)";
      out[k] = (out[k] ?? 0) + 1;
    }
    return out;
  };
  const humans = entries.filter((e) => e.kind === "human");
  return {
    denials: { total: denied.length, byReason, verdicts },
    calls: { total: calls.length, byTool: count(calls, "tool"), byStage: count(calls, "stage"), readCapable: calls.filter((e) => READ_CAPABLE_TOOLS.includes(e.tool)).length },
    // A prompt the hook logged carries no data; a record carries its kind.
    human: {
      instructions: humans.filter((e) => !e.data || e.data.kind === "instruction").length,
      interventions: humans.filter((e) => e.data?.kind === "intervention").length,
      verdicts: humans.filter((e) => e.data?.kind === "verdict").length,
    },
  };
}

/** Base64 Ed25519 signature over exactly these bytes: the manifest's. */
export function signBytes(bytes, privateKey) {
  return sign(null, bytes, privateKey).toString("base64");
}

// ---------------------------------------------------------------- the lexical scorer: lexers

export const LANGUAGES = ["rust", "c", "cpp", "go", "python", "javascript", "typescript", "java", "php"];

// The shared keyword classes of the normalized vocabulary. A word becomes a class only when the language
// treats it as a keyword, so `type` is TYPEDEF in Rust and an ordinary identifier in C.
const KEYWORD_CLASS = {
  if: "if", else: "else", for: "LOOP", while: "LOOP", loop: "LOOP", do: "LOOP", match: "SWITCH", switch: "SWITCH",
  return: "return", break: "break", continue: "continue",
  fn: "FN", func: "FN", def: "FN", function: "FN",
  struct: "TYPEDEF", enum: "TYPEDEF", union: "TYPEDEF", type: "TYPEDEF", typedef: "TYPEDEF", class: "TYPEDEF", interface: "TYPEDEF",
};

const words = (s) => new Set(s.split(/\s+/).filter(Boolean));
// Two keywords the server-synchronous constraint would flag as code, spelled in pieces because it is a line pattern.
const ASYNC_AWAIT = `${"as" + "ync"} ${"aw" + "ait"}`;

const C_TYPES = "int char short long float double void signed unsigned bool size_t ssize_t ptrdiff_t int8_t int16_t int32_t int64_t uint8_t uint16_t uint32_t uint64_t intptr_t uintptr_t";
const C_KEYWORDS = "if else for while do switch case default return break continue goto struct enum union typedef sizeof static const volatile extern inline register auto restrict _Bool";

/** One spec per language family; the scanner below reads these and nothing else about a language. */
const SPECS = {
  rust: {
    lineComments: ["//"], blockComments: [["/*", "*/"]], nestedBlocks: true,
    stringQuotes: ['"'], charQuotes: ["'"], rustStrings: true, lifetimes: true,
    types: words("i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 bool char str"),
    keywords: words(`as ${ASYNC_AWAIT} break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while`),
  },
  c: {
    lineComments: ["//"], blockComments: [["/*", "*/"]], nestedBlocks: false,
    stringQuotes: ['"'], charQuotes: ["'"], preprocessor: true, wideLiterals: true,
    types: words(C_TYPES), keywords: words(C_KEYWORDS),
  },
  cpp: {
    lineComments: ["//"], blockComments: [["/*", "*/"]], nestedBlocks: false,
    stringQuotes: ['"'], charQuotes: ["'"], preprocessor: true, wideLiterals: true, cxxRawStrings: true,
    types: words(C_TYPES), keywords: words(`${C_KEYWORDS} class namespace template typename public private protected virtual new delete using try catch throw nullptr this operator explicit friend mutable override final constexpr noexcept auto true false`),
  },
};

const PYTHON_KEYWORDS = "def class if elif else for while try except finally with as import from return break continue pass lambda yield raise assert global nonlocal in is not and or None True False del";
const JS_KEYWORDS = `function class if else for while do switch return break continue var let const new delete this typeof instanceof in of yield ${ASYNC_AWAIT} try catch finally throw import export default case null undefined true false void with extends super static get set`;
SPECS.go = {
  lineComments: ["//"], blockComments: [["/*", "*/"]], nestedBlocks: false,
  stringQuotes: ['"'], charQuotes: ["'"], backtickStrings: "raw",
  types: words("int int8 int16 int32 int64 uint uint8 uint16 uint32 uint64 uintptr float32 float64 complex64 complex128 string bool byte rune error any"),
  keywords: words("func type struct interface for if else return break continue switch select case default map chan go defer range var const package import fallthrough goto"),
};
SPECS.python = {
  lineComments: ["#"], blockComments: [], nestedBlocks: false,
  stringQuotes: ['"', "'"], charQuotes: [], tripleQuotes: ['"""', "'''"], stringPrefixes: true, docstrings: true,
  types: words("int float str bool bytes list dict set tuple complex object"),
  keywords: words(`${PYTHON_KEYWORDS} ${ASYNC_AWAIT}`),
};
SPECS.javascript = {
  lineComments: ["//"], blockComments: [["/*", "*/"]], nestedBlocks: false,
  stringQuotes: ['"', "'"], charQuotes: [], backtickStrings: "template", dollarIdent: true,
  types: words(""), keywords: words(JS_KEYWORDS),
};
SPECS.typescript = {
  ...SPECS.javascript,
  types: words("number string boolean any never unknown object symbol bigint"),
  keywords: words(`${JS_KEYWORDS} interface type enum implements namespace declare readonly abstract keyof public private protected`),
};
SPECS.java = {
  lineComments: ["//"], blockComments: [["/*", "*/"]], nestedBlocks: false,
  stringQuotes: ['"'], charQuotes: ["'"], tripleQuotes: ['"""'],
  types: words("int long short byte char float double boolean void"),
  keywords: words("class interface enum if else for while do switch return break continue public private protected static final abstract new this super extends implements import package try catch finally throw throws case default instanceof synchronized volatile transient native assert null true false var"),
};
SPECS.php = {
  lineComments: ["//", "#"], blockComments: [["/*", "*/"]], nestedBlocks: false,
  stringQuotes: ['"', "'"], charQuotes: [], dollarIdent: true, phpTags: true,
  types: words("int float string bool array callable iterable object mixed void never"),
  keywords: words("function class interface trait enum if elseif else for foreach while do switch match return break continue echo print public private protected static final abstract new extends implements namespace use try catch finally throw const global isset empty case default"),
};

const OPERATORS = [
  "<<=", ">>=", "...", "..=", "->*",
  "::", ":=", "->", "=>", "==", "!=", "<=", ">=", "&&", "||", "<<", ">>", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "++", "--", "..", ".*", "?.", "??", "**", "===", "!==",
];
const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[A-Za-z0-9_]/;

/**
 * Lex `text` into the normalized token stream and the comments, by the rules of
 * one language family (SPEC E-02). Identifiers become ID, numbers NUM, strings STR,
 * chars CHAR, primitive type names TYPE, the shared keyword classes their class, and
 * every other keyword, operator and punctuation mark itself. Never throws on malformed
 * input: an unterminated literal or comment simply runs to the end of the text.
 */
export function tokenize(text, language) {
  if (!LANGUAGES.includes(language)) throw new CleanroomError(`unknown language ${JSON.stringify(language)}; the shipped lexers are ${LANGUAGES.join(", ")}`);
  const spec = SPECS[language];
  if (!spec) throw new CleanroomError(`the ${language} lexer is not available in this build`);
  const tokens = [];
  const comments = [];
  const identifiers = []; // the raw text of every identifier, for the identifier metrics
  const n = text.length;
  const at = (i) => (i < n ? text[i] : "");
  const startsWith = (i, s) => text.startsWith(s, i);
  const identStart = spec.dollarIdent ? /[A-Za-z_$]/ : IDENT_START;
  const identPart = spec.dollarIdent ? /[A-Za-z0-9_$]/ : IDENT_PART;
  let i = 0;
  let lineStart = true; // only whitespace so far on this line, for preprocessor detection

  /** Index after a quoted literal opening at `i`, honouring backslash escapes; an unterminated one ends at the text. */
  const skipQuoted = (from, quote) => {
    let j = from + 1;
    while (j < n && text[j] !== quote) j += text[j] === "\\" ? 2 : 1;
    return Math.min(j + 1, n);
  };

  while (i < n) {
    const c = text[i];
    if (c === "\n") {
      lineStart = true;
      i++;
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    // preprocessor lines (C family): skipped whole, backslash continuations included
    if (spec.preprocessor && c === "#" && lineStart) {
      while (i < n && text[i] !== "\n") {
        if (text[i] === "\\" && at(i + 1) === "\n") i++;
        i++;
      }
      continue;
    }
    const atLineStart = lineStart;
    lineStart = false;
    // PHP open and close tags are tokens of their own, not operators
    if (spec.phpTags && (startsWith(i, "<?php") || startsWith(i, "<?=") || startsWith(i, "?>"))) {
      const tag = startsWith(i, "<?php") ? "<?php" : startsWith(i, "<?=") ? "<?=" : "?>";
      tokens.push(tag);
      i += tag.length;
      continue;
    }
    // Python: a triple-quoted string that starts its line is a docstring, which counts as a comment
    const triple = spec.tripleQuotes?.find((q) => startsWith(i, q));
    if (triple) {
      const end = text.indexOf(triple, i + 3);
      const stop = end < 0 ? n : end;
      if (spec.docstrings && atLineStart) comments.push(text.slice(i + 3, stop));
      else tokens.push("STR");
      i = end < 0 ? n : end + 3;
      continue;
    }
    // comments
    const line = spec.lineComments.find((m) => startsWith(i, m) && !(m === "#" && at(i + 1) === "["));
    if (line) {
      const end = text.indexOf("\n", i);
      const stop = end < 0 ? n : end;
      comments.push(text.slice(i + line.length, stop));
      i = stop;
      continue;
    }
    const block = spec.blockComments.find(([open]) => startsWith(i, open));
    if (block) {
      const [open, close] = block;
      let depth = 1;
      let j = i + open.length;
      while (j < n && depth > 0) {
        if (spec.nestedBlocks && startsWith(j, open)) {
          depth++;
          j += open.length;
        } else if (startsWith(j, close)) {
          depth--;
          j += close.length;
        } else j++;
      }
      comments.push(text.slice(i + open.length, depth === 0 ? j - close.length : j));
      i = j;
      continue;
    }
    // Rust raw and byte strings: r"..", r#".."#, b"..", br#".."#, and byte chars b'x'
    if (spec.rustStrings && (c === "r" || c === "b")) {
      const m = /^(?:br|rb|r|b)(#*)"/.exec(text.slice(i, i + 12));
      if (m && (m[0].startsWith("r") || m[0].startsWith("br") || m[0].startsWith("rb"))) {
        const close = `"${m[1]}`;
        const end = text.indexOf(close, i + m[0].length);
        tokens.push("STR");
        i = end < 0 ? n : end + close.length;
        continue;
      }
      if (c === "b" && at(i + 1) === '"') {
        tokens.push("STR");
        i = skipQuoted(i + 1, '"');
        continue;
      }
      if (c === "b" && at(i + 1) === "'") {
        tokens.push("CHAR");
        i = skipQuoted(i + 1, "'");
        continue;
      }
    }
    // C++ raw strings: R"delim( ... )delim"
    if (spec.cxxRawStrings && c === "R" && at(i + 1) === '"') {
      const m = /^R"([^()\\\s]{0,16})\(/.exec(text.slice(i, i + 24));
      if (m) {
        const close = `)${m[1]}"`;
        const end = text.indexOf(close, i + m[0].length);
        tokens.push("STR");
        i = end < 0 ? n : end + close.length;
        continue;
      }
    }
    // identifiers, keywords, types (and C/C++ wide-literal prefixes such as L"x")
    if (identStart.test(c)) {
      let j = i + 1;
      while (j < n && identPart.test(text[j])) j++;
      const word = text.slice(i, j);
      if (spec.stringPrefixes && /^[rRbBuUfF]{1,2}$/.test(word) && (at(j) === '"' || at(j) === "'")) {
        i = j; // a Python string prefix belongs to the string that follows
        continue;
      }
      if (spec.dollarIdent && word.startsWith("$") && word.length > 1) {
        tokens.push("ID");
        i = j;
        continue;
      }
      if (spec.wideLiterals && ["L", "u", "U", "u8"].includes(word) && (at(j) === '"' || at(j) === "'")) {
        tokens.push(at(j) === '"' ? "STR" : "CHAR");
        i = skipQuoted(j, at(j));
        continue;
      }
      if (spec.keywords.has(word)) tokens.push(KEYWORD_CLASS[word] ?? word);
      else if (spec.types.has(word)) tokens.push("TYPE");
      else {
        tokens.push("ID");
        identifiers.push(word);
      }
      i = j;
      continue;
    }
    // numbers
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(at(i + 1)))) {
      let j = i + 1;
      const hex = c === "0" && /[xX]/.test(at(i + 1));
      while (j < n) {
        const d = text[j];
        if (/[0-9A-Za-z_]/.test(d)) j++;
        else if (d === "." && /[0-9]/.test(at(j + 1))) j++;
        else if ((d === "+" || d === "-") && !hex && /[eE]/.test(text[j - 1]) && /[0-9]/.test(at(j + 1))) j++;
        else break;
      }
      tokens.push("NUM");
      i = j;
      continue;
    }
    // Go raw strings and JavaScript template literals
    if (spec.backtickStrings && c === "`") {
      if (spec.backtickStrings === "raw") {
        const end = text.indexOf("`", i + 1);
        i = end < 0 ? n : end + 1;
      } else i = skipQuoted(i, "`");
      tokens.push("STR");
      continue;
    }
    // strings and chars
    if (spec.stringQuotes.includes(c)) {
      tokens.push("STR");
      i = skipQuoted(i, c);
      continue;
    }
    if (spec.charQuotes.includes(c)) {
      // A Rust lifetime ('a, 'static) is an identifier with a tick, not a char: it is not closed by a second tick.
      if (spec.lifetimes && IDENT_START.test(at(i + 1)) && at(i + 2) !== "'") {
        let j = i + 2;
        while (j < n && IDENT_PART.test(text[j])) j++;
        tokens.push("ID");
        i = j;
        continue;
      }
      tokens.push("CHAR");
      i = skipQuoted(i, c);
      continue;
    }
    // operators and punctuation, longest match first
    const op = OPERATORS.find((o) => startsWith(i, o));
    if (op) {
      tokens.push(op);
      i += op.length;
      continue;
    }
    tokens.push(c);
    i++;
  }
  return { tokens, comments, identifiers };
}

// ---------------------------------------------------------------- the lexical scorer: metrics

const jaccard = (a, b) => {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
};
const containment = (a, b) => {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const smaller = Math.min(a.size, b.size);
  return smaller === 0 ? 0 : inter / smaller;
};

/** Every n-gram of `items` as a joined string; fewer than n items give none. */
function addShingles(set, items, n) {
  for (let k = 0; k + n <= items.length; k++) set.add(items.slice(k, k + n).join(" "));
}

/** What one side of a pair contributes: shingle sets per n (never spanning a file), identifier set, comment shingles. */
function sideProfile(files, { ngram, minIdentLen, commentNgram, exclusions }) {
  const shingles = new Map(ngram.map((n) => [n, new Set()]));
  const identifiers = new Set();
  const commentShingles = new Set();
  for (const file of files) {
    const { tokens, comments, identifiers: ids } = tokenize(file.text, file.language);
    for (const [n, set] of shingles) addShingles(set, tokens, n);
    for (const id of ids) if (id.length >= minIdentLen && !exclusions.has(id)) identifiers.add(id);
    addShingles(commentShingles, comments.join(" ").toLowerCase().split(/\s+/).filter(Boolean), commentNgram);
  }
  return { shingles, identifiers, commentShingles };
}

/**
 * Score two sets of files against each other (SPEC E-02). `left` and `right`
 * are arrays of `{ path, text, language }`; the result has one number per metric:
 * `ngram_jaccard@n` and `ngram_containment@n` for each n, `ident_jaccard`,
 * `ident_match_rate_left` and `comment_jaccard`.
 */
export function scorePair(left, right, opts) {
  const o = { ngram: [5, 10], minIdentLen: 6, commentNgram: 5, exclusions: new Set(), ...opts };
  const a = sideProfile(left, o);
  const b = sideProfile(right, o);
  const rows = {};
  for (const n of o.ngram) {
    rows[`ngram_jaccard@${n}`] = jaccard(a.shingles.get(n), b.shingles.get(n));
    rows[`ngram_containment@${n}`] = containment(a.shingles.get(n), b.shingles.get(n));
  }
  rows.ident_jaccard = jaccard(a.identifiers, b.identifiers);
  let shared = 0;
  for (const id of a.identifiers) if (b.identifiers.has(id)) shared++;
  rows.ident_match_rate_left = a.identifiers.size === 0 ? 0 : shared / a.identifiers.size;
  rows.comment_jaccard = jaccard(a.commentShingles, b.commentShingles);
  return rows;
}

export const BANDS = ["below negative", "at or near negative", "between", "at or near positive", "above positive"];

/**
 * Where a test pair's score falls between the controls: `c = (test - neg) / (pos - neg)`,
 * in bands fixed before anything is measured. Controls that do not differ by more than
 * `separationMargin` cannot position anything: `not separated`.
 */
export function position(sTest, sNeg, sPos, { near, separationMargin }) {
  if (sPos - sNeg <= separationMargin) return { c: null, band: "not separated" };
  const c = (sTest - sNeg) / (sPos - sNeg);
  let band;
  if (c < 0) band = BANDS[0];
  else if (c <= near) band = BANDS[1];
  else if (c < 1 - near) band = BANDS[2];
  else if (c <= 1) band = BANDS[3];
  else band = BANDS[4];
  return { c, band };
}

/**
 * The verdict line over the test pairs' rows `{ pair, metric, score, c, band }`:
 * independence is supported only when every test pair sits at or below the negative
 * control on every metric that separates the controls.
 */
export function verdictOf(rows) {
  const separable = rows.filter((r) => r.band !== "not separated");
  if (!separable.length) return "no metric separates the controls";
  const failing = separable.filter((r) => r.band !== BANDS[0] && r.band !== BANDS[1]);
  if (!failing.length) return "independence supported on every separable metric";
  return `independence not supported: ${failing.map((r) => `${r.pair}: ${r.metric} is ${r.band}`).join("; ")}`;
}

/** What this scorer cannot show, printed with every result (SPEC E-02). */
export const LIMITS = [
  "This is a lexical approximation of cleanflate-bench's tree-sitter token method: the same normalization but no parse tree, so a C macro body and a Rust impl-for block are handled by rule rather than by grammar.",
  "There is no clone detector: copied logic that was renamed and reordered below the n-gram window is not found.",
  "Cross-language pairs score lower on token metrics by construction, as the bench found: its n-gram metrics did not separate its controls, and its identifier and comment metrics did.",
  "A structural metric needs a same-language positive control.",
  "One target library is n = 1: a score is evidence about this subject and this prior art, not a general property.",
];
