#!/usr/bin/env node
// Kūkulu MCP server — the deterministic half of the pipeline.
//
// Zero dependencies: speaks MCP over stdio (newline-delimited JSON-RPC 2.0)
// directly, so the plugin needs no npm install. Node >= 18.
//
// Everything that should never be left to a language model lives here:
// stage selection, task selection and dependency skipping, checkbox edits,
// log entries, verification runs, review-task formatting, and the commits
// that record each of those. The skills tell the model *when* to call these;
// the tools decide *what happens*.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import {
  CleanroomError, loadPolicy, policyHash, appendEntry, readEntries, logPathFor, generateKey, loadKey, signCheckpoint, verifyCheckpoint, verifyChain, evaluate, lockdownActive, ZERO_HASH, scorePair, position, verdictOf, LIMITS, coverageGaps, KNOWN_LIMITS, summarizeEntries, signBytes,
} from "./cleanroom.mjs";

/**
 * An environment variable by its Kūkulu name. An empty value counts as unset,
 * because .mcp.json passes unset variables through as empty strings.
 */
function envVar(name) {
  return process.env[`KUKULU_${name}`] || undefined;
}

const ROOT = path.resolve(envVar("PROJECT_DIR") || process.cwd());
/** Every path the server reads or writes; the state directory and config file differ between the two layouts. */
function layoutFor(stateName, configName) {
  const stateDir = path.join(ROOT, stateName);
  return {
    spec: path.join(ROOT, "docs", "SPEC.md"),
    plan: path.join(ROOT, "docs", "PLAN.md"),
    progress: path.join(ROOT, "docs", "PROGRESS.md"),
    handoff: path.join(ROOT, "docs", "HANDOFF.md"),
    review: path.join(ROOT, "docs", "REVIEW.md"),
    summary: path.join(ROOT, "docs", "SUMMARY.md"),
    similarityDoc: path.join(ROOT, "docs", "SIMILARITY.md"),
    config: path.join(ROOT, "docs", configName),
    stateDir,
    state: path.join(stateDir, "state.json"),
    lock: path.join(stateDir, "implement.lock"),
    feedback: path.join(stateDir, "feedback.jsonl"),
    mutation: path.join(stateDir, "mutation.json"),
    worktrees: path.join(stateDir, "worktrees"),
    gitignore: path.join(ROOT, ".gitignore"),
    agentsDir: path.join(ROOT, ".claude", "agents"),
    settings: path.join(ROOT, ".claude", "settings.json"),
    settingsLocal: path.join(ROOT, ".claude", "settings.local.json"),
  };
}

// The pre-0.6.0 layout is named from one constant so no other line of this file spells it.
const LEGACY = "foun" + "dry";
const LEGACY_LAYOUT_MESSAGE = `this project is on the pre-0.6.0 ${LEGACY[0].toUpperCase()}${LEGACY.slice(1)} layout, which 0.7.0 no longer reads. Move \`.${LEGACY}/state.json\` and \`.${LEGACY}/feedback.jsonl\` to \`.kukulu/\`, \`docs/${LEGACY}.json\` to \`docs/kukulu.json\`, and the \`.${LEGACY}/\` lines of \`.gitignore\` to \`.kukulu/\`, then commit (0.6.x's \`kukulu_migrate\` did this).`;

const P = layoutFor(".kukulu", "kukulu.json");

const layoutPresent = (stateName, configName) => exists(path.join(ROOT, stateName)) || exists(path.join(ROOT, "docs", configName));

/**
 * Refuse a project on the old layout before any tool runs, because reading
 * either layout while the other exists would silently ignore live state.
 */
function checkLayout() {
  const hasCurrent = layoutPresent(".kukulu", "kukulu.json");
  const hasLegacy = layoutPresent(`.${LEGACY}`, `${LEGACY}.json`);
  if (hasLegacy && !hasCurrent) throw new ToolError(LEGACY_LAYOUT_MESSAGE);
  if (hasCurrent && hasLegacy) {
    throw new ToolError(
      `both the pre-0.6.0 layout (.${LEGACY}/ or docs/${LEGACY}.json) and the current one (.kukulu/ or docs/kukulu.json) exist, so Kūkulu cannot tell which holds the live state. Keep the one you use and remove the other with git, then call again.`,
    );
  }
}

// The one rule an unattended flight needs before its first kukulu_status
// call: without it, a subagent's MCP tool call is denied under every
// permission mode, and the flight stalls silently (F-03). Named once here so
// every place that writes or documents it says the same thing.
const MCP_ALLOW_RULE = "mcp__plugin_kukulu_kukulu";

// The plugin's own root — where agents/*.md ships — derived from this file's
// own location rather than ROOT, because ROOT is the *project* Kūkulu is
// operating on and is almost never the same directory as the installed
// plugin.
const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Keep in sync with .claude-plugin/plugin.json and package.json; test/plugin.mjs checks it.
const VERSION = "0.7.1";

// ---------------------------------------------------------------- clean-room mode (SPEC D-06)

/** Clean-room mode is on when the file at cleanroom.policy exists; there is no flag. */
const cleanroomPolicyPath = (cc) => path.join(ROOT, cc.cleanroom.policy);
const cleanroomOn = (cc) => exists(cleanroomPolicyPath(cc));
const cleanroomLogPath = () => logPathFor(ROOT, process.env);

/** SHA-256 of the files the gate pins: the two hook scripts, hooks.json and the module the guard decides with, as installed under PLUGIN_ROOT. */
function pluginHashes() {
  const of = (rel2) => policyHash(fs.readFileSync(path.join(PLUGIN_ROOT, rel2)));
  return { guardHash: of("scripts/cleanroom-guard.mjs"), loggerHash: of("scripts/cleanroom-log.mjs"), hooksHash: of("hooks/hooks.json"), cleanroomHash: of("mcp/cleanroom.mjs") };
}

/** The signing key, generated first when the file is absent. */
function ensureKey(cc) {
  if (!exists(cc.cleanroom.signingKey)) generateKey(cc.cleanroom.signingKey);
  return loadKey(cc.cleanroom.signingKey);
}

/** Why the flight's mode no longer matches its genesis, or null. Computed on every call, never stored. */
function cleanroomModeBreak(st, policyPresent, planPresent) {
  const cr = st.cleanroom;
  if (policyPresent && cr?.mode === "general") return "a clean-room policy appeared after the flight started in general mode";
  if (policyPresent && !cr && planPresent) return "a clean-room policy was first seen after the plan was written";
  if (!policyPresent && cr?.genesis) return "the clean-room policy file was removed after genesis";
  return null;
}
const modeBreakText = (why) => `clean-room coverage is broken: the mode changed after genesis (${why}); archive this flight with kukulu_flight_archive and start another`;

/**
 * Append the genesis entry and record the hashes the gate will compare against,
 * in one commit with the log. A policy that does not load is a refusal.
 */
function cleanroomGenesis(cc, st) {
  const policyBytes = fs.readFileSync(cleanroomPolicyPath(cc));
  loadPolicy(policyBytes.toString("utf8"));
  const key = ensureKey(cc);
  const hashes = pluginHashes();
  const logPath = cleanroomLogPath();
  const logInRepo = path.relative(ROOT, logPath).startsWith("..") === false;
  const head = git(["rev-parse", "HEAD"], { allowFail: true }).out || null;
  const paths = [P.state, ...(logInRepo ? [logPath] : [])];
  withRollback(paths, () => {
    const entry = appendEntry(logPath, {
      kind: "genesis",
      stage: "controller",
      role: "session",
      data: { mode: "clean-room", policyHash: policyHash(policyBytes), ...hashes, pluginVersion: VERSION, keyFingerprint: key.fingerprint, baseBranch: cc.baseBranch, head },
    });
    st.cleanroom = { genesis: entry.hash, policyHash: policyHash(policyBytes), ...hashes };
    saveState(st);
    gitCommitIfChanged(paths, "chore: clean-room genesis", { stage: "controller" });
  });
}

const GATE_SELF_TEST_MS = 60_000;
const shellQuote = (p) => `'${String(p).replaceAll("'", "'\\''")}'`;

/**
 * The gate (SPEC D-08): before a stage starts, prove the clean-room machinery
 * is still the machinery the flight began with. Checks run in order and the
 * first failure stops them. A failing gate appends its own `gate` entry
 * before anything is refused, which is the one sanctioned write before a
 * refusal: the refusal itself belongs in the chain. Returns null in general
 * mode, else `{ ok, checked, failed? }`.
 */
function runGate(stage, st = loadState()) {
  if (!st.cleanroom?.genesis) return null;
  const cc = cfg();
  const recorded = st.cleanroom;
  const logPath = cleanroomLogPath();
  const policyPath = cleanroomPolicyPath(cc);
  const checked = [];
  const failed = (check, reason) => {
    appendEntry(logPath, { kind: "gate", stage, role: "session", data: { failed: check, reason } });
    return { ok: false, checked, failed: { check, reason } };
  };

  // 1. mode
  checked.push("mode");
  if (!exists(policyPath)) return failed("mode", `the policy file ${cc.cleanroom.policy} is missing`);
  if (recorded.mode === "general") return failed("mode", "the flight was recorded in general mode");

  // 2. policy
  checked.push("policy");
  const policyBytes = fs.readFileSync(policyPath);
  if (policyHash(policyBytes) !== recorded.policyHash) return failed("policy", `${cc.cleanroom.policy} changed since genesis (its SHA-256 no longer matches the recorded one)`);

  // 3. guard: the two hook scripts, hooks.json and mcp/cleanroom.mjs are the ones recorded, and hooks.json still registers the scripts
  checked.push("guard");
  const now = pluginHashes();
  // A flight that began on 0.7.0 recorded no cleanroomHash, so that one comparison is skipped and the passing entry says so.
  const unpinned = recorded.cleanroomHash ? [] : ["mcp/cleanroom.mjs"];
  for (const [key, label] of [["guardHash", "scripts/cleanroom-guard.mjs"], ["loggerHash", "scripts/cleanroom-log.mjs"], ["hooksHash", "hooks/hooks.json"], ["cleanroomHash", "mcp/cleanroom.mjs"]]) {
    if (key === "cleanroomHash" && !recorded.cleanroomHash) continue;
    if (now[key] !== recorded[key]) return failed("guard", `${label} changed since genesis`);
  }
  let hooks;
  try {
    hooks = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, "hooks", "hooks.json"), "utf8")).hooks || {};
  } catch (e) {
    return failed("guard", `hooks/hooks.json cannot be read: ${e.message}`);
  }
  const registers = (event, script) => (hooks[event] || []).some((entry) => (entry.hooks || []).some((h) => String(h.command || "").includes(script)));
  for (const [event, script] of [["PreToolUse", "cleanroom-guard.mjs"], ["PostToolUse", "cleanroom-log.mjs"], ["UserPromptSubmit", "cleanroom-log.mjs"]]) {
    if (!registers(event, script)) return failed("guard", `hooks/hooks.json no longer registers ${script} on ${event}`);
  }

  // 4. self-test
  checked.push("self-test");
  const selfTest = runShell(`node ${shellQuote(path.join(PLUGIN_ROOT, "scripts", "cleanroom-guard.mjs"))} --self-test ${shellQuote(policyPath)}`, GATE_SELF_TEST_MS);
  if (!selfTest.ok) return failed("self-test", (selfTest.stderrTail || selfTest.stdoutTail || `exit ${selfTest.exitCode}`).split("\n")[0]);

  // 5. lockdown: once the lockdown task is done, an allowed URL must be denied
  checked.push("lockdown");
  const policy = loadPolicy(policyBytes.toString("utf8"));
  const progressText = exists(P.progress) ? read(P.progress) : null;
  if (policy.lockdown.after && policy.allow.urls.length && progressText && new RegExp(`^- \\[x\\] ${policy.lockdown.after}\\b`, "m").test(progressText)) {
    const probe = evaluate(policy, { tool_name: "WebFetch", tool_input: { url: policy.allow.urls[0] }, cwd: ROOT }, { root: ROOT, home: os.homedir(), progressText });
    if (probe.decision !== "denied") return failed("lockdown", `lockdown.after ${policy.lockdown.after} is done, but a WebFetch of ${policy.allow.urls[0]} is still allowed`);
  }

  // 6. chain: every hash recomputes, the genesis is the recorded one, and the newest checkpoint verifies
  checked.push("chain");
  const lines = exists(logPath) ? read(logPath).split("\n").filter(Boolean) : [];
  const chain = verifyChain(lines);
  if (!chain.ok) return failed("chain", `entry ${chain.firstBad.seq ?? chain.firstBad.line} (line ${chain.firstBad.line}): ${chain.firstBad.reason}`);
  if (chain.entries[0]?.hash !== recorded.genesis) return failed("chain", "the first entry is not the genesis entry recorded in state.json");
  const newest = [...chain.entries].reverse().find((e) => e.kind === "checkpoint");
  if (newest) {
    let publicKey;
    try {
      publicKey = loadKey(cc.cleanroom.signingKey).publicKey;
    } catch (e) {
      return failed("chain", e.message);
    }
    if (!verifyCheckpoint(newest, publicKey)) return failed("chain", `the newest checkpoint (entry ${newest.seq}) does not verify with the signing key`);
  }

  // 7. liveness: the hooks are recording. A session whose hooks are not loaded produces gates with nothing between them.
  checked.push("liveness");
  const lastGate = chain.entries.map((e) => e.kind).lastIndexOf("gate");
  if (lastGate >= 0 && !chain.entries.slice(lastGate + 1).some((e) => e.kind === "allowed")) {
    return failed("liveness", "no tool call has been logged since the last gate; the clean-room hooks are not running in this session. Start a new session.");
  }

  appendEntry(logPath, { kind: "gate", stage, role: "session", data: { checks: checked.length, ok: true, ...(unpinned.length ? { unpinned } : {}) } });
  return { ok: true, checked };
}

/** A tool's gate: the refusal that comes before any write when the clean-room machinery has changed. */
function requireGate(stage) {
  const g = runGate(stage);
  if (g && !g.ok) throw new ToolError(`clean-room gate failed: ${g.failed.check}: ${g.failed.reason}`);
}

/** The log, as a path list for withRollback and a commit, when this flight is in clean-room mode and the log lives in the repository. */
function cleanroomPaths(st) {
  const logPath = cleanroomLogPath();
  return st.cleanroom?.genesis && !path.relative(ROOT, logPath).startsWith("..") ? [logPath] : [];
}

/**
 * Append a signed checkpoint: the chain tip, the commit it was written at, the
 * hashes of everything the gate pins as they are now, and the key's
 * fingerprint. General mode, and a flight that has no genesis yet, write none.
 * The caller commits the log with its own files.
 */
function checkpoint(event, stage, st) {
  if (!st.cleanroom?.genesis) return;
  const cc = cfg();
  const key = loadKey(cc.cleanroom.signingKey);
  const logPath = cleanroomLogPath();
  const entries = readEntries(logPath);
  const data = signCheckpoint(
    {
      chainTip: entries.length ? entries[entries.length - 1].hash : ZERO_HASH,
      git: git(["rev-parse", "HEAD"]).out,
      policyHash: policyHash(fs.readFileSync(cleanroomPolicyPath(cc))),
      ...(({ guardHash, loggerHash, hooksHash }) => ({ guardHash, loggerHash, hooksHash }))(pluginHashes()),
      keyFingerprint: key.fingerprint,
      event,
    },
    key.privateKey,
  );
  appendEntry(logPath, { kind: "checkpoint", stage, role: "session", data });
}

const CLEANROOM_SENTENCE =
  "This flight is in clean-room mode: every tool call is checked against docs/cleanroom.json and logged; a denied call is never worked around — note it in the task's log and continue another way.";

/** `kukulu_status.cleanroom`: null without a policy file, else the whole state of the mode (SPEC D-01). Never throws on a damaged log or policy; it reports what it can read. */
function cleanroomStatus(st) {
  const cc = cfg();
  const policyPath = cleanroomPolicyPath(cc);
  if (!exists(policyPath)) return null;
  const logPath = cleanroomLogPath();
  let entries = [];
  try {
    entries = readEntries(logPath);
  } catch {
    // a damaged log is the gate's finding; status still answers
  }
  const lastGate = entries.map((e) => e.kind).lastIndexOf("gate");
  const lastCheckpoint = entries.map((e) => e.kind).lastIndexOf("checkpoint");
  const afterMarker = lastGate >= 0 ? lastGate : entries.findIndex((e) => e.kind === "genesis");
  let keyFingerprint = null;
  try {
    if (exists(cc.cleanroom.signingKey)) keyFingerprint = loadKey(cc.cleanroom.signingKey).fingerprint;
  } catch {
    // an unreadable key is reported as absent
  }
  let lockdown = false;
  try {
    lockdown = lockdownActive(loadPolicy(read(policyPath)), exists(P.progress) ? read(P.progress) : null);
  } catch {
    // an invalid policy is the gate's finding
  }
  return {
    policy: cc.cleanroom.policy,
    policyHash: policyHash(fs.readFileSync(policyPath)),
    mode: st.cleanroom?.mode === "general" ? "general" : "clean-room",
    genesis: st.cleanroom?.genesis ?? null,
    pinnedPolicyHash: st.cleanroom?.policyHash ?? null,
    chain: { entries: entries.length, tip: entries.length ? entries[entries.length - 1].hash : null, lastCheckpoint: lastCheckpoint >= 0 ? entries[lastCheckpoint].seq : null },
    denied: entries.filter((e) => e.kind === "denied").length,
    hooksLive: afterMarker >= 0 && entries.slice(afterMarker + 1).some((e) => e.kind === "allowed"),
    keyFingerprint,
    lockdown,
  };
}

/** The `human` entry an operator-initiated tool leaves in the chain, in clean-room mode. */
function humanEntry(st, via, args) {
  if (!st.cleanroom?.genesis) return;
  appendEntry(cleanroomLogPath(), { kind: "human", stage: "controller", role: "operator", target: JSON.stringify(args ?? {}), data: { kind: "instruction", via } });
}

/** The stage a bookkeeping tool's entries are filed under. */
const implementStage = (st) => (st.round >= 1 ? "fix" : "implement");

const TASK_ID = /\b[PR]\d+-\d+\b/g;
const TASK_LINE = /^- \[( |~|x|!|-)\] ([PR]\d+-\d+)(?: (.*))?$/;
// A task in a parallel wave carries its stream as a suffix tag on its
// PROGRESS.md line: `- [ ] P2-03 Title {stream: api}`. The tag is parsed off
// the title (task.stream) and written back verbatim (task.streamTag).
const STREAM_TAG = /\s*\{stream:\s*([a-z][a-z0-9-]{0,23})\}\s*$/;
const STATE_NAMES = { " ": "todo", "~": "inProgress", x: "done", "!": "blocked", "-": "skipped" };

// ---------------------------------------------------------------- utilities

class ToolError extends Error {
  /** `data`, when given, rides on the error reply as structuredContent (see handle()). */
  constructor(message, data) {
    super(message);
    if (data !== undefined) this.data = data;
  }
}

const exists = (p) => fs.existsSync(p);
const read = (p) => fs.readFileSync(p, "utf8");
const write = (p, s) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, s);
};
const rel = (p) => path.relative(ROOT, p);
const today = () => new Date().toISOString().slice(0, 10);

/** Ensure `line` is present in the file at `file`, appending it once if not. Returns whether it added the line. */
function ensureLineInFile(file, line) {
  const cur = exists(file) ? read(file) : "";
  if (cur.split("\n").includes(line)) return false;
  write(file, cur.replace(/\s*$/, "") + (cur ? "\n" : "") + line + "\n");
  return true;
}

function git(args, { allowFail = false, cwd = ROOT } = {}) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0 && !allowFail) {
    throw new ToolError(`git ${args.join(" ")} failed: ${(r.stderr || r.stdout || "").trim()}`);
  }
  return { ok: r.status === 0, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
}

const SIGNING_TIMEOUT_MS = 30_000;
const SIGNING_FAILURE = /gpg failed to sign|failed to sign|signing failed|cannot exec|pinentry|ssh-keygen|gpg:/i;

/**
 * The one place the server runs `git commit`. A signing agent that wants a
 * pinentry would hang the server forever, so the commit is bounded and told
 * never to prompt. Under policies.signing "auto" a signing failure turns
 * signing off for the run and retries once, with the record of that decision
 * in the same commit; under "required" it throws (S-02).
 */
/**
 * In clean-room mode every commit the server makes ends with two trailers,
 * added here and not by a git hook, so `--no-verify` cannot skip them. `task`
 * defaults to the first in-progress task, else `-`.
 */
function withTrailers(message, { stage, task, cleanroom } = {}) {
  if (!(cleanroom ?? Boolean(loadState().cleanroom?.genesis))) return message;
  let taskId = task;
  if (taskId === undefined && exists(P.progress)) taskId = /^- \[~\] (\S+)/m.exec(read(P.progress))?.[1];
  return `${message}\n\nKukulu-Stage: ${stage || "controller"}\nKukulu-Task: ${taskId || "-"}`;
}

function commitStaged(rels, message, opts = {}) {
  const { stage } = opts;
  message = withTrailers(message, opts);
  const run = (args) =>
    spawnSync("git", args, {
      cwd: ROOT,
      encoding: "utf8",
      timeout: SIGNING_TIMEOUT_MS,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
  // A merge in progress refuses `git commit -- <paths>`, so its commit takes whatever is staged.
  const pathspec = (list) => (opts.noPathspec ? [] : ["--", ...list]);
  const r = run(["commit", "-q", "-m", message, ...pathspec(rels)]);
  if (r.status === 0 && !r.error) return;
  const text = (r.stderr || r.stdout || "").trim();
  const timedOut = r.error?.code === "ETIMEDOUT" || Boolean(r.signal);
  if (!timedOut && !SIGNING_FAILURE.test(text)) {
    throw new ToolError(`git commit failed: ${text || r.error?.message || "unknown error"}`);
  }
  const line = timedOut ? "timed out" : text.split("\n")[0];
  let policy = "auto";
  try {
    policy = cfg().policies.signing;
  } catch {
    // a malformed config must not keep a commit from being made
  }
  if (policy === "required") {
    throw new ToolError(`policies.signing is 'required' and the commit could not be signed: ${line}. Nothing was committed; fix the signing agent or set policies.signing to 'off', then call this tool again.`);
  }
  const snapFiles = [P.state, P.feedback].map((f) => [f, exists(f) ? fs.readFileSync(f) : null]);
  const prevSign = git(["config", "--local", "--get", "commit.gpgsign"], { allowFail: true }).out;
  const undoFallback = () => {
    for (const [f, bytes] of snapFiles) {
      if (bytes === null) fs.rmSync(f, { force: true });
      else fs.writeFileSync(f, bytes);
    }
    git(["reset", "-q", "--", rel(P.state), rel(P.feedback)], { allowFail: true });
    if (prevSign) git(["config", "--local", "commit.gpgsign", prevSign], { allowFail: true });
    else git(["config", "--local", "--unset", "commit.gpgsign"], { allowFail: true });
  };
  git(["config", "--local", "commit.gpgsign", "false"]);
  const st = loadState();
  st.signing = `off (commit signing failed: ${line})`;
  st.signingOverride = true;
  saveState(st);
  if (feedbackEnabled()) appendFeedback(stage || "implement", `Signing disabled for this run: ${st.signing}`, "signing", "auto");
  const all = [...new Set([...rels, rel(P.state), rel(P.feedback)])].filter((x) => exists(path.join(ROOT, x)));
  let retry;
  try {
    git(["add", "-A", "--", ...all]);
    retry = run(["-c", "commit.gpgsign=false", "commit", "-q", "-m", message, ...pathspec(all)]);
  } catch (e) {
    undoFallback();
    throw e;
  }
  if (retry.status !== 0 || retry.error) {
    undoFallback();
    throw new ToolError(`git commit failed even unsigned: ${(retry.stderr || retry.stdout || retry.error?.message || "").trim()}`);
  }
}

/**
 * Run a tool's write-then-commit section so that if it throws, every file it
 * may have written is put back byte for byte (or deleted if it did not exist)
 * and the index is unstaged, then the original error is rethrown. A tool that
 * fails therefore leaves the tree as it found it and is safe to call again.
 * Every writing tool uses this; never copy the logic into a tool.
 */
function withRollback(paths, fn) {
  const snaps = paths.map((p) => [p, exists(p) ? fs.readFileSync(p) : null]);
  try {
    return fn();
  } catch (e) {
    for (const [p, bytes] of snaps) {
      if (bytes === null) fs.rmSync(p, { force: true });
      else {
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, bytes);
      }
    }
    const rels = paths.map(rel);
    if (!git(["reset", "-q", "--", ...rels], { allowFail: true }).ok) {
      for (const r of rels) git(["reset", "-q", "--", r], { allowFail: true });
    }
    throw e;
  }
}

function gitCommitIfChanged(paths, message, opts = {}) {
  // A path that neither exists on disk nor is tracked yet (e.g. a feedback
  // log nothing has written to this run) is not "nothing changed" to `git
  // add` — it is a pathspec error. Drop those before asking git about them.
  const rels = paths.map(rel).filter((r) => exists(path.join(ROOT, r)) || git(["ls-files", "--error-unmatch", "--", r], { allowFail: true }).ok);
  if (!rels.length) return null;
  git(["add", "-A", "--", ...rels]);
  const staged = git(["diff", "--cached", "--name-only", "--", ...rels]).out;
  if (!staged) return null;
  commitStaged(rels, message, opts);
  return git(["rev-parse", "--short", "HEAD"]).out;
}

/**
 * Every currently untracked path, one per file (never a rolled-up
 * directory), exactly as `git status --porcelain` prints it — the same
 * shape `porcelainExcluding` matches against.
 */
function untrackedPaths(cwd = ROOT) {
  return git(["status", "--porcelain", "--untracked-files=all"], { cwd })
    .out.split("\n")
    .filter((l) => l.startsWith("?? "))
    .map((l) => l.slice(3))
    .sort();
}

/** Escape a literal path for use as a `git clean -e` exclude pattern, which
 * is matched like a .gitignore line (fnmatch-style), not a plain string. */
function gitCleanExcludePattern(literalPath) {
  return literalPath.replace(/[*?[\]!\\]/g, "\\$&");
}

/**
 * `git status --porcelain --untracked-files=all` lines, with any untracked
 * path in `ignore` removed. A file the run found already sitting untracked
 * before it started is invisible to every check that follows: the run had
 * no hand in it and no reason to touch it (F-09).
 */
function porcelainExcludingPreexisting(ignore, cwd = ROOT) {
  const set = new Set(ignore || []);
  return git(["status", "--porcelain", "--untracked-files=all"], { cwd })
    .out.split("\n")
    .filter(Boolean)
    .filter((l) => !(l.startsWith("?? ") && set.has(l.slice(3))))
    .filter((l) => !isCleanroomLogLine(l));
}

/**
 * The clean-room log is appended to by hooks after every tool call, including the
 * call that is checking the tree, so a dirty log is normal and never a finding.
 * Only a checkpoint commits it.
 */
const cleanroomLogRel = () => rel(path.join(P.stateDir, "cleanroom", "log.jsonl"));
// git() trims its output, which can eat the first line's leading space, so the path is matched from the end.
const isCleanroomLogLine = (l) => l.endsWith(` ${cleanroomLogRel()}`);

/** Uncommitted changes to tracked files, as porcelain lines, apart from the clean-room log. */
const trackedDirtyLines = (cwd = ROOT) => git(["status", "--porcelain", "--untracked-files=no"], { cwd }).out.split("\n").filter(Boolean).filter((l) => !isCleanroomLogLine(l));

function loadConfig() {
  if (!exists(P.config)) return null;
  try {
    return JSON.parse(read(P.config));
  } catch (e) {
    throw new ToolError(`docs/kukulu.json is not valid JSON: ${e.message}`);
  }
}

const SIGNING_POLICIES = ["auto", "off", "required"];
const PR_POLICIES = ["draft", "none"];
const POLICY_KEYS = ["signing", "push", "pr", "feedback", "archive", "finalize", "mergeMethod", "syncBase"];
const FINALIZE_POLICIES = ["auto", "ready", "draft"];
const MERGE_METHODS = ["merge", "squash", "rebase"];
const FLIGHT_SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Validate `docs/kukulu.json`'s `policies` block; throws, never defaults a bad value away. */
function validatePolicies(policies) {
  if (policies === undefined) return;
  if (typeof policies !== "object" || policies === null || Array.isArray(policies)) {
    throw new ToolError("docs/kukulu.json 'policies' must be an object");
  }
  for (const key of Object.keys(policies)) {
    if (!POLICY_KEYS.includes(key)) throw new ToolError(`docs/kukulu.json policies has an unknown key '${key}'`);
  }
  if (policies.signing !== undefined && !SIGNING_POLICIES.includes(policies.signing)) {
    throw new ToolError(`docs/kukulu.json policies.signing must be one of ${SIGNING_POLICIES.join(", ")}`);
  }
  if (policies.push !== undefined && typeof policies.push !== "boolean") {
    throw new ToolError("docs/kukulu.json policies.push must be a boolean");
  }
  if (policies.pr !== undefined && !PR_POLICIES.includes(policies.pr)) {
    throw new ToolError(`docs/kukulu.json policies.pr must be one of ${PR_POLICIES.join(", ")}`);
  }
  if (policies.feedback !== undefined && typeof policies.feedback !== "boolean") {
    throw new ToolError("docs/kukulu.json policies.feedback must be a boolean");
  }
  if (policies.archive !== undefined && typeof policies.archive !== "boolean") {
    throw new ToolError("docs/kukulu.json policies.archive must be a boolean");
  }
  if (policies.finalize !== undefined && !FINALIZE_POLICIES.includes(policies.finalize)) {
    throw new ToolError(`docs/kukulu.json policies.finalize must be one of ${FINALIZE_POLICIES.join(", ")}`);
  }
  if (policies.mergeMethod !== undefined && !MERGE_METHODS.includes(policies.mergeMethod)) {
    throw new ToolError(`docs/kukulu.json policies.mergeMethod must be one of ${MERGE_METHODS.join(", ")}`);
  }
  if (policies.syncBase !== undefined && typeof policies.syncBase !== "boolean") {
    throw new ToolError("docs/kukulu.json policies.syncBase must be a boolean");
  }
}

/**
 * Normalise a verify/extraVerify/build/setup entry to
 * `{ cmd, timeoutMs, exclusive }`. A bare string takes `defaultTimeoutMs` and
 * is not exclusive; `{ cmd, timeoutMs, exclusive }` may override either.
 * Throws on anything else, a missing `cmd`, a non-positive integer
 * `timeoutMs`, or a non-boolean `exclusive` — a plan can give one slow
 * end-to-end command a longer timeout without lifting the timeout for
 * everything else, and mark a port- or directory-bound command `exclusive`
 * so it only ever runs from the main checkout, never a stream's worktree.
 */
function normalizeCommand(entry, defaultTimeoutMs, where, { allowFrom = false, planIds = null } = {}) {
  if (typeof entry === "string") return { cmd: entry, timeoutMs: defaultTimeoutMs, exclusive: false, from: null };
  if (entry && typeof entry === "object" && !Array.isArray(entry)) {
    if (typeof entry.cmd !== "string" || !entry.cmd) throw new ToolError(`${where} is missing 'cmd'`);
    const timeoutMs = entry.timeoutMs === undefined ? defaultTimeoutMs : entry.timeoutMs;
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new ToolError(`${where}.timeoutMs must be a positive integer`);
    if (entry.exclusive !== undefined && typeof entry.exclusive !== "boolean") throw new ToolError(`${where}.exclusive must be a boolean`);
    if (entry.from !== undefined && !allowFrom) throw new ToolError(`${where}.from is only valid on verify and extraVerify entries`);
    return { cmd: entry.cmd, timeoutMs, exclusive: entry.exclusive === true, from: entry.from === undefined ? null : validateFrom(entry.from, where, planIds) };
  }
  throw new ToolError(`${where} must be a command string or { cmd, timeoutMs }`);
}

/** A `from` value names the task that makes a rule true; it must be a task id that PLAN.md (when it exists) defines. */
function validateFrom(from, where, planIds) {
  if (typeof from !== "string" || !/^[PR]\d+-\d+$/.test(from)) throw new ToolError(`${where}.from must be a task id such as P1-03`);
  if (planIds && !planIds.has(from)) throw new ToolError(`${where}.from names ${from}, which is not a task in docs/PLAN.md`);
  return from;
}

/** The task ids that have a `### <id>:` heading in PLAN.md text. */
const planIdsOf = (planText) => new Set(Array.from(planText.matchAll(/^### ([PR]\d+-\d+):/gm), (m) => m[1]));

/**
 * `null` when a rule gated by `from` is active, else the task id it waits
 * for. Active when ungated, when there is no PROGRESS.md, when no task is
 * open (the flight is over, so everything applies), when the task is not in
 * PROGRESS.md, or when the task has started or finished. Inactive while the
 * task is todo, blocked or skipped.
 */
function inactiveUntil(from, pr) {
  if (!from || !pr) return null;
  if (counts(pr.tasks).open === 0) return null;
  const t = pr.tasks.find((x) => x.id === from);
  if (!t) return null;
  return t.state === "~" || t.state === "x" ? null : from;
}

const PARALLEL_KEYS = ["maxStreams", "setup"];

/** Validate `docs/kukulu.json`'s `parallel` block; throws, never defaults a bad value away. */
function validateParallel(parallel) {
  if (parallel === undefined) return;
  if (typeof parallel !== "object" || parallel === null || Array.isArray(parallel)) {
    throw new ToolError("docs/kukulu.json 'parallel' must be an object");
  }
  for (const key of Object.keys(parallel)) {
    if (!PARALLEL_KEYS.includes(key)) throw new ToolError(`docs/kukulu.json parallel has an unknown key '${key}'`);
  }
  if (parallel.maxStreams !== undefined && (!Number.isInteger(parallel.maxStreams) || parallel.maxStreams <= 0)) {
    throw new ToolError("docs/kukulu.json parallel.maxStreams must be a positive integer");
  }
  if (parallel.setup !== undefined && !Array.isArray(parallel.setup)) {
    throw new ToolError("docs/kukulu.json parallel.setup must be an array of commands");
  }
}

const MUTATION_FILTER = /^[A-Za-z0-9_.:\\/-]{1,200}$/;

/** Validate `docs/kukulu.json`'s `mutation` block: named test commands with one `{filter}` slot, for kukulu_mutate's `targeted` argument. */
function validateMutation(mutation) {
  if (mutation === undefined) return;
  const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
  if (!isObj(mutation)) throw new ToolError("docs/kukulu.json 'mutation' must be an object");
  for (const k of Object.keys(mutation)) {
    if (k !== "targeted") throw new ToolError(`docs/kukulu.json mutation has an unknown key '${k}'`);
  }
  if (mutation.targeted === undefined) return;
  if (!isObj(mutation.targeted)) throw new ToolError("docs/kukulu.json mutation.targeted must be an object mapping a name to { cmd, timeoutMs }");
  for (const [name, entry] of Object.entries(mutation.targeted)) {
    const where = `docs/kukulu.json mutation.targeted.${name}`;
    if (!isObj(entry)) throw new ToolError(`${where} must be an object { cmd, timeoutMs }`);
    for (const k of Object.keys(entry)) {
      if (!["cmd", "timeoutMs"].includes(k)) throw new ToolError(`${where} has an unknown key '${k}'`);
    }
    if (typeof entry.cmd !== "string" || !entry.cmd) throw new ToolError(`${where}.cmd must be a non-empty string`);
    if (entry.cmd.split("{filter}").length - 1 !== 1) throw new ToolError(`${where}.cmd must contain {filter} exactly once`);
    if (entry.timeoutMs !== undefined && (!Number.isInteger(entry.timeoutMs) || entry.timeoutMs <= 0)) {
      throw new ToolError(`${where}.timeoutMs must be a positive integer`);
    }
  }
}

const CLEANROOM_KEYS = ["policy", "signingKey", "similarity", "idleGapHours"];
const SIMILARITY_KEYS = ["subject", "pairs", "languages", "ngram", "minIdentLen", "commentNgram", "identExclusions", "near", "separationMargin"];
const SIMILARITY_LANGUAGES = ["rust", "c", "cpp", "go", "python", "javascript", "typescript", "java", "php"];
const PAIR_ROLES = ["negative", "positive", "test"];
const PAIR_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
// The extensions a similarity run reads when `languages` is not configured.
const DEFAULT_SIMILARITY_LANGUAGES = {
  ".rs": "rust", ".c": "c", ".h": "c", ".cc": "cpp", ".cpp": "cpp", ".cxx": "cpp", ".hpp": "cpp", ".go": "go", ".py": "python",
  ".js": "javascript", ".mjs": "javascript", ".cjs": "javascript", ".ts": "typescript", ".java": "java", ".php": "php",
};

/** Validate `cleanroom.similarity`: the controls and test pairs a contamination score is measured against. */
function validateSimilarity(sim) {
  if (sim === undefined) return;
  const where = "docs/kukulu.json cleanroom.similarity";
  const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
  const nonEmptyString = (v) => typeof v === "string" && v.length > 0;
  if (!isObj(sim)) throw new ToolError(`${where} must be an object`);
  for (const k of Object.keys(sim)) {
    if (!SIMILARITY_KEYS.includes(k)) throw new ToolError(`${where} has an unknown key '${k}'; the legal keys are ${SIMILARITY_KEYS.join(", ")}`);
  }
  if (sim.subject !== undefined && (!Array.isArray(sim.subject) || !sim.subject.length || !sim.subject.every(nonEmptyString))) {
    throw new ToolError(`${where}.subject must be a non-empty array of non-empty strings (the directories being measured)`);
  }
  if (!Array.isArray(sim.pairs) || !sim.pairs.length) throw new ToolError(`${where}.pairs must be a non-empty array of { id, role, left, right }`);
  const seen = new Set();
  const roles = { negative: 0, positive: 0, test: 0 };
  sim.pairs.forEach((p, i) => {
    const at = `${where}.pairs[${i}]`;
    if (!isObj(p)) throw new ToolError(`${at} must be an object { id, role, left, right }`);
    for (const k of Object.keys(p)) if (!["id", "role", "left", "right"].includes(k)) throw new ToolError(`${at} has an unknown key '${k}'`);
    if (typeof p.id !== "string" || !PAIR_ID.test(p.id)) throw new ToolError(`${at}.id must be a slug (lowercase letters, digits and -, at most 40 characters)`);
    if (seen.has(p.id)) throw new ToolError(`${where}.pairs defines the id '${p.id}' more than once`);
    seen.add(p.id);
    if (!PAIR_ROLES.includes(p.role)) throw new ToolError(`${at}.role must be one of ${PAIR_ROLES.join(", ")} (got ${JSON.stringify(p.role)})`);
    roles[p.role]++;
    for (const side of ["left", "right"]) {
      if (!nonEmptyString(p[side])) throw new ToolError(`${at}.${side} must be a non-empty string: a directory (absolute, ~, repo-relative) or "subject"`);
      if (p[side] === "subject" && sim.subject === undefined) throw new ToolError(`${at}.${side} is "subject", but ${where}.subject is not set`);
    }
  });
  if (roles.negative !== 1) throw new ToolError(`${where}.pairs needs exactly one pair with role "negative" (found ${roles.negative})`);
  if (roles.positive !== 1) throw new ToolError(`${where}.pairs needs exactly one pair with role "positive" (found ${roles.positive})`);
  if (roles.test < 1) throw new ToolError(`${where}.pairs needs at least one pair with role "test"`);
  if (sim.languages !== undefined) {
    if (!isObj(sim.languages) || !Object.keys(sim.languages).length) throw new ToolError(`${where}.languages must be an object mapping an extension such as ".rs" to a language`);
    for (const [ext, lang] of Object.entries(sim.languages)) {
      if (!/^\.[^./\\]+$/.test(ext)) throw new ToolError(`${where}.languages key ${JSON.stringify(ext)} must be an extension starting with "."`);
      if (!SIMILARITY_LANGUAGES.includes(lang)) throw new ToolError(`${where}.languages[${JSON.stringify(ext)}] is ${JSON.stringify(lang)}; the shipped lexers are ${SIMILARITY_LANGUAGES.join(", ")}`);
    }
  }
  if (sim.ngram !== undefined && (!Array.isArray(sim.ngram) || !sim.ngram.length || !sim.ngram.every((n) => Number.isInteger(n) && n > 0))) {
    throw new ToolError(`${where}.ngram must be a non-empty array of positive integers`);
  }
  for (const k of ["minIdentLen", "commentNgram"]) {
    if (sim[k] !== undefined && (!Number.isInteger(sim[k]) || sim[k] < 1)) throw new ToolError(`${where}.${k} must be a positive integer`);
  }
  if (sim.identExclusions !== undefined && !nonEmptyString(sim.identExclusions)) throw new ToolError(`${where}.identExclusions must be a non-empty string: the path of a file with one identifier per line`);
  if (sim.near !== undefined && !(typeof sim.near === "number" && sim.near > 0 && sim.near < 0.5)) throw new ToolError(`${where}.near must be a number greater than 0 and less than 0.5`);
  if (sim.separationMargin !== undefined && !(typeof sim.separationMargin === "number" && Number.isFinite(sim.separationMargin) && sim.separationMargin >= 0)) {
    throw new ToolError(`${where}.separationMargin must be a number of at least 0`);
  }
}

/** The similarity block with its defaults filled in, or null when none is configured. */
function normalizeSimilarity(sim) {
  if (sim === undefined) return null;
  return {
    subject: sim.subject ?? [],
    pairs: sim.pairs.map((p) => ({ id: p.id, role: p.role, left: p.left, right: p.right })),
    languages: sim.languages ?? DEFAULT_SIMILARITY_LANGUAGES,
    // ⚠️ ASSUMPTION: the n-gram sizes, identifier and comment bounds come from cleanflate-bench; the margin is strict "pos > neg" until measured.
    ngram: sim.ngram ?? [5, 10],
    minIdentLen: sim.minIdentLen ?? 6,
    commentNgram: sim.commentNgram ?? 5,
    identExclusions: sim.identExclusions ?? null,
    near: sim.near ?? 0.25,
    separationMargin: sim.separationMargin ?? 0.0,
  };
}
const DEFAULT_CLEANROOM_POLICY = "docs/cleanroom.json";
const DEFAULT_SIGNING_KEY = "~/.config/kukulu/cleanroom/ed25519.pem";

/** Validate `docs/kukulu.json`'s `cleanroom` object: where the policy lives and where the checkpoint-signing key is kept. */
function validateCleanroom(cleanroom) {
  if (cleanroom === undefined) return;
  if (typeof cleanroom !== "object" || cleanroom === null || Array.isArray(cleanroom)) throw new ToolError("docs/kukulu.json 'cleanroom' must be an object");
  for (const k of Object.keys(cleanroom)) {
    if (!CLEANROOM_KEYS.includes(k)) throw new ToolError(`docs/kukulu.json cleanroom has an unknown key '${k}'; the legal keys are ${CLEANROOM_KEYS.join(", ")}`);
  }
  const p = cleanroom.policy;
  if (p !== undefined) {
    if (typeof p !== "string" || !p) throw new ToolError("docs/kukulu.json cleanroom.policy must be a non-empty string: a repo-relative path");
    if (path.isAbsolute(p) || p.startsWith("~") || p.split(/[\\/]/).includes("..")) {
      throw new ToolError(`docs/kukulu.json cleanroom.policy must be repo-relative, with no '~' and no '..' (got ${JSON.stringify(p)}); use a path such as ${DEFAULT_CLEANROOM_POLICY}`);
    }
  }
  if (cleanroom.signingKey !== undefined && (typeof cleanroom.signingKey !== "string" || !cleanroom.signingKey)) {
    throw new ToolError("docs/kukulu.json cleanroom.signingKey must be a non-empty string: the path of an Ed25519 private key in PEM form");
  }
  const idle = cleanroom.idleGapHours;
  if (idle !== undefined && (typeof idle !== "number" || !Number.isFinite(idle) || idle <= 0)) {
    throw new ToolError(`docs/kukulu.json cleanroom.idleGapHours must be a positive number of hours (got ${JSON.stringify(idle)}); use a value such as 3`);
  }
  validateSimilarity(cleanroom.similarity);
}

/** A leading `~` is the home directory; the result is always absolute. */
const expandHome = (p) => path.resolve(p === "~" || p.startsWith("~/") ? path.join(os.homedir(), p.slice(1)) : p);

const REVIEW_KEYS = ["mutationFixRounds"];
const FIX_SOURCES = ["review", "mutation", "blocked"];

/** Validate `docs/kukulu.json`'s `review` block: how many fix rounds a surviving mutant alone may open. */
function validateReview(review) {
  if (review === undefined) return;
  if (typeof review !== "object" || review === null || Array.isArray(review)) throw new ToolError("docs/kukulu.json 'review' must be an object");
  for (const k of Object.keys(review)) {
    if (!REVIEW_KEYS.includes(k)) throw new ToolError(`docs/kukulu.json review has an unknown key '${k}'`);
  }
  if (review.mutationFixRounds !== undefined && (!Number.isInteger(review.mutationFixRounds) || review.mutationFixRounds < 1)) {
    throw new ToolError("docs/kukulu.json review.mutationFixRounds must be a positive integer");
  }
}

const CONSTRAINT_KEYS = ["id", "description", "paths", "exclude", "pattern", "flags", "shouldMatch", "shouldNotMatch", "from"];

/**
 * Validate `docs/kukulu.json`'s `constraints` array: every rule must carry
 * proof that its own check works, so a grep with a blind spot fails its own
 * fixture instead of passing silently (F-14). Never checks the pattern
 * against real files — that is `checkConstraints`'s job at `kukulu_verify`
 * time — only that the rule is well-formed.
 */
function validateConstraints(constraints, planIds = null) {
  if (constraints === undefined) return;
  if (!Array.isArray(constraints)) throw new ToolError("docs/kukulu.json 'constraints' must be an array");
  const seen = new Set();
  for (const c of constraints) {
    const label = c && typeof c === "object" && typeof c.id === "string" ? c.id : "?";
    if (!c || typeof c !== "object" || Array.isArray(c)) throw new ToolError(`constraint '${label}' must be an object`);
    for (const k of Object.keys(c)) if (!CONSTRAINT_KEYS.includes(k)) throw new ToolError(`constraint '${label}' has an unknown key '${k}'`);
    if (typeof c.id !== "string" || !c.id) throw new ToolError("a constraint is missing 'id'");
    if (seen.has(c.id)) throw new ToolError(`constraint '${c.id}' is defined more than once`);
    seen.add(c.id);
    if (!Array.isArray(c.paths) || !c.paths.length || !c.paths.every((p) => typeof p === "string" && p)) {
      throw new ToolError(`constraint '${c.id}' must have a non-empty 'paths' array of strings`);
    }
    if (c.exclude !== undefined && (!Array.isArray(c.exclude) || !c.exclude.every((p) => typeof p === "string" && p))) {
      throw new ToolError(`constraint '${c.id}'.exclude must be an array of strings`);
    }
    if (c.from !== undefined) validateFrom(c.from, `constraint '${c.id}'`, planIds);
    if (typeof c.pattern !== "string" || !c.pattern) throw new ToolError(`constraint '${c.id}' must have a non-empty 'pattern'`);
    if (c.flags !== undefined && typeof c.flags !== "string") throw new ToolError(`constraint '${c.id}'.flags must be a string`);
    try {
      // eslint-disable-next-line no-new -- validity check only, the instance is discarded
      new RegExp(c.pattern, c.flags || "");
    } catch (e) {
      throw new ToolError(`constraint '${c.id}' has an invalid pattern: ${e.message}`);
    }
    if (!Array.isArray(c.shouldMatch) || !c.shouldMatch.length || !c.shouldMatch.every((l) => typeof l === "string")) {
      throw new ToolError(`constraint '${c.id}' must have at least one 'shouldMatch' fixture line`);
    }
    if (!Array.isArray(c.shouldNotMatch) || !c.shouldNotMatch.length || !c.shouldNotMatch.every((l) => typeof l === "string")) {
      throw new ToolError(`constraint '${c.id}' must have at least one 'shouldNotMatch' fixture line`);
    }
  }
}

function cfg() {
  return cfgFrom(loadConfig() || {}, exists(P.plan) ? planIdsOf(read(P.plan)) : null);
}

/** The resolved config for parsed `docs/kukulu.json` content; `planIds` (or null to skip the check) are the tasks a `from` may name. */
function cfgFrom(c, planIds) {
  validatePolicies(c.policies);
  if (c.flight !== undefined && (typeof c.flight !== "string" || !FLIGHT_SLUG.test(c.flight))) {
    throw new ToolError(`docs/kukulu.json flight must be a slug matching ${FLIGHT_SLUG} (lowercase letters, digits and -, at most 40 characters)`);
  }
  validateConstraints(c.constraints, planIds);
  validateParallel(c.parallel);
  validateMutation(c.mutation);
  validateReview(c.review);
  validateCleanroom(c.cleanroom);
  const commandTimeoutMs = c.commandTimeoutMs || 10 * 60 * 1000;
  const targeted = Object.fromEntries(
    Object.entries(c.mutation?.targeted || {}).map(([name, e]) => [name, { cmd: e.cmd, timeoutMs: e.timeoutMs ?? commandTimeoutMs }]),
  );
  const norm = (entry, i, where, opts) => normalizeCommand(entry, commandTimeoutMs, `docs/kukulu.json ${where}[${i}]`, opts);
  const gated = { allowFrom: true, planIds };
  return {
    verify: (c.verify || []).map((e, i) => norm(e, i, "verify", gated)),
    extraVerify: Object.fromEntries(
      Object.entries(c.extraVerify || {}).map(([prefix, arr]) => [prefix, (arr || []).map((e, i) => norm(e, i, `extraVerify['${prefix}']`, gated))]),
    ),
    build: (c.build || []).map((e, i) => norm(e, i, "build")),
    parallel: {
      maxStreams: c.parallel?.maxStreams ?? 3,
      setup: (c.parallel?.setup || []).map((e, i) => norm(e, i, "parallel.setup")),
    },
    baseBranch: c.baseBranch || "main",
    branchPrefix: c.branchPrefix || "build/",
    maxRounds: Number.isInteger(c.maxRounds) ? c.maxRounds : 3,
    maxRoundsHard: Number.isInteger(c.maxRoundsHard) ? c.maxRoundsHard : 6,
    commandTimeoutMs,
    guardCap: Number.isInteger(c.guardCap) ? c.guardCap : 60,
    constraints: c.constraints || [],
    flight: c.flight ?? null,
    mutation: { targeted },
    // ⚠️ ASSUMPTION: the number of fix rounds that a surviving mutant alone may open, before it is only a note.
    review: { mutationFixRounds: c.review?.mutationFixRounds ?? 2 },
    // Clean-room mode is on when the file at `policy` exists; there is no flag. KUKULU_CLEANROOM_KEY wins over the configured key path.
    cleanroom: {
      policy: c.cleanroom?.policy ?? DEFAULT_CLEANROOM_POLICY,
      signingKey: expandHome(envVar("CLEANROOM_KEY") || c.cleanroom?.signingKey || DEFAULT_SIGNING_KEY),
      similarity: normalizeSimilarity(c.cleanroom?.similarity),
      // ⚠️ ASSUMPTION: hours between two entries of one stage before the span is listed as a coverage gap.
      idleGapHours: c.cleanroom?.idleGapHours ?? 3,
    },
    policies: {
      signing: c.policies?.signing ?? "auto",
      push: c.policies?.push ?? true,
      pr: c.policies?.pr ?? "draft",
      feedback: c.policies?.feedback ?? true,
      // ⚠️ ASSUMPTION: archiving a finished flight is opt-in until it has been proven in real flights.
      archive: c.policies?.archive ?? false,
      finalize: c.policies?.finalize ?? "auto",
      mergeMethod: c.policies?.mergeMethod ?? "merge",
      syncBase: c.policies?.syncBase ?? true,
    },
  };
}

// ---------------------------------------------------------------- routing config
//
// Per-role model routing (v0.2.0): which model and effort each of the four
// stage roles runs with, merged from the plugin's own defaults (agents/*.md),
// an optional global file, an optional named profile inside it, and an
// optional project override in docs/kukulu.json. kukulu_agents_sync turns
// the merged result into .claude/agents/kukulu-<role>.md files that Claude
// Code will actually spawn; kukulu_next and kukulu_status read the merge
// without writing anything.

const ROLES = ["planner", "implementer", "reviewer", "summarizer"];
const ROLE_KEYS = ["model", "effort"];
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const ANTHROPIC_ALIASES = ["fable", "opus", "sonnet", "haiku", "inherit"];
const PERMISSION_MODES = ["default", "acceptEdits", "auto", "dontAsk", "bypassPermissions", "plan", "manual"];
const GLOBAL_KEYS = ["roles", "profiles", "profile", "permissionMode"];

const isAnthropicModel = (m) => ANTHROPIC_ALIASES.includes(m) || m.startsWith("claude-");

// The `Agent` tool's own `model` parameter takes only a family alias, never
// a full `claude-*` id — unlike the `model:` line of an agent file, which
// takes either. So the fallback spawn (the plugin's own agent, with the
// routed model handed over as a parameter) needs the alias form (F-02 of the
// 2026-09-23 flight feedback).
const AGENT_TOOL_ALIASES = ["fable", "opus", "sonnet", "haiku"];
const CLAUDE_FAMILY = /^claude-(opus|sonnet|haiku|fable)-/;

/**
 * The value to pass as the `Agent` tool's `model` for a routed model:
 * `{ value, exact }`, where `value` is `null` for "pass no model" and `exact`
 * is false when a full id was mapped down to its family alias (the alias
 * means "latest of that family", which may not be the pinned version).
 * `null` when the Agent tool cannot name the model at all — a non-Anthropic
 * model, or a `claude-*` id of a family this map does not know.
 */
function agentToolModel(model) {
  if (model === "inherit") return { value: null, exact: true };
  if (AGENT_TOOL_ALIASES.includes(model)) return { value: model, exact: true };
  const family = typeof model === "string" ? model.match(CLAUDE_FAMILY) : null;
  return family ? { value: family[1], exact: false } : null;
}

/** Minimal YAML frontmatter reader: scalars and `- ` lists, which is all an agent file uses. */
function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new ToolError("agent file has no frontmatter");
  const fm = {};
  let key = null;
  for (const line of m[1].split("\n")) {
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && key) {
      (fm[key] = Array.isArray(fm[key]) ? fm[key] : []).push(item[1].trim());
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    key = kv[1];
    const value = kv[2].trim().replace(/^["'](.*)["']$/, "$1");
    fm[key] = value === "" ? [] : value === "true" ? true : value === "false" ? false : value;
  }
  return { frontmatter: fm, body: m[2] };
}

/** The plugin's own default agent file for a role: frontmatter plus body, verbatim. */
function pluginAgent(role) {
  const file = path.join(PLUGIN_ROOT, "agents", `${role}.md`);
  return { file, ...parseFrontmatter(read(file)) };
}

function globalConfigPath() {
  const fromEnv = envVar("CONFIG");
  if (fromEnv) return path.resolve(fromEnv);
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(base, "kukulu", "config.json");
}

function loadGlobalConfig() {
  const p = globalConfigPath();
  if (!exists(p)) return { path: p, present: false, data: {} };
  let data;
  try {
    data = JSON.parse(read(p));
  } catch (e) {
    throw new ToolError(`global config ${p} is not valid JSON: ${e.message}`);
  }
  for (const k of Object.keys(data)) {
    if (!GLOBAL_KEYS.includes(k)) throw new ToolError(`global config ${p} has an unknown key '${k}'`);
  }
  return { path: p, present: true, data };
}

/** `where` names the block itself, e.g. "global config <path> roles" or "docs/kukulu.json roles". */
function validateRolesBlock(roles, where) {
  if (roles === undefined) return;
  if (typeof roles !== "object" || roles === null || Array.isArray(roles)) {
    throw new ToolError(`${where} must be an object`);
  }
  for (const [role, block] of Object.entries(roles)) {
    if (!ROLES.includes(role)) throw new ToolError(`${where} names an unknown role '${role}'`);
    if (typeof block !== "object" || block === null || Array.isArray(block)) {
      throw new ToolError(`${where}.${role} must be an object`);
    }
    for (const [key, value] of Object.entries(block)) {
      if (!ROLE_KEYS.includes(key)) throw new ToolError(`${where}.${role} has an unknown key '${key}'`);
      if (key === "model" && (typeof value !== "string" || !value)) {
        throw new ToolError(`${where}.${role}.model must be a non-empty string`);
      }
      if (key === "effort" && !EFFORTS.includes(value)) {
        throw new ToolError(`${where}.${role}.effort must be one of ${EFFORTS.join(", ")}`);
      }
    }
  }
}

/** `where` names the key itself, e.g. "global config <path> permissionMode". */
function validatePermissionMode(mode, where) {
  if (mode === undefined) return;
  if (!PERMISSION_MODES.includes(mode)) {
    throw new ToolError(`${where} must be one of ${PERMISSION_MODES.join(", ")}`);
  }
}

/**
 * Merge the plugin defaults, the global file, the selected profile and the
 * project override, per role, per key, tracking where each surviving value
 * came from. Never writes anything; throws on any malformed input.
 */
function resolveRouting() {
  const global = loadGlobalConfig();
  validateRolesBlock(global.data.roles, `global config ${global.path} roles`);
  validatePermissionMode(global.data.permissionMode, `global config ${global.path} permissionMode`);
  if (global.data.profiles !== undefined) {
    if (typeof global.data.profiles !== "object" || global.data.profiles === null || Array.isArray(global.data.profiles)) {
      throw new ToolError(`global config ${global.path} 'profiles' must be an object`);
    }
    for (const [name, block] of Object.entries(global.data.profiles)) {
      validateRolesBlock(block, `global config ${global.path} profiles.${name}`);
    }
  }
  if (global.data.profile !== undefined && (typeof global.data.profile !== "string" || !global.data.profile)) {
    throw new ToolError(`global config ${global.path} 'profile' must be a non-empty string`);
  }

  let profile = null;
  let profileSource = null;
  if (envVar("PROFILE")) {
    profile = envVar("PROFILE");
    profileSource = "env";
  } else if (global.data.profile) {
    profile = global.data.profile;
    profileSource = "global";
  }
  if (profile !== null && !(profile in (global.data.profiles || {}))) {
    const src = profileSource === "env" ? `KUKULU_PROFILE=${profile}` : `"profile": "${profile}" in ${global.path}`;
    const globalDesc = global.present ? global.path : `${global.path} (does not exist)`;
    throw new ToolError(`${src} selects a profile, but ${globalDesc} has no profiles.${profile} entry`);
  }

  const project = loadConfig() || {};
  validateRolesBlock(project.roles, "docs/kukulu.json roles");
  validatePermissionMode(project.permissionMode, "docs/kukulu.json permissionMode");

  const roles = {};
  const effortDropped = {};
  for (const role of ROLES) {
    const agent = pluginAgent(role);
    const layers = [{ model: agent.frontmatter.model, effort: agent.frontmatter.effort, source: "default" }];
    if (global.data.roles?.[role]) layers.push({ ...global.data.roles[role], source: "global" });
    if (profile !== null && global.data.profiles?.[profile]?.[role]) {
      layers.push({ ...global.data.profiles[profile][role], source: `profile:${profile}` });
    }
    if (project.roles?.[role]) layers.push({ ...project.roles[role], source: "project" });

    let model, effort;
    let modelSource = "default", effortSource = "default";
    for (const layer of layers) {
      if (layer.model !== undefined) { model = layer.model; modelSource = layer.source; }
      if (layer.effort !== undefined) { effort = layer.effort; effortSource = layer.source; }
    }
    if (effort !== undefined && !isAnthropicModel(model)) {
      effortDropped[role] = effort;
      effort = undefined;
    }
    roles[role] = { model, effort, source: { model: modelSource, effort: effortSource } };
  }

  let permissionMode = "acceptEdits";
  let permissionModeSource = "default";
  if (global.data.permissionMode !== undefined) { permissionMode = global.data.permissionMode; permissionModeSource = "global"; }
  if (project.permissionMode !== undefined) { permissionMode = project.permissionMode; permissionModeSource = "project"; }

  return {
    globalPath: global.path,
    globalPresent: global.present,
    profile,
    profileSource,
    roles,
    permissionMode,
    permissionModeSource,
    effortDropped,
    projectOverride: project.roles !== undefined || project.permissionMode !== undefined,
  };
}

/** Quote a YAML scalar only when a plain scalar would parse differently. */
function yamlScalar(s) {
  if (/: | #/.test(s) || /^["'#[{*&!|>%@`]/.test(s)) return JSON.stringify(s);
  return s;
}

/** The exact text kukulu_agents_sync would write for one role's generated agent. */
function renderAgentFile(role, resolved, permissionMode) {
  const agent = pluginAgent(role);
  const fm = agent.frontmatter;
  const lines = ["---", `name: kukulu-${role}`, `description: ${yamlScalar(fm.description)}`, `model: ${resolved.model}`];
  if (resolved.effort !== undefined) lines.push(`effort: ${resolved.effort}`);
  lines.push(`permissionMode: ${permissionMode}`);
  if (fm.tools) lines.push(`tools: ${fm.tools}`);
  lines.push("skills:");
  for (const s of fm.skills || []) lines.push(`  - ${s}`);
  lines.push(`color: ${fm.color}`, "---");
  const body = agent.body.replace(/^\n+/, "").replace(/\s+$/, "") + "\n";
  return `${lines.join("\n")}\n<!-- generated by kukulu_agents_sync; edit config, not this file -->\n\n${body}`;
}

/** A ready-to-print Markdown table of the resolved per-role routing. */
function routingTable(r) {
  const rows = ROLES.map((role) => {
    const e = r.roles[role];
    const effort = e.effort !== undefined ? e.effort : "–";
    const source = e.source.model === e.source.effort ? e.source.model : `model:${e.source.model} effort:${e.source.effort}`;
    return `| ${role} | kukulu-${role} | ${e.model} | ${effort} | ${source} |`;
  });
  return ["| role | agent | model | effort | source |", "|---|---|---|---|---|", ...rows].join("\n");
}

/** Roles whose generated agent file currently exists on disk. */
function agentsOnDisk() {
  return ROLES.filter((role) => exists(path.join(P.agentsDir, `kukulu-${role}.md`)));
}

// Claude Code hot-reloads a project agent file within seconds of a change,
// with one documented exception: the first agent file created in a new
// .claude/agents directory is not picked up until the session restarts. So a
// session can trust a *change* to an already-populated agents directory to
// take effect live, but not the directory's first population. Both flags are
// process-lifetime state: they answer "since this session's MCP server
// started", which is the right proxy for "since this session started".
let agentsDirCreatedThisProcess = false;
const generatedThisProcess = new Set();

/** Parse a settings file leniently: `{ ok: true, data }`, or `{ ok: false, error }` for invalid JSON. Absence is `{ ok: true, data: {} }`. */
function readJsonLenient(p) {
  if (!exists(p)) return { ok: true, data: {} };
  try {
    return { ok: true, data: JSON.parse(read(p)) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

const allowListHasRule = (data) => Array.isArray(data?.permissions?.allow) && data.permissions.allow.includes(MCP_ALLOW_RULE);

/** Whether the MCP allow rule already appears in either settings file. Never throws, never writes. */
function mcpAllowRulePresent() {
  const committed = readJsonLenient(P.settings);
  if (committed.ok && allowListHasRule(committed.data)) return true;
  const local = readJsonLenient(P.settingsLocal);
  return local.ok && allowListHasRule(local.data);
}

/**
 * Add the MCP allow rule to `.claude/settings.local.json` if it is not
 * already covered by that file or the committed `.claude/settings.json`
 * (F-03). Read-merge-write: every other key and allow entry survives.
 * Returns `"added"`, `"present"`, or `"failed: <why>"` — a `settings.local.json`
 * that fails to parse is never overwritten.
 */
function ensureMcpAllowRule() {
  const committed = readJsonLenient(P.settings);
  if (committed.ok && allowListHasRule(committed.data)) return "present";

  const local = readJsonLenient(P.settingsLocal);
  if (!local.ok) return `failed: ${rel(P.settingsLocal)} is not valid JSON: ${local.error}`;
  if (allowListHasRule(local.data)) return "present";

  const data = { ...local.data };
  const existingAllow = Array.isArray(data.permissions?.allow) ? data.permissions.allow : [];
  data.permissions = { ...(data.permissions || {}), allow: [...existingAllow, MCP_ALLOW_RULE] };
  write(P.settingsLocal, `${JSON.stringify(data, null, 2)}\n`);
  return "added";
}

function configShow() {
  const r = resolveRouting();
  const generated = agentsOnDisk();
  const stale = generated.filter((role) => {
    const file = path.join(P.agentsDir, `kukulu-${role}.md`);
    return read(file) !== renderAgentFile(role, r.roles[role], r.permissionMode);
  });
  return {
    globalConfig: r.globalPresent ? r.globalPath : "none",
    globalConfigPath: r.globalPath,
    profile: r.profile,
    profileSource: r.profileSource,
    projectOverride: r.projectOverride,
    permissionMode: r.permissionMode,
    permissionModeSource: r.permissionModeSource,
    roles: Object.fromEntries(
      ROLES.map((role) => [role, { agent: `kukulu-${role}`, model: r.roles[role].model, effort: r.roles[role].effort, source: r.roles[role].source }]),
    ),
    effortDropped: r.effortDropped,
    agentsGenerated: generated,
    agentsStale: stale,
    permissionRule: mcpAllowRulePresent() ? "present" : "missing",
    table: routingTable(r),
  };
}

/** Resolve a `git rev-parse --git-path <name>` result to an absolute path. */
function gitPath(name) {
  const out = git(["rev-parse", "--git-path", name]).out;
  return path.isAbsolute(out) ? out : path.join(ROOT, out);
}

/**
 * Write .claude/agents/kukulu-<role>.md for every role from the resolved
 * routing config, writing only files whose rendered content actually
 * changed, and exclude the pattern from git per clone (via
 * .git/info/exclude, not .gitignore: these files encode a person's own
 * routing, not the project's, and excluding them this way needs no commit
 * on the base branch before a run can start).
 */
function agentsSync() {
  const r = resolveRouting();
  const dirExistedBefore = exists(P.agentsDir);
  fs.mkdirSync(P.agentsDir, { recursive: true });
  if (!dirExistedBefore) agentsDirCreatedThisProcess = true;

  const changed = [];
  const unchanged = [];
  for (const role of ROLES) {
    const file = path.join(P.agentsDir, `kukulu-${role}.md`);
    const text = renderAgentFile(role, r.roles[role], r.permissionMode);
    if (exists(file) && read(file) === text) {
      unchanged.push(role);
    } else {
      write(file, text);
      changed.push(role);
      generatedThisProcess.add(role);
    }
  }

  // The one case a headless launcher still needs to detect and relaunch for:
  // this process just created the agents directory itself (so Claude Code
  // cannot have hot-loaded it), and one of the roles that changed resolves to
  // a model the Agent tool cannot name directly, so there is no fallback.
  const restartRequired = agentsDirCreatedThisProcess && changed.some((role) => agentToolModel(r.roles[role].model) === null);

  const permissions = ensureMcpAllowRule();

  let excludeResult;
  if (gitFacts().inRepo) {
    // Claude Code gitignores .claude/settings.local.json only when it
    // creates the file itself; a copy this sync creates (or already found)
    // needs the same per-clone exclusion the agent files get, since it
    // encodes a person's own permission grant, not the project's.
    const addedAgents = ensureLineInFile(gitPath("info/exclude"), ".claude/agents/kukulu-*.md");
    const addedSettings = ensureLineInFile(gitPath("info/exclude"), ".claude/settings.local.json");
    excludeResult = addedAgents || addedSettings ? "added" : "present";
  } else {
    excludeResult = "skipped: not a git repository";
  }

  return {
    dir: rel(P.agentsDir),
    permissions,
    globalConfig: r.globalPresent ? r.globalPath : "none",
    globalConfigPath: r.globalPath,
    profile: r.profile,
    profileSource: r.profileSource,
    projectOverride: r.projectOverride,
    permissionMode: r.permissionMode,
    roles: Object.fromEntries(
      ROLES.map((role) => [role, { agent: `kukulu-${role}`, model: r.roles[role].model, effort: r.roles[role].effort, source: r.roles[role].source }]),
    ),
    effortDropped: r.effortDropped,
    changed,
    unchanged,
    restartRequired,
    exclude: excludeResult,
    table: routingTable(r),
  };
}

const DEFAULT_STATE = {
  round: 0,
  implemented: false,
  reviewed: false,
  verdict: null,
  summarized: false,
  halted: null,
  preexistingUntracked: [],
  policies: { signing: "auto", push: true, pr: "draft", feedback: true },
  signing: null,
  rounds: [],
};

function loadState() {
  if (!exists(P.state)) return { ...DEFAULT_STATE };
  try {
    return { ...DEFAULT_STATE, ...JSON.parse(read(P.state)) };
  } catch {
    return { ...DEFAULT_STATE };
  }
}
function saveState(s) {
  write(P.state, JSON.stringify(s, null, 2) + "\n");
}

// ---------------------------------------------------------------- PROGRESS.md

function parseProgress() {
  if (!exists(P.progress)) throw new ToolError("docs/PROGRESS.md does not exist; run the plan stage first");
  return parseProgressText(read(P.progress));
}

function parseProgressText(text) {
  const lines = text.split("\n");
  const tasks = [];
  let section = null;
  let tasksStart = -1, tasksEnd = -1, logStart = -1;
  let branch = null, started = null;
  lines.forEach((line, i) => {
    if (/^## Tasks\s*$/.test(line)) { section = "tasks"; tasksStart = i; return; }
    if (/^## Log\s*$/.test(line)) { section = "log"; logStart = i; if (tasksEnd < 0) tasksEnd = i; return; }
    if (/^## /.test(line)) { if (section === "tasks" && tasksEnd < 0) tasksEnd = i; section = null; return; }
    if (section === null) {
      const b = line.match(/^Branch:\s*(.*)$/); if (b) branch = b[1].trim();
      const s = line.match(/^Started:\s*(.*)$/); if (s) started = s[1].trim();
    }
    if (section === "tasks") {
      const m = line.match(TASK_LINE);
      if (m) {
        let title = (m[3] || "").trim();
        let stream = null;
        let streamTag = null;
        const tag = title.match(STREAM_TAG);
        if (tag) {
          stream = tag[1];
          streamTag = tag[0].trim();
          title = title.slice(0, tag.index).trim();
        }
        tasks.push({ line: i, state: m[1], id: m[2], title, stream, streamTag });
      }
    }
  });
  if (tasksStart < 0) throw new ToolError("docs/PROGRESS.md has no '## Tasks' section");
  if (tasksEnd < 0) tasksEnd = lines.length;
  // Log entries: "### <ID> — <sha or word>" followed by body until next ###
  const logs = {};
  if (logStart >= 0) {
    let cur = null;
    let afterHeading = false;
    for (let i = logStart + 1; i < lines.length; i++) {
      const h = lines[i].match(/^### ([PR]\d+-\d+)\s+—\s+(.*)$/);
      if (h) { cur = h[1]; logs[cur] = (logs[cur] ? logs[cur] + "\n\n" : "") + lines[i]; afterHeading = true; continue; }
      // The blank line that follows an entry's heading is spacing, not part of the entry.
      if (afterHeading && lines[i].trim() === "") { afterHeading = false; continue; }
      afterHeading = false;
      if (cur) logs[cur] += "\n" + lines[i];
    }
    for (const k of Object.keys(logs)) logs[k] = logs[k].replace(/\s+$/, "");
  }
  return { lines, tasks, logs, branch, started, tasksStart, tasksEnd, logStart };
}

function counts(tasks) {
  const c = { todo: 0, inProgress: 0, done: 0, blocked: 0, skipped: 0, total: tasks.length };
  for (const t of tasks) c[STATE_NAMES[t.state]]++;
  c.open = c.todo + c.inProgress;
  return c;
}

function setTaskState(pr, id, state) {
  const t = pr.tasks.find((x) => x.id === id);
  if (!t) throw new ToolError(`task ${id} not found in docs/PROGRESS.md`);
  pr.lines[t.line] = `- [${state}] ${t.id}${t.title ? " " + t.title : ""}${t.streamTag ? " " + t.streamTag : ""}`;
  t.state = state;
}

function appendLog(pr, id, stamp, body) {
  if (pr.logStart < 0) { pr.lines.push("", "## Log"); pr.logStart = pr.lines.length - 1; }
  while (pr.lines.length && pr.lines[pr.lines.length - 1].trim() === "") pr.lines.pop();
  // A blank line after each heading keeps the file markdownlint-clean (MD022); the parser accepts both spacings.
  pr.lines.push("", `### ${id} — ${stamp}`, "", body.replace(/\s+$/, ""));
}

function appendTaskLines(pr, entries) {
  // insert after the last task line in the Tasks section
  const last = pr.tasks.length ? pr.tasks[pr.tasks.length - 1].line : pr.tasksStart;
  const add = entries.map((e) => `- [ ] ${e.id} ${e.title}`);
  pr.lines.splice(last + 1, 0, ...add);
}

function setHeader(pr, key, value) {
  const i = pr.lines.findIndex((l) => l.startsWith(`${key}:`));
  if (i >= 0) pr.lines[i] = `${key}: ${value}`;
  else pr.lines.splice(pr.lines[1] === "" ? 2 : 1, 0, `${key}: ${value}`);
}

const writeProgress = (pr) => write(P.progress, pr.lines.join("\n").replace(/\s*$/, "\n"));

// ---------------------------------------------------------------- PLAN.md

/** One task's block out of PLAN.md's lines. Throws when it has no `### <id>:` heading. */
function planTaskFrom(lines, id) {
  const start = lines.findIndex((l) => l.startsWith(`### ${id}:`));
  if (start < 0) throw new ToolError(`task ${id} has no '### ${id}: <title>' heading in docs/PLAN.md`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^###? /.test(lines[i])) { end = i; break; }
  }
  const text = lines.slice(start, end).join("\n").replace(/\s+$/, "");
  // Only the field line counts: the bold label quoted mid-sentence in another field must not replace the real dependencies.
  const dep = text.match(/^\*\*Depends on:\*\*\s*(.*)$/im);
  const depends = dep && !/^\s*none\b/i.test(dep[1]) ? Array.from(dep[1].matchAll(TASK_ID), (m) => m[0]) : [];
  const files = (text.match(/\*\*Files touched:\*\*\s*([\s\S]*?)(?=\n\*\*|$)/i) || [])[1] || "";
  // `**Stream:**` is absent, empty or `none` for a serial task; anything else
  // is kept verbatim (minus backticks) so a malformed slug shows up as a
  // disagreement with PROGRESS.md's tag rather than being silently dropped.
  const streamLine = (text.match(/^\*\*Stream:\*\*[ \t]*(.*)$/im) || [])[1];
  const streamValue = streamLine === undefined ? "" : streamLine.trim().replace(/^`(.*)`$/, "$1").trim();
  const stream = streamValue === "" || /^none$/i.test(streamValue) ? null : streamValue;
  const filesList = Array.from(files.matchAll(/`([^`\n]+)`/g), (m) => m[1].trim()).filter(Boolean);
  return { id, title: lines[start].slice(`### ${id}:`.length).trim(), text, depends, files: files.trim(), filesList, stream };
}

function planTask(id) {
  if (!exists(P.plan)) throw new ToolError("docs/PLAN.md does not exist");
  return planTaskFrom(read(P.plan).split("\n"), id);
}

// ---------------------------------------------------------------- waves (parallel streams)
//
// A wave is a maximal run of consecutive tasks, in PROGRESS.md order, that
// all carry a `{stream: <slug>}` tag; a task without one is serial and acts
// as a barrier. Within a wave, tasks sharing a stream run in order on one
// implementer and different streams run concurrently. Waves are derived from
// PROGRESS.md on every call, never stored, so they cannot drift from it.

/** Repo-relative path token with any leading `./` dropped, for comparison. */
const normPathToken = (p) => p.replace(/^\.\//, "");

/** Do two Files-touched tokens name overlapping paths? A token ending in `/` is a directory and overlaps anything under it. */
function pathsOverlap(a, b) {
  a = normPathToken(a);
  b = normPathToken(b);
  if (a === b) return true;
  if (a.endsWith("/") && b.startsWith(a)) return true;
  if (b.endsWith("/") && a.startsWith(b)) return true;
  return false;
}

/** Does any file token fall under `prefix`, or (for a directory token) contain it? Mirrors verifyCommands' prefix rule, widened for directories. */
const touchesPrefix = (files, prefix) => files.some((f) => normPathToken(f).startsWith(prefix) || (f.endsWith("/") && prefix.startsWith(normPathToken(f))));

/**
 * Judge one wave's partition: `{ index, taskIds, streams, valid, reason,
 * category }`. `reason` joins every problem found. `category` is
 * `stream-exclusive` when a `verify` command is exclusive (no wave can run in
 * a worktree at all) and `stream-partition` for every other problem. Never
 * throws: a partition that cannot be proven safe is reported invalid, and
 * the caller degrades the wave to serial.
 */
function validateWave(index, tasks, planLines, cc) {
  const problems = [];
  const streams = {};
  for (const t of tasks) (streams[t.stream] = streams[t.stream] || []).push(t.id);

  const info = {};
  for (const t of tasks) {
    let p = null;
    if (planLines) {
      try {
        p = planTaskFrom(planLines, t.id);
      } catch {
        p = null;
      }
    }
    if (!p) {
      problems.push(`${t.id} has no entry in docs/PLAN.md`);
      continue;
    }
    info[t.id] = p;
    if (p.stream !== t.stream) problems.push(`${t.id}: docs/PLAN.md says Stream ${p.stream === null ? "none" : `'${p.stream}'`} but docs/PROGRESS.md tags it '${t.stream}'`);
    if (!p.filesList.length) problems.push(`${t.id} lists no backticked paths under Files touched, so its stream cannot be proven disjoint`);
  }

  // A command that starts a port- or directory-bound environment must run
  // from the main checkout, so a task that triggers one cannot be in a wave.
  const exclusiveVerify = cc.verify.some((c) => c.exclusive);
  if (exclusiveVerify) problems.unshift("a verify command is exclusive, so no task can run from a stream worktree");
  for (const t of tasks) {
    if (!info[t.id]) continue;
    for (const [prefix, cmds] of Object.entries(cc.extraVerify)) {
      if (cmds.some((c) => c.exclusive) && touchesPrefix(info[t.id].filesList, prefix)) {
        problems.push(`${t.id} touches ${prefix}, whose extraVerify includes an exclusive command`);
      }
    }
  }

  // Disjoint Files touched across streams.
  const names = Object.keys(streams).sort();
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      for (const aId of streams[names[i]]) {
        for (const bId of streams[names[j]]) {
          if (!info[aId] || !info[bId]) continue;
          for (const ta of info[aId].filesList) {
            for (const tb of info[bId].filesList) {
              if (!pathsOverlap(ta, tb)) continue;
              const what = normPathToken(ta) === normPathToken(tb) ? `both touch \`${ta}\`` : `overlap (\`${ta}\` and \`${tb}\`)`;
              const msg = `${aId} (stream ${names[i]}) and ${bId} (stream ${names[j]}) ${what}`;
              if (!problems.includes(msg)) problems.push(msg);
            }
          }
        }
      }
    }
  }

  // No dependency across streams inside the wave (a dependency on anything
  // before the wave is fine).
  for (const t of tasks) {
    if (!info[t.id]) continue;
    for (const dep of info[t.id].depends) {
      const target = tasks.find((x) => x.id === dep);
      if (target && target.stream !== t.stream) problems.push(`${t.id} (stream ${t.stream}) depends on ${dep} (stream ${target.stream}) in the same wave`);
    }
  }

  if (names.length < 2) problems.push("only one stream");

  return {
    index,
    taskIds: tasks.map((t) => t.id),
    streams,
    valid: problems.length === 0,
    reason: problems.length ? problems.join("; ") : null,
    category: problems.length ? (exclusiveVerify ? "stream-exclusive" : "stream-partition") : null,
  };
}

/** Every wave in `pr`, in order, numbered from 1, each already judged. `[]` for a plan with no streams. */
function computeWaves(pr, cc, planLines) {
  const groups = [];
  let cur = null;
  for (const t of pr.tasks) {
    if (t.stream) {
      if (!cur) { cur = []; groups.push(cur); }
      cur.push(t);
    } else {
      cur = null;
    }
  }
  if (!groups.length) return [];
  const lines = planLines !== undefined ? planLines : exists(P.plan) ? read(P.plan).split("\n") : null;
  return groups.map((tasks, i) => validateWave(i + 1, tasks, lines, cc));
}

// ---------------------------------------------------------------- streams at run time
//
// A stream runs in its own git worktree, `.kukulu/worktrees/<stream>`, on a
// branch `<build-branch>--<stream>` cut from the build branch. Task *code*
// commits happen there. PROGRESS.md, PLAN.md and state.json live only in the
// main checkout: every stream-scoped call reads and writes them in ROOT and
// commits them on the build branch, and a stream branch never touches them,
// so merging a stream back cannot conflict on bookkeeping.

const STREAM_SLUG = /^[a-z][a-z0-9-]{0,23}$/;
const streamDir = (stream) => path.join(P.worktrees, stream);
const serialWavesOf = (st) => st.serialWaves || [];
const isOpenTask = (t) => t.state === " " || t.state === "~";

/** Stream names that currently have a worktree on disk. */
function streamWorktrees() {
  return exists(P.worktrees) ? fs.readdirSync(P.worktrees).filter((n) => STREAM_SLUG.test(n) && exists(streamDir(n))).sort() : [];
}

/**
 * The wave stream-scoped calls apply to: the wave holding the first open
 * task, when that task is streamed; otherwise a wave with a stream still in
 * flight (every task done, worktree not yet merged back), so a stream can
 * always be finished; otherwise null.
 */
function currentWave(pr, waves) {
  const first = pr.tasks.find(isOpenTask);
  if (first && first.stream) return waves.find((w) => w.taskIds.includes(first.id)) || null;
  const inFlight = new Set(streamWorktrees());
  return waves.find((w) => Object.keys(w.streams).some((n) => inFlight.has(n))) || null;
}

/** Would this wave be handed out as concurrent streams? Valid, `maxStreams` above 1, and not already degraded to serial. */
const waveRunsParallel = (wave, cc, st) => wave.valid && cc.parallel.maxStreams > 1 && !serialWavesOf(st).some((x) => x.wave === wave.index);

/**
 * Streams of `wave` that stream-scoped calls may currently name: those with
 * open tasks while the wave runs parallel, plus any that already have a
 * worktree — a stream already in flight can always finish, even if its wave
 * was degraded to serial underneath it.
 */
function availableStreams(wave, pr, cc, st) {
  const byId = new Map(pr.tasks.map((t) => [t.id, t]));
  return Object.keys(wave.streams).filter(
    (name) => (waveRunsParallel(wave, cc, st) && wave.streams[name].some((id) => isOpenTask(byId.get(id)))) || exists(streamDir(name)),
  );
}

/** Validate a `stream` argument against the current wave; returns `{ stream, wave, pr, cc, st }` or throws. */
function streamScope(stream) {
  if (typeof stream !== "string" || !STREAM_SLUG.test(stream)) {
    throw new ToolError(`stream must be a lowercase slug (a-z, 0-9 and -, starting with a letter), not ${JSON.stringify(stream)}`);
  }
  const pr = parseProgress();
  if (!pr.tasks.some((t) => t.stream)) throw new ToolError("this plan has no parallel streams; omit the stream argument");
  const cc = cfg();
  const st = loadState();
  const wave = currentWave(pr, computeWaves(pr, cc));
  if (!wave) {
    throw new ToolError("no parallel wave is current: the next open task is serial, or nothing is open. Stream-scoped calls only apply while a wave's streams are running; call kukulu_next");
  }
  const avail = availableStreams(wave, pr, cc, st);
  if (!avail.includes(stream)) {
    throw new ToolError(`stream '${stream}' is not available in the current wave (wave ${wave.index}); legal streams: ${avail.join(", ") || "none"}`);
  }
  return { stream, wave, pr, cc, st };
}

/**
 * A serial (stream-less) call for a task whose wave runs parallel would work
 * on the main checkout behind the streams' backs. Refuse it and say what to
 * do instead. A plan with no stream tags never reaches the wave computation.
 */
function refuseSerialInParallelWave(pr, task) {
  if (task && task.stream) {
    const cc = cfg();
    const wave = computeWaves(pr, cc).find((w) => w.taskIds.includes(task.id));
    if (wave && waveRunsParallel(wave, cc, loadState())) {
      throw new ToolError(
        `task ${task.id} belongs to parallel wave ${wave.index} (streams: ${Object.keys(wave.streams).join(", ")}); call kukulu_next and use the streams it returns — kukulu_run_start({ stream }), then kukulu_task_next({ stream }) — instead of a serial call`,
      );
    }
  }
  refuseWhileStreamsPending();
}

/**
 * Record, once, that an invalid wave runs serially: `state.serialWaves`, one
 * feedback entry (a bad partition is a planning defect, so `stage: "plan"`),
 * one commit. Only on a build branch — a flight owns its build branch's
 * history, and this must never commit to the base branch before a run has
 * started — and never when `maxStreams` is 1 (the operator's own choice). An
 * exclusive `verify` command makes every wave serial; that cause is logged
 * once per flight, not once per wave. Returns the (possibly updated) state.
 */
function recordSerialWave(wave, cc, st) {
  if (wave.valid || cc.parallel.maxStreams <= 1 || serialWavesOf(st).some((x) => x.wave === wave.index)) return st;
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], { allowFail: true }).out;
  if (!branch || !branch.startsWith(cc.branchPrefix) || branch.includes("--")) return st;
  const already = serialWavesOf(st).some((x) => x.category === wave.category);
  const cur = loadState();
  cur.serialWaves = [...serialWavesOf(cur), { wave: wave.index, category: wave.category, reason: wave.reason }];
  saveState(cur);
  if (cc.policies.feedback && !(wave.category === "stream-exclusive" && already)) {
    appendFeedback("plan", `Wave ${wave.index} runs serially: ${wave.reason}`, wave.category, "auto");
  }
  gitCommitIfChanged([P.state, P.feedback], `chore: wave ${wave.index} runs serially`, { stage: "controller" });
  return cur;
}

/** Serial work would run on a main checkout that lacks a finished stream's code until that stream is merged back. */
function refuseWhileStreamsPending() {
  const pending = streamWorktrees();
  if (pending.length) {
    throw new ToolError(`stream worktree(s) still exist (${pending.join(", ")}); merge each back with kukulu_stream_finish before any serial work — call kukulu_next`);
  }
}

/**
 * How many reviews this flight has submitted. Round numbering has one
 * meaning everywhere (F-21 of the 2026-09-30 cleanflate feedback): review N
 * is stamped `Round: N` and, if it requests changes, queues fix round N
 * (`R<N>-*` tasks), which `state.round` then counts. So after an approval,
 * reviews = fix rounds + 1. `state.rounds` records every submission; the
 * fallback covers a state file written before it existed.
 */
const reviewCount = (st) => (st.rounds.length ? st.rounds.length : st.round + (st.reviewed ? 1 : 0));

function reviewRoundCount() {
  if (!exists(P.plan)) return 0;
  return (read(P.plan).match(/^## Review fixes \(round \d+\)/gm) || []).length;
}

/** Parse the lock file, tolerating both the JSON form and a legacy bare
 * number. Returns `{ json, count }`; `json` is null for the legacy form. */
function parseLock() {
  const raw = read(P.lock);
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { json: parsed, count: Number.isInteger(parsed.count) ? parsed.count : 0 };
    }
  } catch {
    // fall through to the legacy form below
  }
  const digits = raw.replace(/[^0-9]/g, "");
  return { json: null, count: digits ? Number(digits) : 0 };
}

/**
 * The implement guard's re-block counter, tolerating both the JSON lock
 * kukulu_run_start writes from 0.3.0 and the legacy bare-number form a
 * 0.2.x run may have left armed. `null` when there is no lock to read.
 */
function lockCounter() {
  return exists(P.lock) ? parseLock().count : null;
}

/**
 * Reset the guard's re-block counter to zero on every task state change
 * (kukulu_task_done, kukulu_task_block, kukulu_run_start on resume), so
 * the cap bounds re-blocks *since the last time work actually moved*
 * rather than accumulating over the whole run.
 */
function resetLockCounter() {
  if (!exists(P.lock)) return;
  const lock = parseLock();
  // Any task state change means work moved, so a serial implementer parked at
  // a wave boundary (`paused`) is no longer parked.
  const { paused, ...rest } = lock.json || {};
  void paused;
  write(P.lock, `${lock.json ? JSON.stringify({ ...rest, count: 0 }) : "0"}\n`);
}

/**
 * Mark the lock `paused` (a wave number) when a serial kukulu_task_next
 * hands the flight back to the controller at a parallel-wave boundary, or
 * clear it. The guard hook honours the flag: a serial implementer that has
 * done everything it can before a wave must be allowed to stop, though tasks
 * remain open. A no-op when there is nothing to change, so a plan without
 * streams never rewrites the lock.
 */
function setLockPaused(wave) {
  if (!exists(P.lock)) return;
  const lock = parseLock();
  const has = Boolean(lock.json?.paused);
  if (!wave && !has) return;
  const json = { ...(lock.json || { count: lock.count }) };
  if (wave) json.paused = wave;
  else delete json.paused;
  write(P.lock, `${JSON.stringify(json)}\n`);
}

// ---------------------------------------------------------------- feedback

const FEEDBACK_STAGES = ["plan", "implement", "review", "summarize", "controller"];

/**
 * Append one pipeline-friction entry to `.kukulu/feedback.jsonl` — never
 * commits; callers decide whether to commit alone (the externally-callable
 * `kukulu_feedback_log` tool) or fold it into a commit they are already
 * making (every MCP-internal auto-log call site). `source` is `"agent"`
 * for entries written through the tool, `"auto"` for entries the MCP
 * writes about its own decisions.
 */
function appendFeedback(stage, message, category, source) {
  if (!FEEDBACK_STAGES.includes(stage)) throw new ToolError(`stage must be one of ${FEEDBACK_STAGES.join(", ")}`);
  if (!message || typeof message !== "string") throw new ToolError("message is required");
  const st = loadState();
  const entry = { at: new Date().toISOString(), stage, round: st.round, category: category || "other", message, source };
  fs.mkdirSync(P.stateDir, { recursive: true });
  fs.appendFileSync(P.feedback, `${JSON.stringify(entry)}\n`);
}

/** Number of parseable entries in `.kukulu/feedback.jsonl`; `0` if the file does not exist. A line that fails to parse — a partial write from an interrupted process — is skipped, not fatal. */
function countFeedback() {
  if (!exists(P.feedback)) return 0;
  let n = 0;
  for (const line of read(P.feedback).split("\n")) {
    if (!line.trim()) continue;
    try {
      JSON.parse(line);
      n++;
    } catch {
      // skip a corrupt line rather than failing the whole read
    }
  }
  return n;
}

/**
 * The externally-callable half of feedback capture: a stage agent calls
 * this the moment something costs it time that is Kūkulu's own fault, not
 * the project's. Unlike the MCP's internal auto-logging (which folds a
 * feedback entry into a commit it is already making), this commits on its
 * own every time, because the calling agent has no other commit happening
 * at that instant.
 */
function feedbackLog({ stage, message, category }) {
  if (!cfg().policies.feedback) return { logged: false, reason: "disabled by policy" };
  appendFeedback(stage, message, category, "agent");
  const commit = gitCommitIfChanged([P.feedback], `chore: pipeline friction (${stage})`, { stage: stage === "implement" ? implementStage(loadState()) : stage });
  return { logged: true, count: countFeedback(), commit };
}

// ---------------------------------------------------------------- git facts

function gitFacts() {
  const inRepo = git(["rev-parse", "--is-inside-work-tree"], { allowFail: true }).ok;
  if (!inRepo) return { inRepo: false };
  const c = cfg();
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], { allowFail: true }).out || null;
  const head = git(["rev-parse", "--short", "HEAD"], { allowFail: true }).out || null;
  const base = git(["merge-base", c.baseBranch, "HEAD"], { allowFail: true }).out.slice(0, 12) || null;
  const dirty = git(["status", "--porcelain"], { allowFail: true }).out !== "";
  const remote = git(["remote", "get-url", "origin"], { allowFail: true }).ok;
  return { inRepo: true, branch, head, base, dirty, hasOrigin: remote };
}

// ---------------------------------------------------------------- tools

/**
 * The longest timeout any command Kūkulu runs on the model's behalf can
 * take (`verify`, `extraVerify`, `parallel.setup`), or null with none. Every
 * tool handler is synchronous, so a stream's bookkeeping call can wait
 * behind another stream's longest verify; Claude Code's MCP tool-call
 * timeout (`MCP_TOOL_TIMEOUT`) has to exceed this plus headroom.
 */
function longestCommandTimeoutMs() {
  const cc = cfg();
  const all = [...cc.verify, ...Object.values(cc.extraVerify).flat(), ...cc.parallel.setup];
  return all.length ? Math.max(...all.map((c) => c.timeoutMs)) : null;
}

function status() {
  resolveRouting(); // validate the merged routing config; a bad one refuses here too
  const st = loadState();
  const g = gitFacts();
  const out = {
    root: ROOT,
    specPresent: exists(P.spec),
    planPresent: exists(P.plan),
    progressPresent: exists(P.progress),
    handoffPresent: exists(P.handoff),
    reviewPresent: exists(P.review),
    summaryPresent: exists(P.summary),
    configPresent: exists(P.config),
    lockPresent: exists(P.lock),
    lockCounter: lockCounter(),
    git: g,
    state: st,
    round: st.round,
    reviewRound: st.round + 1,
    preexistingUntracked: st.preexistingUntracked,
    policies: st.policies,
    signing: st.signing,
    feedbackCount: countFeedback(),
    longestCommandTimeoutMs: longestCommandTimeoutMs(),
    review: { mutationFixRounds: cfg().review.mutationFixRounds },
    reviewRoundsInPlan: reviewRoundCount(),
    branch: null,
    started: null,
    counts: null,
    blocked: [],
    skipped: [],
    waves: [],
  };
  if (out.progressPresent) {
    const pr = parseProgress();
    out.branch = pr.branch;
    out.started = pr.started;
    out.counts = counts(pr.tasks);
    out.blocked = pr.tasks.filter((t) => t.state === "!").map((t) => t.id);
    out.skipped = pr.tasks.filter((t) => t.state === "-").map((t) => t.id);
    const isOpen = (id) => {
      const t = pr.tasks.find((x) => x.id === id);
      return t.state === " " || t.state === "~";
    };
    out.waves = computeWaves(pr, cfg()).map((w) => ({
      index: w.index,
      streams: Object.entries(w.streams).map(([stream, ids]) => ({ stream, tasks: ids, open: ids.filter(isOpen).length })),
      valid: w.valid,
      reason: w.reason,
    }));
  }
  if (out.reviewPresent) {
    // Any of `**Verdict**: X`, `**Verdict:** X`, `Verdict: X`, `## Verdict`
    // with X on a following line, and X in backticks or bold (F-21: the
    // `**Verdict:**` shape used to read as null).
    const v = read(P.review).match(/\bVerdict\b[\s:*_`#>-]*(APPROVED|CHANGES REQUESTED)\b/i);
    out.reviewVerdictInFile = v ? v[1].toUpperCase() : null;
  }
  out.agentsGenerated = agentsOnDisk();
  out.agentsGeneratedThisSession = Array.from(generatedThisProcess);
  out.artifacts = artifactStates(g.inRepo);
  out.strayArtifacts = out.artifacts["PLAN.md"] === "absent" ? Object.keys(out.artifacts).filter((k) => out.artifacts[k] === "untracked") : [];
  out.lastReviewCommit = lastReviewCommit(g.inRepo);
  out.cleanroom = cleanroomStatus(st);
  return out;
}

const artifactNames = () => ["SPEC.md", "PLAN.md", "PROGRESS.md", "HANDOFF.md", "REVIEW.md", "SUMMARY.md", path.basename(P.config)];

/** Where each flight artifact stands: absent, untracked, modified (tracked but changed) or tracked. Read-only. */
function artifactStates(inRepo) {
  const out = {};
  for (const name of artifactNames()) {
    const abs = path.join(ROOT, "docs", name);
    const relPath = rel(abs);
    if (!exists(abs)) out[name] = "absent";
    else if (!inRepo || !git(["ls-files", "--error-unmatch", "--", relPath], { allowFail: true }).ok) out[name] = "untracked";
    else out[name] = git(["status", "--porcelain", "--", relPath], { allowFail: true }).out ? "modified" : "tracked";
  }
  return out;
}

/** Short sha of the newest `review:` commit on this branch since it left the base branch, or null. */
function lastReviewCommit(inRepo) {
  if (!inRepo) return null;
  let base = "main";
  try {
    base = cfg().baseBranch;
  } catch {
    // a malformed config is reported elsewhere; the default base is good enough here
  }
  const log = git(["log", "--format=%h%x09%s", `${base}..HEAD`], { allowFail: true });
  if (!log.ok) return null;
  const line = log.out.split("\n").find((l) => l.split("\t")[1]?.startsWith("review:"));
  return line ? line.split("\t")[0] : null;
}

const AGENT = { plan: "kukulu:planner", implement: "kukulu:implementer", review: "kukulu:reviewer", summarize: "kukulu:summarizer" };
const ROLE_OF_STAGE = { plan: "planner", implement: "implementer", review: "reviewer", summarize: "summarizer" };

function next() {
  const routing = resolveRouting();
  const s = status();
  const c = cfg();
  const st = s.state;
  /**
   * Whether the generated agent for `role` can be trusted to spawn in this
   * session: the file exists on disk (Claude Code hot-reloads a *change* to
   * an already-populated agents directory within seconds) and this process
   * did not just create the agents directory itself (the one case Claude
   * Code does not hot-load — the directory's first population needs a
   * restart). When it cannot be trusted and the routed model is not one the
   * Agent tool can name directly (see agentToolModel), there is no safe
   * fallback and a restart is required.
   */
  const agentInfo = (name) => {
    const role = ROLE_OF_STAGE[name];
    const fallbackAgent = role ? AGENT[name] : null;
    if (!role) return { agent: null, agentFallback: false, fallbackAgent: null, agentModel: null, agentModelExact: true, restartRequired: false };
    const onDisk = exists(path.join(P.agentsDir, `kukulu-${role}.md`));
    const agentFallback = !onDisk || agentsDirCreatedThisProcess;
    const mapped = agentToolModel(routing.roles[role].model);
    const agentModel = mapped ? mapped.value : null;
    const agentModelExact = mapped ? mapped.exact : true;
    if (agentFallback && mapped === null) {
      return { agent: null, agentFallback: true, fallbackAgent, agentModel, agentModelExact, restartRequired: true };
    }
    // Under fallback, name the plugin's own agent outright. Naming the
    // generated one only produced an "agent type not found" error and a retry
    // on a project's first flight, since a new agents directory loads only in
    // the next session (F-22 of the 2026-09-30 cleanflate feedback).
    return { agent: agentFallback ? fallbackAgent : `kukulu-${role}`, agentFallback, fallbackAgent, agentModel, agentModelExact, restartRequired: false };
  };
  const modelFor = (name) => {
    const role = ROLE_OF_STAGE[name];
    return role ? routing.roles[role].model : null;
  };
  // Read fresh from kukulu.json rather than state, so the sentence is
  // accurate even before this round's kukulu_run_start has recorded
  // state.policies (round 0, before the implementer's first call).
  let gateResult = null;
  const policySentence = `Run policies: signing=${c.policies.signing}, push=${c.policies.push ? "on" : "off"}, pr=${c.policies.pr}.${cleanroomOn(c) ? ` ${CLEANROOM_SENTENCE}` : ""}`;
  const stage = (name, reason, extra = {}) => {
    const info = agentInfo(name);
    return {
      stage: name,
      agent: info.agent,
      agentFallback: info.agentFallback,
      fallbackAgent: info.fallbackAgent,
      restartRequired: info.restartRequired,
      model: modelFor(name),
      agentModel: info.agentModel,
      agentModelExact: info.agentModelExact,
      round: st.round,
      reviewRound: st.round + 1,
      reason,
      gate: gateResult ? { ok: gateResult.ok, checked: gateResult.checked } : null,
      prompt: PROMPTS[name] ? PROMPTS[name](st.round, s, policySentence, st.round + 1) : null,
      ...extra,
    };
  };

  /**
   * The parallel-wave half of the implement stage. `{}` when the flight is
   * serial here; otherwise `{ streams, reason }`, one entry per stream to
   * spawn concurrently. Streams already in flight (a worktree exists) come
   * first and are always offered — an unfinished one is re-handed out, and a
   * finished-but-unmerged one is offered so it can be merged — and the rest
   * follow in plan order, up to `parallel.maxStreams`.
   *
   * A wave whose partition is invalid runs serially. That decision is
   * recorded once — see recordSerialWave, which is also called when a serial
   * kukulu_task_next first serves a task from such a wave.
   */
  const streamOffer = () => {
    if (!s.progressPresent) return {};
    const pr = parseProgress();
    if (!pr.tasks.some((t) => t.stream)) return {};
    let cur = st;
    const waves = computeWaves(pr, c);
    const wave = currentWave(pr, waves);
    if (!wave) return {};
    cur = recordSerialWave(wave, c, cur);
    const info = agentInfo("implement");
    const avail = availableStreams(wave, pr, c, cur);
    const inFlight = new Set(streamWorktrees());
    const ordered = [...avail.filter((n) => inFlight.has(n)), ...avail.filter((n) => !inFlight.has(n))].slice(0, c.parallel.maxStreams);
    if (!ordered.length) return {};
    return {
      reason: `wave ${wave.index}: ${ordered.length} stream(s) to run in parallel (${ordered.join(", ")})`,
      streams: ordered.map((name) => ({
        stream: name,
        agent: info.agent,
        agentFallback: info.agentFallback,
        fallbackAgent: info.fallbackAgent,
        agentModel: info.agentModel,
        agentModelExact: info.agentModelExact,
        prompt: PROMPTS.implementStream(name, wave.index, policySentence),
      })),
    };
  };

  if (!s.specPresent) return stage("halt", "docs/SPEC.md is missing; nothing to build from");
  const policyPresent = cleanroomOn(c);
  const broken = cleanroomModeBreak(st, policyPresent, s.planPresent);
  if (broken) return stage("halt", modeBreakText(broken));
  if (policyPresent && !st.cleanroom) cleanroomGenesis(c, st);
  gateResult = runGate("controller", st);
  if (gateResult && !gateResult.ok) return stage("halt", `clean-room gate failed: ${gateResult.failed.check}: ${gateResult.failed.reason}`);
  if (st.halted) return stage("halt", st.haltCap || st.halted.includes("kukulu_run_resume") ? st.halted : `${st.halted} — ${RESUME_HINT}`);
  if (st.awaitingSigning) {
    const mb = git(["merge-base", c.baseBranch, "HEAD"], { allowFail: true }).out || "<merge-base>";
    return stage("done", `awaiting signing: ${st.awaitingSigning.unsigned} unsigned commit(s), oldest ${String(st.awaitingSigning.first).slice(0, 7)}. ${nextSteps(mb)}`);
  }
  if (st.archived && !s.planPresent && exists(path.join(ROOT, st.archived.dir, "SPEC.md")) && read(P.spec) === read(path.join(ROOT, st.archived.dir, "SPEC.md"))) {
    return stage("done", `flight ${st.archived.slug} is archived in ${st.archived.dir}; edit docs/SPEC.md for the next flight, then run /kukulu:go-flight`);
  }
  if (!s.planPresent || !s.progressPresent || !s.configPresent) {
    return stage("plan", "no plan on disk (docs/PLAN.md, docs/PROGRESS.md and docs/kukulu.json are all required)");
  }
  const offer = streamOffer();
  if (offer.streams) return stage("implement", offer.reason, { streams: offer.streams });
  const open = s.counts.open;
  // The round cap decision is made once, by kukulu_review_submit, and
  // recorded as state.halted (checked above) — next() never re-derives it,
  // so a converging flight is never second-guessed here.
  if (open > 0) return stage("implement", `${open} open task(s) in docs/PROGRESS.md`);
  if (s.lockPresent) return stage("implement", "implementation lock present but no open tasks: the run stopped before kukulu_run_finish; finish the handoff");
  if (!st.implemented) return stage("implement", "no handoff recorded for this round");
  if (!st.reviewed) return stage("review", `round ${st.round} implemented and not yet reviewed`);
  if (st.verdict === "CHANGES REQUESTED") {
    return stage("halt", "review requested changes but no fix tasks are open; kukulu_review_submit should have queued them");
  }
  if (st.verdict === "APPROVED" && !st.summarized) return stage("summarize", "review approved; summary not yet written");
  if (st.summarized) {
    const reviews = reviewCount(st);
    return stage("done", `flight complete after ${reviews} review${reviews === 1 ? "" : "s"} (${st.round} fix round${st.round === 1 ? "" : "s"}); branch ${s.branch} is ready for a human to merge`);
  }
  return stage("halt", "unrecognised state; run kukulu_status");
}

const PROMPTS = {
  plan: () =>
    "Run the Kūkulu plan stage for this repository. Read docs/SPEC.md and everything else in docs/ in full, then produce docs/PLAN.md, docs/PROGRESS.md, docs/kukulu.json and CLAUDE.md exactly as your plan-build instructions specify, commit them, and report. Do not write implementation code.",
  implement: (round, s, policies) =>
    `Run the Kūkulu implement stage. ${round === 0 ? "This is the initial build." : `This is review-fix round ${round}; the open tasks are R${round}-* fix tasks queued by the reviewer.`} Call kukulu_run_start, then loop on kukulu_task_next until it reports done, then write docs/HANDOFF.md and call kukulu_run_finish. You are unattended; never ask a question and never stop with open tasks. ${s.counts ? `${s.counts.open} task(s) are open.` : ""} ${policies}`,
  // Not a stage of its own: one entry of `streams` in an implement result.
  implementStream: (stream, wave, policies) =>
    `Run the Kūkulu implement stage for stream \`${stream}\` of wave ${wave}. Call kukulu_run_start with stream: "${stream}", and work only inside the cwd it returns: every file you read, edit or commit is under it. Pass stream: "${stream}" to every kukulu_task_next, kukulu_task_done, kukulu_task_block and kukulu_verify call. Loop on kukulu_task_next until it reports done, then call kukulu_stream_finish with stream: "${stream}". Do not write docs/HANDOFF.md and do not call kukulu_run_finish: another stage does. You are unattended; never ask a question and never stop with open tasks in your stream. ${policies}`,
  review: (round, s, policies, reviewRound) =>
    `Run the Kūkulu review stage. This review is round ${reviewRound}; write \`Round: ${reviewRound}\` on the second line of docs/REVIEW.md, and use \`R${reviewRound}-<nn>\` when a fix task's dependsOn must reference another fix task in the same submission. Review the whole build branch against docs/SPEC.md and docs/PLAN.md as your review-build instructions specify, write docs/REVIEW.md, and call kukulu_review_submit exactly once with your verdict. Do not fix code yourself. ${policies}`,
  summarize: (round, s, policies) =>
    `Run the Kūkulu summarize stage. The review is APPROVED. Compose docs/SUMMARY.md as your summarize instructions specify and pass its full text as \`content\` to kukulu_summary_commit, which writes and commits it; do not write the file yourself. After that, archive if kukulu_summary_commit reports archive: true, and end with kukulu_pr_finalize; never pass resign. Do not merge. ${policies}`,
};

/**
 * Prove signing works rather than assume it (F-05: a dry run is not
 * enough — the actual signing agent has to produce a real signed object).
 * Returns the outcome to record in state: `"on"`, `"off"`, `"none"` (not
 * configured), or `"off (probe failed: <reason>)"` for `auto` falling back.
 * Throws under `required` when signing is not configured or the probe fails.
 */
function probeSigning(signingPolicy) {
  if (signingPolicy === "off") {
    git(["config", "--local", "commit.gpgsign", "false"]);
    return "off";
  }
  const configured = git(["config", "--get", "commit.gpgsign"], { allowFail: true }).out === "true";
  if (!configured) {
    if (signingPolicy === "required") {
      throw new ToolError("policies.signing is 'required' but commit.gpgsign is not set; fix the signing agent or set policies.signing to 'off'");
    }
    return "none";
  }
  const probe = spawnSync("git", ["commit-tree", "-S", "HEAD^{tree}", "-m", "kukulu signing probe"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: SIGNING_TIMEOUT_MS,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  if (probe.status === 0 && !probe.error) return "on";
  const errLine = (probe.stderr || probe.stdout || probe.error?.message || "signing probe failed").trim().split("\n")[0] || "signing probe failed";
  if (signingPolicy === "required") {
    throw new ToolError(`policies.signing is 'required' but the signing probe failed: ${errLine}. Fix the signing agent or set policies.signing to 'off'.`);
  }
  git(["config", "--local", "commit.gpgsign", "false"]);
  return `off (probe failed: ${errLine})`;
}

/**
 * Merge the local base branch into the build branch when it has commits the
 * branch lacks (SPEC B-03). Nothing is fetched. Returns null when there is
 * nothing to do, `{ commits, merge: null, skipped }` when the tracked tree is
 * dirty, else `{ commits, merge: <short sha> }`. A conflict aborts the merge
 * and refuses; it never halts. Callers run it before any write of their own.
 */
function syncBase(tool) {
  const cc = cfg();
  if (!cc.policies.syncBase) return null;
  const base = cc.baseBranch;
  const baseRef = `refs/heads/${base}`;
  if (!git(["rev-parse", "--verify", "--quiet", baseRef], { allowFail: true }).ok) return null;
  const branch = gitFacts().branch;
  if (!branch || branch === base) return null;
  const n = Number(git(["rev-list", "--count", `HEAD..${baseRef}`], { allowFail: true }).out);
  if (!(n > 0)) return null;
  if (trackedDirtyLines().length) return { commits: n, merge: null, skipped: "the tracked tree has uncommitted changes" };
  const st = loadState();
  const crPaths = cleanroomPaths(st);
  // withRollback puts the clean-room log back byte for byte if anything below throws, after the merge is aborted.
  return withRollback(crPaths, () => {
    const m = git(["merge", "--no-ff", "--no-commit", baseRef], { allowFail: true });
    if (!m.ok) {
      const files = git(["diff", "--name-only", "--diff-filter=U"], { allowFail: true }).out.split("\n").filter(Boolean);
      git(["merge", "--abort"], { allowFail: true });
      const why = files.length ? `they conflict in ${files.join(", ")}` : `the merge failed: ${(m.err || m.out || "unknown error").split("\n").filter(Boolean)[0] ?? "unknown error"}`;
      throw new ToolError(`${base} has ${n} commits this branch lacks and ${why}; resolve the merge by hand on ${branch}, commit it, then call ${tool} again, or set policies.syncBase to false`);
    }
    try {
      if (crPaths.length) {
        checkpoint("base-sync", "implement", st);
        git(["add", "--", ...crPaths.map(rel)]);
      }
      commitStaged(crPaths.map(rel), `chore: merge ${base} into ${branch}`, { stage: "implement", task: "-", noPathspec: true });
    } catch (e) {
      git(["merge", "--abort"], { allowFail: true });
      throw e;
    }
    return { commits: n, merge: git(["rev-parse", "--short", "HEAD"]).out };
  });
}

function startRun({ sync = false } = {}) {
  requireGate(implementStage(loadState()));
  for (const [k, p] of Object.entries({ spec: P.spec, plan: P.plan, progress: P.progress, config: P.config })) {
    if (!exists(p)) throw new ToolError(`${rel(p)} is missing (${k}); run the plan stage first`);
  }
  const c = cfg();
  const g = gitFacts();
  if (!g.inRepo) throw new ToolError("not a git repository");
  // A branch this call cuts from the base is already up to date; only an existing build branch can lag behind it.
  const baseSynced = sync && g.branch && g.branch.startsWith(c.branchPrefix) ? syncBase("kukulu_run_start") : null;
  const withSync = (r) => (baseSynced ? { ...r, baseSynced } : r);
  const pr = parseProgress();
  const st = loadState();

  let branch = g.branch;
  let basePush;
  if (exists(P.lock) && pr.branch && !pr.branch.startsWith("(")) {
    resetLockCounter();
    return withSync({ alreadyStarted: true, branch, counts: counts(pr.tasks), round: st.round, policies: st.policies, signing: st.signing });
  }
  if (branch === c.baseBranch) {
    // Untracked files never block a run from starting: branching off HEAD
    // does not touch them, and they are recorded as pre-existing below
    // regardless (F-09). Only uncommitted changes to *tracked* files are
    // grounds to refuse — those would otherwise ride along into a task's
    // first commit or be stranded on a branch nobody asked to switch to.
    const trackedDirty = trackedDirtyLines().length > 0;
    if (trackedDirty) throw new ToolError(`working tree is dirty on ${c.baseBranch}; commit or stash before starting a run`);
    let name = `${c.branchPrefix}${today()}`;
    let n = 2;
    while (git(["rev-parse", "--verify", "--quiet", name], { allowFail: true }).ok) name = `${c.branchPrefix}${today()}-${n++}`;
    // Push the base branch itself before branching off it, so the planner's
    // commits reach the remote and a later PR's diff is the build, not the
    // plan (F-18). A failed base push is reported, not fatal: the build
    // branch push in run_finish still carries the plan commits either way.
    basePush = pushBranch(c.baseBranch, c.policies.push);
    git(["checkout", "-q", "-b", name]);
    branch = name;
  } else if (!branch || !branch.startsWith(c.branchPrefix)) {
    throw new ToolError(
      `on branch '${branch}'; runs start from '${c.baseBranch}' or an existing '${c.branchPrefix}*' branch. Either set baseBranch to '${branch}' in docs/kukulu.json and re-run \`kukulu_plan_commit\`, or \`git switch -c ${c.branchPrefix}${today()}\` from '${branch}'.`,
    );
  }

  // Snapshot what is untracked *before* this call's own writes (starting
  // with .gitignore below) can create anything new — otherwise a freshly
  // created .gitignore would be misfiled as if it predated the run.
  const preexistingUntracked = untrackedPaths();
  // In clean-room mode the signing key must exist before the first checkpoint; without a policy the flight is general, for good.
  if (cleanroomOn(c)) ensureKey(c);

  // .gitignore the lock, arm it, stamp PROGRESS, commit.
  const crPaths = cleanroomPaths(st);
  const sha = withRollback([P.gitignore, P.progress, P.state, P.feedback, ...crPaths], () => {
  ensureLineInFile(P.gitignore, rel(P.lock));
  // Only a plan that declares streams ever creates worktrees, so only such a
  // plan gets the extra line (a plan without streams stays byte-identical).
  if (pr.tasks.some((t) => t.stream)) ensureLineInFile(P.gitignore, `${rel(P.worktrees)}/`);
  fs.mkdirSync(P.stateDir, { recursive: true });
  write(P.lock, `${JSON.stringify({ count: 0, armedAt: new Date().toISOString(), round: st.round, cap: c.guardCap })}\n`);
  if (!pr.branch || pr.branch.startsWith("(")) setHeader(pr, "Branch", branch);
  if (!pr.started || pr.started.startsWith("(")) setHeader(pr, "Started", new Date().toISOString());
  writeProgress(pr);
  // Whatever was untracked before this call is not this run's business: not
  // a deliverable to commit, not debris to clean up, not a signal to act on
  // (F-09, F-17).
  st.preexistingUntracked = preexistingUntracked;
  if (!cleanroomOn(c) && !st.cleanroom) st.cleanroom = { mode: "general" };
  st.policies = c.policies;
  st.signing = probeSigning(c.policies.signing);
  if (st.signing.startsWith("off (probe failed")) st.signingOverride = true;
  st.implemented = false; st.reviewed = false; st.verdict = null;
  saveState(st);
  // Only the auto fallback is friction — an explicit "off" or an
  // unconfigured "none" is the operator's or the project's own choice
  // working as intended, not something Kūkulu did wrong.
  if (c.policies.feedback && st.signing.startsWith("off (probe failed")) {
    appendFeedback("implement", `Signing disabled for this run: ${st.signing}`, "signing", "auto");
  }
  checkpoint("run-start", implementStage(st), st);
  return gitCommitIfChanged([P.gitignore, P.progress, P.state, P.feedback, ...crPaths], st.round === 0 ? "chore: start implementation run" : `chore: start review-fix round ${st.round}`, { stage: implementStage(st) });
  });
  return withSync({ alreadyStarted: false, branch, commit: sha, counts: counts(pr.tasks), round: st.round, policies: st.policies, signing: st.signing, basePush });
}

/**
 * Create `.kukulu/worktrees/<stream>` on `<build>--<stream>` and run
 * `parallel.setup` in it (a fresh checkout has none of the installed
 * dependencies verify needs). Returns `{ cwd, streamBranch, created, setup }`;
 * on a setup failure the worktree (and a branch this call created) is removed
 * again and `{ failed: <runShell result> }` is returned instead.
 */
function ensureStreamWorktree(stream, buildBranch, cc) {
  const dir = streamDir(stream);
  const streamBranch = `${buildBranch}--${stream}`;
  if (exists(dir)) return { cwd: dir, streamBranch, created: false, setup: [] };
  git(["worktree", "prune"], { allowFail: true });
  fs.mkdirSync(P.worktrees, { recursive: true });
  const branchExisted = git(["rev-parse", "--verify", "--quiet", `refs/heads/${streamBranch}`], { allowFail: true }).ok;
  if (branchExisted) git(["worktree", "add", dir, streamBranch]);
  else git(["worktree", "add", "-b", streamBranch, dir, "HEAD"]);
  const setup = [];
  for (const c of cc.parallel.setup) {
    const r = runShell(c.cmd, c.timeoutMs, dir);
    setup.push(r);
    if (!r.ok) {
      git(["worktree", "remove", "--force", dir], { allowFail: true });
      if (!branchExisted) git(["branch", "-D", streamBranch], { allowFail: true });
      return { failed: r, setup };
    }
  }
  return { cwd: dir, streamBranch, created: true, setup };
}

function runStart({ stream } = {}) {
  const res = startRun({ sync: stream === undefined });
  if (stream === undefined) return res;

  const { wave, cc } = streamScope(stream);
  const created = ensureStreamWorktree(stream, res.branch, cc);
  if (created.failed) {
    // A broken setup degrades the wave to serial — never a halt — and is
    // recorded once, in the same commit as the state change.
    const st = loadState();
    const reason = `setup command ${JSON.stringify(created.failed.command)} failed for stream ${stream}: ${(created.failed.stderrTail || created.failed.stdoutTail || `exit ${created.failed.exitCode}`).split("\n").pop()}`;
    st.serialWaves = [...serialWavesOf(st), { wave: wave.index, category: "stream-setup", reason }];
    saveState(st);
    if (cc.policies.feedback) appendFeedback("implement", `Wave ${wave.index} runs serially: ${reason}`, "stream-setup", "auto");
    gitCommitIfChanged([P.state, P.feedback], `chore: wave ${wave.index} runs serially`, { stage: "controller" });
    throw new ToolError(`${reason}. Wave ${wave.index} now runs serially; stop here and the controller's next kukulu_next will hand it out that way.`);
  }

  if (created.created) {
    // A stream worktree's own untracked files (installed dependencies that
    // are not gitignored) are not the task's business, exactly like the
    // files that were already untracked when a serial run started (F-09).
    const st = loadState();
    st.streams = { ...(st.streams || {}), [stream]: { branch: created.streamBranch, preexistingUntracked: untrackedPaths(created.cwd) } };
    saveState(st);
    gitCommitIfChanged([P.state], `chore: stream ${stream} started (wave ${wave.index})`, { stage: implementStage(st) });
    // Runs that began before this plan's streams (or before 0.4.0) may lack
    // the .gitignore line; exclude per clone rather than dirty the tree.
    const ignored = exists(P.gitignore) && read(P.gitignore).split("\n").includes(`${rel(P.worktrees)}/`);
    if (!ignored) ensureLineInFile(gitPath("info/exclude"), `${rel(P.worktrees)}/`);
  }
  return { ...res, stream, wave: wave.index, cwd: created.cwd, streamBranch: created.streamBranch, created: created.created, setup: created.setup };
}

/**
 * Merge a finished stream back into the build branch and remove its worktree
 * and branch. Refuses while the stream has open tasks or an uncommitted
 * worktree. A merge conflict — the partition check makes one unlikely, not
 * impossible — is the one stream failure that halts: Kūkulu aborts the
 * merge, keeps the stream branch and worktree, and records why, because it
 * cannot guess a merge.
 */
function streamFinish({ stream } = {}) {
  const { wave, pr, cc, st } = streamScope(stream);
  const dir = streamDir(stream);
  if (!exists(dir)) throw new ToolError(`stream '${stream}' has no worktree; nothing to finish`);
  const byId = new Map(pr.tasks.map((t) => [t.id, t]));
  const open = wave.streams[stream].filter((id) => isOpenTask(byId.get(id)));
  if (open.length) throw new ToolError(`stream '${stream}' still has open tasks: ${open.join(", ")}; finish or block them before kukulu_stream_finish`);
  const dirty = porcelainExcludingPreexisting((st.streams || {})[stream]?.preexistingUntracked || [], dir);
  if (dirty.length) {
    throw new ToolError(`stream '${stream}' has uncommitted changes in its worktree:\n${dirty.join("\n")}\nCommit them to the stream's task, or \`git checkout --\`/\`git clean\` them, then call kukulu_stream_finish again.`);
  }

  const g = gitFacts();
  if (!g.branch || !g.branch.startsWith(cc.branchPrefix) || g.branch.includes("--")) {
    throw new ToolError(`the main checkout is on '${g.branch}', not the build branch; kukulu_stream_finish merges into the build branch`);
  }
  const streamBranch = `${g.branch}--${stream}`;
  if (!git(["rev-parse", "--verify", "--quiet", `refs/heads/${streamBranch}`], { allowFail: true }).ok) {
    throw new ToolError(`branch ${streamBranch} does not exist; the stream's worktree is not on the expected branch`);
  }
  // Every stream call leaves PROGRESS.md/state.json changes for the next
  // commit; land them first so the merge starts from a clean tracked tree.
  gitCommitIfChanged([P.progress, P.state, P.feedback], `progress: sync before merging stream ${stream}`, { stage: implementStage(loadState()) });
  const stray = trackedDirtyLines().join("\n");
  if (stray) throw new ToolError(`the main checkout has uncommitted tracked changes; commit or discard them before merging stream '${stream}':\n${stray}`);

  const before = git(["rev-parse", "HEAD"]).out;
  const merge = git(["merge", "--no-ff", "--no-edit", "-m", withTrailers(`merge stream ${stream} (wave ${wave.index})`, { stage: implementStage(loadState()), task: "-" }), streamBranch], { allowFail: true });
  if (!merge.ok) {
    const conflicts = git(["diff", "--name-only", "--diff-filter=U"], { allowFail: true }).out.split("\n").filter(Boolean);
    git(["merge", "--abort"], { allowFail: true });
    // A merge can also fail before it starts (an untracked file in the main
    // checkout that the stream adds would be overwritten); then there are no
    // conflict paths, and git's own message is the only useful explanation.
    const gitSays = (merge.err || merge.out || "unknown error").split("\n").filter(Boolean).slice(0, 4).join(" ").replace(/\s+/g, " ");
    const what = conflicts.length ? `conflicted in ${conflicts.join(", ")}` : `failed: ${gitSays}`;
    const halted = `merging stream '${stream}' (branch ${streamBranch}) into ${g.branch} ${what}; the stream's branch and worktree ${rel(dir)} are kept. A human must resolve it: from the main checkout run \`git merge --no-ff ${streamBranch}\`, fix what it reports and commit, then \`git worktree remove --force ${rel(dir)}\` and call kukulu_run_resume({ reason: "merged stream ${stream} by hand" }).`;
    const cur = loadState();
    cur.halted = halted;
    delete cur.haltCap;
    cur.haltStream = stream; // so kukulu_run_resume can tell a merge halt from any other
    saveState(cur);
    if (cc.policies.feedback) appendFeedback("implement", halted, "stream-merge", "auto");
    gitCommitIfChanged([P.state, P.feedback], `chore: run halted (stream ${stream} merge conflict)`, { stage: implementStage(cur) });
    return { stream, merged: false, halted, conflicts };
  }

  git(["worktree", "remove", "--force", dir]);
  git(["branch", "-d", streamBranch]);
  const after = git(["rev-parse", "HEAD"]).out;
  const remainingStreams = Object.keys(wave.streams).filter((n) => n !== stream && (exists(streamDir(n)) || wave.streams[n].some((id) => isOpenTask(byId.get(id)))));
  return { stream, merged: true, mergeCommit: after === before ? null : git(["rev-parse", "--short", "HEAD"]).out, remainingStreams };
}

function taskNext({ stream } = {}) {
  requireGate(implementStage(loadState()));
  // Only a serial flight syncs: a stream works in its own worktree, and a plan with streams merges them back by itself.
  const baseSynced = stream === undefined && !parseProgress().tasks.some((t) => t.stream) ? syncBase("kukulu_task_next") : null;
  const withSync = (r) => (baseSynced ? { ...r, baseSynced } : r);
  const pr = parseProgress();
  let inScope = () => true;
  if (stream !== undefined) {
    const scope = streamScope(stream);
    inScope = (t) => t.stream === stream && scope.wave.taskIds.includes(t.id);
  } else if (pr.tasks.some((t) => t.stream) && streamWorktrees().length) {
    // Streams are running (or finished and unmerged): no serial work, and the
    // wave-specific message is the useful one when the next task is in it.
    refuseSerialInParallelWave(pr, pr.tasks.find((t) => t.state === "~") || pr.tasks.find((t) => t.state === " "));
  }
  // A serial implementer that has done everything it can before a parallel
  // wave is told to stop, not refused: the flight controller hands the wave's
  // streams out next. Only a plan that declares streams ever computes waves.
  let waveCtx = null;
  const parallelWaveOf = (task) => {
    if (stream !== undefined || !task.stream) return null;
    waveCtx = waveCtx || { cc: cfg(), st: loadState() };
    const wave = computeWaves(pr, waveCtx.cc).find((w) => w.taskIds.includes(task.id));
    if (!wave) return null;
    // The moment a serial implementer is handed an invalid wave's task is
    // when the wave's degrade to serial takes effect: record it if the
    // controller has not already (it may never call kukulu_next again).
    waveCtx.st = recordSerialWave(wave, waveCtx.cc, waveCtx.st);
    return waveRunsParallel(wave, waveCtx.cc, waveCtx.st) ? wave : null;
  };
  const skipped = [];
  for (;;) {
    const pick = pr.tasks.find((t) => inScope(t) && t.state === "~") || pr.tasks.find((t) => inScope(t) && t.state === " ");
    const wave = pick ? parallelWaveOf(pick) : null;
    if (wave) {
      writeProgress(pr);
      if (skipped.length) gitCommitIfChanged([P.progress], `progress: skip ${skipped.map((x) => x.id).join(", ")}`, { stage: implementStage(loadState()) });
      setLockPaused(wave.index);
      return withSync({
        done: true,
        paused: true,
        wave: wave.index,
        streams: Object.keys(wave.streams),
        counts: counts(pr.tasks),
        skipped,
        message: `Everything you can do serially is done: the next open task (${pick.id}) belongs to parallel wave ${wave.index}, whose streams the flight controller hands out next. Stop now. Do NOT write docs/HANDOFF.md and do NOT call kukulu_run_finish: the plan is not finished.`,
      });
    }
    if (!pick) {
      writeProgress(pr);
      if (skipped.length) gitCommitIfChanged([P.progress], `progress: skip ${skipped.map((s) => s.id).join(", ")}`, { stage: implementStage(loadState()) });
      return withSync({ done: true, counts: counts(pr.tasks), skipped, ...(stream !== undefined ? { stream } : {}) });
    }
    const task = planTask(pick.id);
    const bad = task.depends.find((d) => {
      const t = pr.tasks.find((x) => x.id === d);
      return t && (t.state === "!" || t.state === "-");
    });
    if (bad) {
      setTaskState(pr, pick.id, "-");
      appendLog(pr, pick.id, "skipped", `SKIPPED: depends on ${bad}`);
      skipped.push({ id: pick.id, dependsOn: bad });
      continue;
    }
    const resumed = pick.state === "~";
    setTaskState(pr, pick.id, "~");
    writeProgress(pr);
    setLockPaused(null);
    const dependencyLogs = {};
    for (const d of task.depends) if (pr.logs[d]) dependencyLogs[d] = pr.logs[d];
    return withSync({
      done: false,
      id: task.id,
      title: task.title,
      text: task.text,
      files: task.files,
      dependsOn: task.depends,
      dependencyLogs,
      skipped,
      counts: counts(pr.tasks),
      resumed,
      ...(stream !== undefined ? { stream } : {}),
    });
  }
}

/**
 * The worktree a stream-scoped task call works in, plus the untracked files
 * to ignore there. Refuses a task that is not the stream's own, or a stream
 * that has no worktree yet.
 */
function streamTaskContext(stream, pr, task) {
  const scope = streamScope(stream);
  if (task.stream !== stream) throw new ToolError(`task ${task.id} belongs to stream '${task.stream ?? "none"}', not '${stream}'`);
  const cwd = streamDir(stream);
  if (!exists(cwd)) throw new ToolError(`stream '${stream}' has no worktree; call kukulu_run_start({ stream: "${stream}" }) first`);
  return { cwd, ignore: (scope.st.streams || {})[stream]?.preexistingUntracked || [] };
}

function taskDone({ stream, id, log }) {
  if (!id || !log) throw new ToolError("id and log are required");
  const pr = parseProgress();
  const t = pr.tasks.find((x) => x.id === id);
  if (!t) throw new ToolError(`task ${id} not in docs/PROGRESS.md`);
  if (t.state !== "~") throw new ToolError(`task ${id} is '${STATE_NAMES[t.state]}', not in progress; call kukulu_task_next first`);
  refuseProgressText("log", log, "kukulu_task_done");
  let cwd = ROOT;
  let ignore = loadState().preexistingUntracked;
  if (stream !== undefined) ({ cwd, ignore } = streamTaskContext(stream, pr, t));
  else refuseSerialInParallelWave(pr, t);
  const subject = git(["log", "-1", "--format=%s"], { cwd }).out;
  if (!subject.startsWith(`${id}:`)) {
    throw new ToolError(`HEAD commit '${subject}' is not this task's commit; commit the task as '${id}: <title>' before calling kukulu_task_done`);
  }
  const dirtyOutsideProgress = porcelainExcludingPreexisting(ignore, cwd).filter((l) => !l.endsWith("docs/PROGRESS.md"));
  if (dirtyOutsideProgress.length) {
    throw new ToolError(
      `uncommitted changes remain after the task commit:\n${dirtyOutsideProgress.join("\n")}\nCommit them as part of ${id} or \`git checkout --\`/\`git clean\` them.`,
    );
  }
  const sha = git(["rev-parse", "--short", "HEAD"], { cwd }).out;
  const stDone = loadState();
  const crPaths = cleanroomPaths(stDone);
  const psha = withRollback([P.progress, ...crPaths], () => {
    setTaskState(pr, id, "x");
    appendLog(pr, id, sha, log);
    writeProgress(pr);
    checkpoint("kukulu_task_done", implementStage(stDone), stDone);
    return gitCommitIfChanged([P.progress, ...crPaths], `progress: ${id} done`, { stage: implementStage(stDone), task: id });
  });
  resetLockCounter();
  return { id, taskCommit: sha, progressCommit: psha, counts: counts(pr.tasks), guardReset: true, ...(stream !== undefined ? { stream } : {}) };
}

function taskBlock({ stream, id, reason }) {
  if (!id || !reason) throw new ToolError("id and reason are required");
  let pr = parseProgress();
  const t = pr.tasks.find((x) => x.id === id);
  if (!t) throw new ToolError(`task ${id} not in docs/PROGRESS.md`);
  refuseProgressText("reason", `BLOCKED: ${reason}`, "kukulu_task_block");
  let cwd = ROOT;
  let ignore = loadState().preexistingUntracked;
  if (stream !== undefined) ({ cwd, ignore } = streamTaskContext(stream, pr, t));
  else refuseSerialInParallelWave(pr, t);
  // Discard whatever the attempt left behind; the lock is gitignored so
  // clean leaves it alone, and -e spares every path that was already
  // untracked before this run started (F-09) — `git clean` would otherwise
  // delete it outright, which is worse than merely being tempted to move it.
  // For a stream this happens in the stream's worktree only: the main
  // checkout holds every other stream's uncommitted bookkeeping.
  // The clean-room log is tracked and the hooks append to it all the time; a hard reset would throw those entries away.
  const stBlock = loadState();
  const crPaths = cleanroomPaths(stBlock);
  const logBytes = crPaths.length && exists(crPaths[0]) ? fs.readFileSync(crPaths[0]) : null;
  git(["reset", "-q", "--hard", "HEAD"], { cwd });
  if (logBytes !== null && cwd === ROOT) fs.writeFileSync(crPaths[0], logBytes);
  git(["clean", "-qfd", ...(ignore || []).flatMap((p) => ["-e", gitCleanExcludePattern(p)])], { cwd });
  pr = parseProgress();
  const psha = withRollback([P.progress, ...crPaths], () => {
    setTaskState(pr, id, "!");
    appendLog(pr, id, "blocked", `BLOCKED: ${reason}`);
    writeProgress(pr);
    checkpoint("kukulu_task_block", implementStage(stBlock), stBlock);
    return gitCommitIfChanged([P.progress, ...crPaths], `progress: ${id} blocked`, { stage: implementStage(stBlock), task: id });
  });
  resetLockCounter();
  return { id, progressCommit: psha, counts: counts(pr.tasks), ...(stream !== undefined ? { stream } : {}) };
}

/**
 * Set every id in `ids` back to todo, logging `body` under `stamp`, then
 * reopen every skipped task that depends — directly, or through another task
 * reopened here — on one of them. A reopened dependent that still has a
 * different blocked dependency is simply skipped again by the next
 * kukulu_task_next, so reopening generously is safe; leaving dependents
 * skipped is not (F-05, F-18, F-19 of the 2026-09-30 cleanflate feedback: one
 * cleared blocker left 17 tasks skipped with no sanctioned way back).
 * Mutates `pr`; returns the dependents reopened, in PROGRESS.md order.
 */
function reopenWithDependents(pr, ids, stamp, body) {
  for (const id of ids) {
    setTaskState(pr, id, " ");
    appendLog(pr, id, stamp, body);
  }
  const planLines = exists(P.plan) ? read(P.plan).split("\n") : [];
  const reopened = new Set(ids);
  const dependents = [];
  for (let changed = true; changed; ) {
    changed = false;
    for (const t of pr.tasks) {
      if (t.state !== "-") continue;
      let depends;
      try {
        depends = planTaskFrom(planLines, t.id).depends;
      } catch {
        continue;
      }
      const via = depends.find((d) => reopened.has(d));
      if (!via) continue;
      setTaskState(pr, t.id, " ");
      appendLog(pr, t.id, stamp, `reopened: it was skipped because of ${via}, which is open again`);
      reopened.add(t.id);
      dependents.push(t.id);
      changed = true;
    }
  }
  return dependents;
}

/**
 * Reopen one blocked or skipped task once whatever stopped it is resolved
 * (an operator supplied a missing file, a flaky service came back), together
 * with every task skipped because of it. The next kukulu_task_next picks it
 * up; after a finished run, kukulu_next hands out an implement stage again.
 */
function taskReopen({ id, reason } = {}) {
  if (!id || !reason) throw new ToolError("id and reason are required");
  refuseWhileStreamsPending();
  const st = loadState();
  if (st.summarized) throw new ToolError("the flight is complete (summarized); reopening a task now would reopen an approved build — start a new flight instead");
  const pr = parseProgress();
  const t = pr.tasks.find((x) => x.id === id);
  if (!t) throw new ToolError(`task ${id} not in docs/PROGRESS.md`);
  if (t.state !== "!" && t.state !== "-") throw new ToolError(`task ${id} is '${STATE_NAMES[t.state]}'; only a blocked or skipped task can be reopened`);
  refuseProgressText("reason", `REOPENED: ${reason}`, "kukulu_task_reopen");
  let dependents;
  const commit = withRollback([P.progress], () => {
    dependents = reopenWithDependents(pr, [id], "reopened", `REOPENED: ${reason}`);
    writeProgress(pr);
    return gitCommitIfChanged([P.progress], `progress: reopen ${id}${dependents.length ? ` (+${dependents.length} dependent${dependents.length === 1 ? "" : "s"})` : ""}`, { stage: implementStage(st), task: id });
  });
  resetLockCounter();
  return { id, reopenedDependents: dependents, commit, counts: counts(pr.tasks) };
}

// Every command Kūkulu runs for the model goes through mcp/run-command.mjs,
// which runs it in its own process group so a timeout kills the whole tree,
// and keeps only a bounded tail of its output (F-04, F-09, F-16 of the
// 2026-09-30 cleanflate feedback: a runaway mutant hung the reviewer, left
// orphaned test binaries spinning, and took the server down).
const RUNNER = path.join(path.dirname(fileURLToPath(import.meta.url)), "run-command.mjs");
// A command that writes more than this in total is killed, not buffered.
const OUTPUT_LIMIT_BYTES = 64 * 1024 * 1024;
// What a result carries of each stream: the last 60 lines, and never more
// than this many characters of them, so one long line cannot overflow the
// tool result either.
const TAIL_LINES = 60;
const TAIL_CHARS = 4000;
// How long the server waits beyond a command's own timeout before it gives
// up on the runner itself (which should never need it).
const RUNNER_BACKSTOP_MS = 30_000;

function runShell(cmd, timeoutMs, cwd = ROOT) {
  const spec = { cmd, cwd, timeoutMs, maxOutputBytes: OUTPUT_LIMIT_BYTES, keepBytes: TAIL_CHARS * 8 };
  const r = spawnSync(process.execPath, [RUNNER, JSON.stringify(spec)], {
    encoding: "utf8",
    timeout: timeoutMs + RUNNER_BACKSTOP_MS,
    maxBuffer: 4 * 1024 * 1024,
  });
  let res;
  try {
    res = JSON.parse((r.stdout || "").trim().split("\n").pop());
  } catch {
    res = {
      exitCode: null,
      signal: null,
      timedOut: r.error?.code === "ETIMEDOUT",
      outputLimitExceeded: false,
      orphansKilled: false,
      stdout: "",
      stderr: `Kūkulu could not supervise this command: ${(r.error?.message || r.stderr || "the runner produced no result").trim()}`,
    };
  }
  let truncated = false;
  const tail = (s) => {
    const lines = (s || "").replace(/\s+$/, "").split("\n");
    let t = lines.slice(-TAIL_LINES).join("\n");
    if (lines.length > TAIL_LINES) truncated = true;
    if (t.length > TAIL_CHARS) {
      t = t.slice(-TAIL_CHARS);
      truncated = true;
    }
    return t;
  };
  const stdoutTail = tail(res.stdout);
  const stderrTail = tail(res.stderr);
  if (res.outputLimitExceeded) truncated = true;
  return {
    command: cmd,
    ok: res.exitCode === 0 && !res.timedOut && !res.outputLimitExceeded,
    exitCode: res.exitCode,
    timedOut: res.timedOut,
    timeoutMs,
    ...(res.outputLimitExceeded ? { outputLimitExceeded: true } : {}),
    ...(res.orphansKilled ? { orphansKilled: true } : {}),
    ...(truncated ? { truncated: true } : {}),
    stdoutTail,
    stderrTail,
  };
}

/** Does `file` (a repo-relative path) fall under path or exclude prefix `p`? */
const pathUnder = (file, p) => file === p || file.startsWith(p.endsWith("/") ? p : `${p}/`);

/**
 * Run every constraint rule: first self-test it against its own fixtures —
 * a `shouldMatch` line that fails to match, or a `shouldNotMatch` line that
 * matches, fails the rule outright and is never trusted to scan anything
 * (F-14) — then scan every file under its `paths` minus `exclude` that is
 * tracked or untracked-but-not-ignored (`git ls-files --cached --others
 * --exclude-standard`), line by line, except the untracked files in
 * `ignore` — those that were already there when the run started, which are
 * not the run's business (F-09). A new file an implementer has not yet
 * committed is scanned, so a regression cannot slip past a verify run made
 * before its commit (F-26 of the 2026-09-30 cleanflate feedback). Ignored
 * files never are. Line-based only; no multi-line patterns.
 */
const constraintTests = (c, line) => new RegExp(c.pattern, c.flags || "").test(line);

/** Why a rule's own fixtures do not hold (`shouldMatch` line unmatched, `shouldNotMatch` line matched), or null. A rule with a failing fixture is never trusted to scan anything (F-14). */
function constraintFixtureFailure(c) {
  for (const line of c.shouldMatch) {
    if (!constraintTests(c, line)) return `shouldMatch ${JSON.stringify(line)} did not match`;
  }
  for (const line of c.shouldNotMatch) {
    if (constraintTests(c, line)) return `shouldNotMatch ${JSON.stringify(line)} matched`;
  }
  return null;
}

/**
 * Refuse text that is about to be written into docs/PROGRESS.md (or, for a halt,
 * stands for it) when it would break an active constraint that covers that file,
 * before anything is written (SPEC B-02). A rule with failing fixtures or one
 * that is still waiting on its `from` task is not enforced here, as in checkConstraints.
 */
function refuseProgressText(field, text, tool) {
  const progressRel = path.relative(ROOT, P.progress).split(path.sep).join("/");
  const covers = (list) => (list || []).some((p) => p === "." || p === "./" || pathUnder(progressRel, p.replace(/^\.\//, "")));
  const progress = exists(P.progress) ? parseProgress() : null;
  const lines = String(text).replace(/\s+$/, "").split("\n");
  for (const c of cfg().constraints) {
    if (!covers(c.paths) || covers(c.exclude)) continue;
    if (constraintFixtureFailure(c) || inactiveUntil(c.from, progress)) continue;
    for (const line of lines) {
      const m = new RegExp(c.pattern, c.flags || "").exec(line);
      if (!m) continue;
      const start = Math.max(0, m.index - 40);
      throw new ToolError(
        `${field} would break constraint ${c.id} (${c.description || "no description"}) in ${progressRel} at "${line.slice(start, start + 80)}"; rewrite it without that text and call ${tool} again`,
      );
    }
  }
}

function checkConstraints(constraints, cwd = ROOT, ignore = []) {
  const skip = new Set(ignore);
  const progress = exists(P.progress) ? parseProgress() : null;
  const testLine = constraintTests;
  const results = constraints.map((c) => {
    const failure = constraintFixtureFailure(c);
    if (failure) return { id: c.id, ok: false, fixture: failure, hits: [] };
    const waiting = inactiveUntil(c.from, progress);
    if (waiting) return { id: c.id, ok: true, inactive: `until ${waiting}`, fixture: null, hits: [] };
    const listed = git(["ls-files", "--cached", "--others", "--exclude-standard", "--", ...c.paths], { allowFail: true, cwd });
    const files = listed.ok ? [...new Set(listed.out.split("\n").filter(Boolean))].filter((f) => !skip.has(f)) : [];
    const excluded = c.exclude || [];
    const hits = [];
    for (const file of files) {
      if (excluded.some((ex) => pathUnder(file, ex))) continue;
      const full = path.join(cwd, file);
      if (!exists(full)) continue; // e.g. a submodule gitlink git ls-files can list but fs cannot read
      read(full)
        .split("\n")
        .forEach((text, i) => {
          if (testLine(c, text)) hits.push({ file, line: i + 1, text });
        });
    }
    return { id: c.id, ok: hits.length === 0, fixture: null, hits };
  });
  return { ok: results.every((r) => r.ok), results };
}

/**
 * The commands `kukulu_verify` would run for `touched`: every `verify`
 * command, plus each `extraVerify` prefix that any touched file starts
 * with, skipping duplicates by command text. Shared with `kukulu_mutate`,
 * so a mutation runs exactly the suites the file's own change would.
 */
function verifyCommands(cc, touched) {
  const cmds = [...cc.verify];
  for (const [prefix, extra] of Object.entries(cc.extraVerify)) {
    if (touched.some((f) => f.startsWith(prefix))) for (const x of extra) if (!cmds.some((c2) => c2.cmd === x.cmd)) cmds.push(x);
  }
  return cmds;
}

function verify({ files = [], stream } = {}) {
  const recovered = recoverMutation();
  const c = loadConfig();
  if (!c) throw new ToolError("docs/kukulu.json is missing; the plan stage must write it");
  const cc = cfg();
  if (!cc.verify.length) throw new ToolError("docs/kukulu.json has no 'verify' commands");
  let cwd = ROOT;
  let ignore = loadState().preexistingUntracked || [];
  if (stream !== undefined) {
    const scope = streamScope(stream);
    ignore = (scope.st.streams || {})[stream]?.preexistingUntracked || [];
    cwd = streamDir(stream);
    if (!exists(cwd)) throw new ToolError(`stream '${stream}' has no worktree; call kukulu_run_start({ stream: "${stream}" }) first`);
  }
  const touched = Array.isArray(files) ? files : String(files).split(/[\s,]+/).filter(Boolean);
  const cmds = verifyCommands(cc, touched);
  if (stream !== undefined) {
    // An exclusive command is keyed to the directory or port it runs from and
    // only ever runs from the main checkout. Validation keeps its tasks out of
    // waves, so reaching this is a bug to surface, not to paper over.
    const exclusive = cmds.find((x) => x.exclusive);
    if (exclusive) {
      throw new ToolError(`${JSON.stringify(exclusive.cmd)} is exclusive: it only runs from the main checkout, never a stream worktree. A task that triggers it should not have been in a wave; report this as pipeline friction and call kukulu_verify without stream from the main checkout.`);
    }
  }
  // Constraints are whole-repo, always — `files` narrows which shell
  // commands' extras run, never what a constraint scans.
  const constraints = checkConstraints(cc.constraints, cwd, ignore);
  const progress = exists(P.progress) ? parseProgress() : null;
  const results = cmds.map((c2) => {
    const waiting = inactiveUntil(c2.from, progress);
    return waiting ? { cmd: c2.cmd, skipped: `inactive until ${waiting}` } : runShell(c2.cmd, c2.timeoutMs, cwd);
  });
  return { ok: constraints.ok && results.every((r) => r.skipped || r.ok), constraints, results, ...(recovered ? { recoveredMutation: recovered } : {}) };
}

// ---------------------------------------------------------------- mutation testing
//
// The reviewer's "delete or invert the mechanic and confirm the test fails"
// check used to be a hand edit of the working tree followed by `git checkout`.
// Auto mode refuses that edit (a reviewer told not to fix code, editing
// source), and a scratch copy cannot run suites bound to the repo root
// (wp-env). So the MCP does it: one exact find/replace on one clean tracked
// file, the file's own verify commands, and an unconditional restore.

/** A repo-relative POSIX path for `file` if it is a regular, non-symlink file inside the project; throws otherwise. */
function projectFile(file) {
  const abs = path.resolve(ROOT, file);
  const relPath = path.relative(ROOT, abs);
  if (!relPath || relPath.startsWith("..") || path.isAbsolute(relPath)) throw new ToolError(`'${file}' is outside the project; pass a path inside ${ROOT}`);
  if (!exists(abs)) throw new ToolError(`'${file}' does not exist`);
  const lst = fs.lstatSync(abs);
  if (lst.isSymbolicLink() || !lst.isFile()) throw new ToolError(`'${file}' is not a regular file; kukulu_mutate only edits plain tracked files`);
  return { abs, rel: relPath.split(path.sep).join("/") };
}

/** `policies.feedback`, without letting a malformed config keep a recovery from running. */
function feedbackEnabled() {
  try {
    return cfg().policies.feedback;
  } catch {
    return true;
  }
}

/**
 * If a previous kukulu_mutate never reached its restore (the server was
 * killed mid-run), put the file back from HEAD and clear the sentinel.
 * Returns the restored repo-relative path, or `null` when there was nothing
 * to recover. Loud on purpose: something crashed.
 */
function recoverMutation() {
  if (!exists(P.mutation)) return null;
  let m;
  try {
    m = JSON.parse(read(P.mutation));
  } catch {
    m = null;
  }
  if (!m || typeof m.file !== "string") {
    throw new ToolError(`${rel(P.mutation)} exists but is unreadable, so Kūkulu cannot tell which file a crashed mutation left edited. Run \`git status\`, restore the file with \`git checkout HEAD -- <file>\`, then delete ${rel(P.mutation)}.`);
  }
  const { rel: relPath } = projectFile(m.file);
  git(["checkout", "-q", "HEAD", "--", relPath]);
  fs.rmSync(P.mutation, { force: true });
  // Commit the entry on its own, like kukulu_feedback_log: recovery can run
  // inside kukulu_verify mid-task, where an uncommitted feedback line would
  // make the implementer's next kukulu_task_done refuse on a dirty tree.
  if (feedbackEnabled()) {
    appendFeedback("review", `Restored ${relPath}, left mutated by a kukulu_mutate call that never finished.`, "mutation-recovered", "auto");
    gitCommitIfChanged([P.feedback], "chore: pipeline friction (review)", { stage: "review" });
  }
  return relPath;
}

/** Tracked paths that differ from HEAD (modified, deleted or staged), sorted. */
const trackedChanges = () => git(["diff", "--name-only", "HEAD"]).out.split("\n").filter(Boolean).sort();

/**
 * Put back everything a mutation's commands changed besides the mutated file
 * itself (F-10, F-14, F-17 of the 2026-09-30 cleanflate feedback: a killed
 * mutant made proptest write a regressions file). Only paths that were clean,
 * or did not exist, before the mutation are touched; ignored files never are.
 * Returns `{ restored, removed }`.
 */
function undoMutationResidue(before) {
  const dirtyBefore = new Set(before.tracked);
  const untrackedBefore = new Set(before.untracked);
  const restored = trackedChanges().filter((p) => !dirtyBefore.has(p));
  if (restored.length) git(["checkout", "-q", "HEAD", "--", ...restored]);
  const removed = untrackedPaths().filter((p) => !untrackedBefore.has(p));
  for (const p of removed) fs.rmSync(path.join(ROOT, p), { force: true });
  return { restored, removed };
}

function mutate({ file, find, replace, commands, timeoutMs, targeted, filter, confirmKill } = {}) {
  if (typeof file !== "string" || !file) throw new ToolError("file is required: a repo-relative path to a tracked source file");
  if (typeof find !== "string" || !find) throw new ToolError("find is required and must be a non-empty string: the exact text to replace");
  if (typeof replace !== "string") throw new ToolError('replace is required and must be a string (use "" to delete the matched text)');
  if (find === replace) throw new ToolError("find and replace are identical; that is not a mutation");
  if (commands !== undefined && (!Array.isArray(commands) || !commands.length || !commands.every((x) => typeof x === "string"))) {
    throw new ToolError("commands must be a non-empty array of command strings taken from docs/kukulu.json's verify/extraVerify");
  }
  if (timeoutMs !== undefined && (!Number.isInteger(timeoutMs) || timeoutMs <= 0)) {
    throw new ToolError("timeoutMs must be a positive integer (milliseconds)");
  }
  if (!gitFacts().inRepo) throw new ToolError("not a git repository");
  if (!loadConfig()) throw new ToolError("docs/kukulu.json is missing; the plan stage must write it");
  const cc = cfg();
  if (confirmKill !== undefined && typeof confirmKill !== "boolean") throw new ToolError("confirmKill must be a boolean");
  if ((targeted === undefined) !== (filter === undefined)) throw new ToolError("targeted and filter must be passed together");
  if (targeted !== undefined) {
    if (commands !== undefined) throw new ToolError("targeted cannot be combined with commands; pass one or the other");
    const names = Object.keys(cc.mutation.targeted);
    const legal = names.length ? `Configured names: ${names.join(", ")}.` : "No targeted commands are configured; add them under `mutation.targeted` in docs/kukulu.json.";
    if (typeof targeted !== "string" || !Object.hasOwn(cc.mutation.targeted, targeted)) throw new ToolError(`unknown targeted command ${JSON.stringify(targeted)}. ${legal}`);
    if (typeof filter !== "string" || !MUTATION_FILTER.test(filter)) {
      throw new ToolError(`filter must be 1 to 200 characters from letters, digits and _ . : / - (no spaces, quotes or shell characters); got ${JSON.stringify(filter)}`);
    }
  }
  const recovered = recoverMutation();
  if (exists(P.lock)) {
    throw new ToolError("an implementation run is in progress (.kukulu/implement.lock exists); kukulu_mutate is a review-stage tool — run it after kukulu_run_finish");
  }
  if (!cc.verify.length) throw new ToolError("docs/kukulu.json has no 'verify' commands");

  const { abs, rel: relPath } = projectFile(file);
  if (!git(["ls-files", "--error-unmatch", "--", relPath], { allowFail: true }).ok) {
    throw new ToolError(`'${relPath}' is not tracked by git; kukulu_mutate only mutates committed files it can restore`);
  }
  if (!git(["diff", "--quiet", "HEAD", "--", relPath], { allowFail: true }).ok) {
    throw new ToolError(`'${relPath}' has uncommitted changes; commit or discard them first so kukulu_mutate can restore the file exactly`);
  }
  const original = read(abs);
  if (original.includes("\0")) throw new ToolError(`'${relPath}' looks binary; kukulu_mutate edits text files only`);
  const first = original.indexOf(find);
  const occurrences = first < 0 ? 0 : original.split(find).length - 1;
  if (occurrences !== 1) {
    throw new ToolError(
      occurrences === 0
        ? `find text does not appear in ${relPath}; copy it exactly, including whitespace`
        : `find text appears ${occurrences} times in ${relPath}; include more surrounding context in find so it matches exactly once`,
    );
  }

  let cmds;
  if (targeted !== undefined) {
    const t = cc.mutation.targeted[targeted];
    cmds = [{ cmd: t.cmd.replace("{filter}", () => `'${filter}'`), timeoutMs: t.timeoutMs, exclusive: false, from: null }];
  } else if (commands) {
    const legal = new Map([...cc.verify, ...Object.values(cc.extraVerify).flat()].map((x) => [x.cmd, x]));
    const unknown = commands.filter((x) => !legal.has(x));
    if (unknown.length) {
      throw new ToolError(`commands must each equal a configured verify/extraVerify command; unknown: ${unknown.map((u) => JSON.stringify(u)).join(", ")}. Legal: ${[...legal.keys()].map((k) => JSON.stringify(k)).join(", ")}`);
    }
    cmds = commands.map((x) => legal.get(x));
  } else {
    cmds = verifyCommands(cc, [relPath]);
  }
  // A per-call timeout only ever shortens a command's configured one: a
  // reviewer who suspects a mutant hangs should not wait out a 30-minute
  // suite timeout to find out (F-06).
  if (timeoutMs !== undefined) cmds = cmds.map((c2) => ({ ...c2, timeoutMs: Math.min(c2.timeoutMs, timeoutMs) }));
  const before = { tracked: trackedChanges(), untracked: untrackedPaths() };

  // The sentinel is per-clone state, not part of the reviewed branch: exclude
  // it through .git/info/exclude rather than .gitignore, which would dirty
  // the very tree under review.
  ensureLineInFile(gitPath("info/exclude"), rel(P.mutation));
  write(P.mutation, `${JSON.stringify({ file: relPath, at: new Date().toISOString(), original: git(["rev-parse", `HEAD:${relPath}`]).out })}\n`);
  let results;
  let scan;
  try {
    fs.writeFileSync(abs, original.slice(0, first) + replace + original.slice(first + find.length));
    // A rule a mutant breaks is a kill too: the mechanic is guarded by a constraint rather than a test.
    scan = checkConstraints(cc.constraints, ROOT, loadState().preexistingUntracked);
    const progress = exists(P.progress) ? parseProgress() : null;
    results = cmds.map((c2) => {
      const waiting = inactiveUntil(c2.from, progress);
      return waiting ? { cmd: c2.cmd, skipped: `inactive until ${waiting}` } : runShell(c2.cmd, c2.timeoutMs);
    });
  } finally {
    // Restore unconditionally. If git cannot, write the bytes back ourselves.
    if (!git(["checkout", "-q", "HEAD", "--", relPath], { allowFail: true }).ok) fs.writeFileSync(abs, original);
  }
  if (!git(["diff", "--quiet", "HEAD", "--", relPath], { allowFail: true }).ok) {
    if (cc.policies.feedback) appendFeedback("review", `kukulu_mutate could not restore ${relPath} after mutating it.`, "mutation-restore", "auto");
    throw new ToolError(`kukulu_mutate could NOT restore ${relPath}: it still differs from HEAD. Run \`git checkout HEAD -- ${relPath}\` before doing anything else. The sentinel ${rel(P.mutation)} is left in place.`);
  }
  fs.rmSync(P.mutation, { force: true });
  const residue = undoMutationResidue(before);

  const failedIdx = results.map((r, i) => (!r.skipped && !r.ok ? i : -1)).filter((i) => i >= 0);
  const failedCommands = failedIdx.map((i) => cmds[i].cmd);
  const caughtBy = scan.results.find((r) => r.hits.length > 0);
  const constraintKill = Boolean(caughtBy);
  let killed = failedIdx.length > 0 || constraintKill;
  let verdict = failedIdx.length > 0
    ? "killed: the tests caught the mutation"
    : constraintKill
      ? `killed: constraint ${caughtBy.id} caught the mutation`
      : "survived: no command failed — the mechanic is untested";
  let confirm;
  let inconclusive;
  if (killed && confirmKill && failedIdx.length) {
    // A command that fails on the unmutated tree proves nothing about the
    // mutation, so each failure is re-run once where nothing is mutated.
    confirm = failedIdx.map((i) => runShell(cmds[i].cmd, cmds[i].timeoutMs));
    undoMutationResidue(before);
    const stillFailing = confirm.findIndex((r) => !r.ok);
    // A kill by a constraint alone stands without the commands.
    if (stillFailing >= 0 && !constraintKill) {
      killed = false;
      inconclusive = true;
      verdict = `inconclusive: ${failedCommands[stillFailing]} also fails without the mutation`;
    }
  }
  return {
    file: relPath,
    killed,
    ...(inconclusive ? { inconclusive } : {}),
    verdict,
    failedCommands,
    ...(confirm ? { confirm } : {}),
    results,
    constraints: scan,
    restored: residue.restored,
    removed: residue.removed,
    recoveredMutation: recovered,
  };
}

/**
 * Push `branch` to `origin`, honouring the run's push policy. Never throws:
 * `"pushed"`, `"skipped: policy"`, `"skipped: no origin remote"`, or
 * `"failed: <git's first line>"` — every caller (F-18) treats a push the
 * same way a `kukulu_run_finish` failure always has, as informational,
 * never fatal to the bookkeeping commit it followed.
 */
function pushBranch(branch, pushAllowed) {
  if (!pushAllowed) return "skipped: policy";
  if (!gitFacts().hasOrigin) return "skipped: no origin remote";
  const p = git(["push", "-u", "origin", branch], { allowFail: true });
  if (p.ok) return "pushed";
  return `failed: ${(p.err || p.out || "unknown error").split("\n")[0]}`;
}

function runFinish() {
  const pending = streamWorktrees();
  if (pending.length) {
    throw new ToolError(`stream worktree(s) still exist (${pending.join(", ")}); merge each back with kukulu_stream_finish before finishing the run`);
  }
  const pr = parseProgress();
  const cnt = counts(pr.tasks);
  if (cnt.open > 0) throw new ToolError(`${cnt.open} task(s) still open; keep calling kukulu_task_next`);
  if (!exists(P.handoff)) throw new ToolError("docs/HANDOFF.md does not exist; write it before calling kukulu_run_finish");
  const st = loadState();
  const c = cfg();
  const g = gitFacts();
  const handoffCommit = withRollback([P.handoff], () => gitCommitIfChanged([P.handoff], "chore: handoff for review", { stage: implementStage(st) }));
  const dirtyLines = porcelainExcludingPreexisting(st.preexistingUntracked);
  if (dirtyLines.length) {
    throw new ToolError(`working tree is not clean:\n${dirtyLines.join("\n")}\nCommit them as part of the handoff or \`git checkout --\`/\`git clean\` them.`);
  }

  st.implemented = true; st.reviewed = false; st.verdict = null;
  const crPaths = cleanroomPaths(st);
  const stateCommit = withRollback([P.state, ...crPaths], () => {
    saveState(st);
    checkpoint("kukulu_run_finish", implementStage(st), st);
    return gitCommitIfChanged([P.state, ...crPaths], `chore: round ${st.round} implemented`, { stage: implementStage(st) });
  });

  const push = pushBranch(g.branch, st.policies.push);
  let pr_url = null;
  if (push === "pushed") {
    if (st.policies.pr === "none") {
      pr_url = "skipped: policy";
    } else if (spawnSync("gh", ["--version"], { encoding: "utf8" }).status === 0) {
      const existing = spawnSync("gh", ["pr", "view", "--json", "url", "-q", ".url"], { cwd: ROOT, encoding: "utf8" });
      if (existing.status === 0 && existing.stdout.trim()) pr_url = existing.stdout.trim();
      else {
        const title = st.round === 0 ? `Build: ${g.branch}` : `Build: ${g.branch} (review round ${st.round})`;
        // --base, always: without it gh targets the repository's default
        // branch, not the one this flight branched from (F-24 of the
        // 2026-09-30 cleanflate feedback).
        const cr = spawnSync("gh", ["pr", "create", "--draft", "--base", c.baseBranch, "--title", title, "--body-file", P.handoff], { cwd: ROOT, encoding: "utf8" });
        pr_url = cr.status === 0 ? cr.stdout.trim() : `pr create failed: ${(cr.stderr || "").trim()}`;
      }
    }
  }
  if (exists(P.lock)) fs.unlinkSync(P.lock);
  const head = git(["rev-parse", "--short", "HEAD"]).out;
  // A whole-tree constraint scan at handoff, reported rather than refused:
  // the reviewer sees a regression the task-by-task verify runs missed
  // (F-26), and a flight is never stalled on it here.
  const scan = checkConstraints(c.constraints, ROOT, st.preexistingUntracked);
  const failing = scan.results.filter((r) => !r.ok).map((r) => r.id);
  return {
    branch: g.branch, base: g.base, head, handoffCommit, stateCommit, push, pr: pr_url, counts: cnt, round: st.round,
    constraints: { ok: scan.ok, failing },
    readyLine: `READY FOR REVIEW — branch ${g.branch}, head ${head}, ${cnt.done} done / ${cnt.blocked} blocked / ${cnt.skipped} skipped of ${cnt.total}${failing.length ? `; constraints failing: ${failing.join(", ")}` : ""}`,
  };
}

const FLIGHT_OPTION_KEYS = ["maxRounds", "maxRoundsHard"];

/**
 * Apply the options an operator passed to /kukulu:go-flight ("maximum
 * review depth of 6 rounds") to docs/kukulu.json and commit them, so the
 * controller never hand-edits a config file (F-20 of the 2026-09-30
 * cleanflate feedback). Only the review-loop bounds are settable; anything
 * else is the planner's to decide from SPEC. Refused before the plan stage
 * has written docs/kukulu.json.
 */
// ---------------------------------------------------------------- contamination scoring (SPEC E-03)

const SIMILARITY_SKIP_DIRS = new Set([".git", "node_modules"]);
const sha256Hex = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fixed = (x) => (x === null || x === undefined ? "n/a" : x.toFixed(4));

/** A configured pair side as absolute directories: `subject` is the subject list, `~` the home directory, a relative path the project. */
function similarityDirs(side, sim) {
  const list = side === "subject" ? sim.subject : [side];
  return list.map((p) => (p === "~" || p.startsWith("~/") ? path.join(os.homedir(), p.slice(1)) : path.resolve(ROOT, p)));
}

/** Every regular file under `dir`, sorted, skipping .git and node_modules. */
function walkFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SIMILARITY_SKIP_DIRS.has(entry.name)) out.push(...walkFiles(full));
    } else if (entry.isFile()) out.push(full);
  }
  return out;
}

/**
 * Score the configured pairs (SPEC E-03). Runs only inside the server: no agent
 * tool ever reads the comparison corpus, the agents get numbers back, and every
 * byte the scorer read is hashed into the chain (E-03a). Refused while an
 * implementer run is armed, so no implement-stage call can trigger a read.
 */
function similarity() {
  const cc = cfg();
  const sim = cc.cleanroom.similarity;
  if (!sim) throw new ToolError("cleanroom.similarity is not set in docs/kukulu.json; configure the subject, the controls and the test pairs before scoring (see operations.md)");
  if (exists(P.lock)) throw new ToolError(`an implementation run is armed (${rel(P.lock)} exists); kukulu_similarity is a summarize-stage tool, so run it after kukulu_run_finish`);
  const st = loadState();
  if (st.verdict !== "APPROVED") throw new ToolError("the flight is not reviewed APPROVED yet; score contamination after the review approves the build");

  // Resolve and read every side once.
  const sides = new Map();
  const unmapped = new Set(); // distinct files skipped (a side can be named twice, as itself and as the subject)
  const readPaths = new Set(); // distinct files read
  const readSide = (name) => {
    if (sides.has(name)) return sides.get(name);
    const dirs = similarityDirs(name, sim);
    const files = [];
    for (const dir of dirs) {
      if (!exists(dir) || !fs.statSync(dir).isDirectory()) throw new ToolError(`the directory ${dir} (${name === "subject" ? "cleanroom.similarity.subject" : name}) does not exist or is not a directory`);
      const all = walkFiles(dir);
      if (!all.length) throw new ToolError(`the directory ${dir} is empty; a pair needs files to compare`);
      for (const file of all) {
        const language = sim.languages[path.extname(file)];
        const bytes = fs.readFileSync(file);
        if (!language || bytes.includes(0)) {
          unmapped.add(file);
          continue;
        }
        readPaths.add(file);
        files.push({ path: file, text: bytes.toString("utf8"), language, sha256: sha256Hex(bytes), bytes: bytes.length });
      }
    }
    if (!files.length) throw new ToolError(`no file under ${dirs.join(", ")} has an extension in cleanroom.similarity.languages; map the extensions of the code you want compared`);
    const side = { files };
    sides.set(name, side);
    return side;
  };
  for (const p of sim.pairs) {
    readSide(p.left);
    readSide(p.right);
  }
  let exclusions = new Set();
  if (sim.identExclusions) {
    const file = path.resolve(ROOT, sim.identExclusions);
    if (!exists(file)) throw new ToolError(`cleanroom.similarity.identExclusions names ${sim.identExclusions}, which does not exist; create it (one identifier per line) or remove the key`);
    exclusions = new Set(read(file).split("\n").map((l) => l.trim()).filter(Boolean));
  }
  const crPaths = cleanroomPaths(st);
  if (crPaths.length) requireGate("summarize");

  // Score every pair, then position each test pair against the controls, metric by metric.
  const opts = { ngram: sim.ngram, minIdentLen: sim.minIdentLen, commentNgram: sim.commentNgram, exclusions };
  const scores = new Map(sim.pairs.map((p) => [p.id, scorePair(readSide(p.left).files, readSide(p.right).files, opts)]));
  const negative = sim.pairs.find((p) => p.role === "negative");
  const positive = sim.pairs.find((p) => p.role === "positive");
  const metrics = Object.keys(scores.get(negative.id));
  const rows = [];
  for (const p of sim.pairs) {
    for (const metric of metrics) {
      const score = scores.get(p.id)[metric];
      const where = p.role === "test" ? position(score, scores.get(negative.id)[metric], scores.get(positive.id)[metric], sim) : { c: null, band: null };
      rows.push({ pair: p.id, role: p.role, metric, score, c: where.c, band: where.band });
    }
  }
  const verdict = verdictOf(rows.filter((r) => r.role === "test"));

  const files = [];
  const seen = new Set();
  for (const p of sim.pairs) {
    for (const which of ["left", "right"]) {
      for (const f of readSide(p[which]).files) {
        const key = `${p.id}\0${which}\0${f.path}`;
        if (seen.has(key)) continue;
        seen.add(key);
        files.push({ pair: p.id, side: which, path: f.path, sha256: f.sha256, bytes: f.bytes, language: f.language });
      }
    }
  }
  const skipped = unmapped.size;
  const json = `${JSON.stringify({ config: sim, files, rows, verdict, limits: LIMITS, at: new Date().toISOString() }, null, 2)}\n`;
  const jsonPath = path.join(P.stateDir, "cleanroom", "similarity.json");

  // docs/SIMILARITY.md carries no timestamp, so the same inputs give the same bytes.
  const testPairs = sim.pairs.filter((p) => p.role === "test");
  const doc = [
    "# Contamination score",
    "",
    `The subject (${sim.subject.length ? sim.subject.join(", ") : "none"}) was compared with ${testPairs.length} test pair${testPairs.length === 1 ? "" : "s"} (${testPairs.map((p) => p.id).join(", ")}) and placed between a negative control (${negative.id}) and a positive control (${positive.id}). A test pair at or below the negative control on a metric that separates the controls shows no similarity beyond independent work.`,
    "",
    "## Positioning",
    "",
    ...rows.filter((r) => r.role === "test").map((r) => `- ${r.pair}, ${r.metric}: ${fixed(r.score)} (c = ${fixed(r.c)}, ${r.band})`),
    "",
    "## Verdict",
    "",
    verdict,
    "",
    "## Raw scores",
    "",
    `| pair | role | ${metrics.join(" | ")} |`,
    `|---|---|${metrics.map(() => "---:").join("|")}|`,
    ...sim.pairs.map((p) => `| ${p.id} | ${p.role} | ${metrics.map((m) => fixed(scores.get(p.id)[m])).join(" | ")} |`),
    "",
    "## Limits",
    "",
    ...LIMITS.map((l) => `- ${l}`),
    "",
  ].join("\n");

  const paths = [P.similarityDoc, jsonPath, ...crPaths];
  const commit = withRollback(paths, () => {
    write(jsonPath, json);
    write(P.similarityDoc, doc);
    if (crPaths.length) {
      appendEntry(cleanroomLogPath(), { kind: "score", stage: "summarize", role: "session", data: { reads: readPaths.size, sha256: sha256Hex(Buffer.from(json, "utf8")) } });
      checkpoint("kukulu_similarity", "summarize", st);
    }
    return gitCommitIfChanged(paths, "chore: similarity scored", { stage: "summarize" });
  });
  return { verdict, rows, files: readPaths.size, skipped, limits: LIMITS, commit };
}

const RECORD_KINDS = ["instruction", "intervention", "verdict"];
const VERDICT_TEXT = /^#(\d+): (prior-art attempt|false positive|offline test) — .+/;

/**
 * Put something the operator did or decided into the chain (SPEC D-09): an
 * instruction, a thing done outside the pipeline, or a verdict on a denial.
 * Replaces the hand-kept intervention and denial-verdict files of earlier
 * clean-room runs.
 */
function cleanroomRecord({ text, kind = "instruction" } = {}) {
  const st = loadState();
  if (!st.cleanroom?.genesis) {
    throw new ToolError("kukulu_cleanroom_record only works in clean-room mode, after genesis: this project has no clean-room flight in progress (a policy file at cleanroom.policy and a first kukulu_next start one)");
  }
  if (typeof text !== "string" || !text.trim()) throw new ToolError("text must be a non-empty string: what the operator said, did or decided");
  if (!RECORD_KINDS.includes(kind)) throw new ToolError(`kind must be one of ${RECORD_KINDS.join(", ")} (got ${JSON.stringify(kind)})`);
  const logPath = cleanroomLogPath();
  if (kind === "verdict") {
    const m = VERDICT_TEXT.exec(text);
    if (!m) throw new ToolError('a verdict reads "#<seq>: prior-art attempt|false positive|offline test — <note>", for example "#12: false positive — grep on a sed expression"');
    const target = readEntries(logPath).find((e) => e.seq === Number(m[1]));
    if (!target || target.kind !== "denied") {
      throw new ToolError(`entry #${m[1]} is ${target ? `a ${target.kind} entry` : "not in the log"}, not a denial; a verdict classifies a denied entry's seq`);
    }
  }
  const paths = cleanroomPaths(st);
  return withRollback(paths, () => {
    const entry = appendEntry(logPath, { kind: "human", stage: "controller", role: "operator", target: text, data: { kind } });
    const commit = gitCommitIfChanged(paths, "chore: clean-room record", { stage: "controller" });
    return { recorded: true, seq: entry.seq, kind, commit };
  });
}

// ---------------------------------------------------------------- kukulu_attest (SPEC F-01)

const ATTEST_DIR = "docs/attestation";

/** The repo-relative, tracked, regular files an operator names as extra evidence. Refuses before anything is written. */
function checkEvidence(evidence) {
  if (evidence === undefined) return [];
  if (!Array.isArray(evidence) || evidence.some((p) => typeof p !== "string" || !p)) throw new ToolError("evidence must be an array of repo-relative file paths (strings)");
  const root = fs.realpathSync(ROOT);
  const out = [];
  for (const p of evidence) {
    if (path.isAbsolute(p) || p.startsWith("~") || p.split(/[\\/]/).includes("..")) {
      throw new ToolError("evidence path " + JSON.stringify(p) + " must be repo-relative, with no '~' and no '..' segment; name a file inside the repository, such as docs/conformance.txt");
    }
    const abs = path.join(ROOT, p);
    if (!exists(abs) || !fs.statSync(abs).isFile()) throw new ToolError("evidence path " + p + " does not exist or is not a file; commit the file first, or leave it out");
    const real = fs.realpathSync(abs);
    if (real !== root && !real.startsWith(root + path.sep)) throw new ToolError("evidence path " + p + " resolves outside the repository; copy the file into the repository and commit it");
    if (!git(["ls-files", "--error-unmatch", "--", p], { allowFail: true }).ok) throw new ToolError("evidence path " + p + " is not tracked by git; commit it first, so the bundle names a file the history holds");
    const norm = path.posix.normalize(p.replaceAll("\\", "/"));
    if (norm === ATTEST_DIR || norm.startsWith(ATTEST_DIR + "/")) throw new ToolError("evidence path " + p + " is inside " + ATTEST_DIR + ", which this tool rewrites; name a file outside it");
    if (!out.includes(norm)) out.push(norm);
  }
  return out;
}

/**
 * Write the signed attestation bundle for a finished clean-room flight (SPEC F-01),
 * run the verifier that ships in it, and commit it only when that passes.
 * Everything that can be refused is refused before the first write; the one
 * sanctioned write before a refusal is the gate's own entry.
 */
function attest({ evidence } = {}) {
  const cc = cfg();
  const st = loadState();
  if (!st.cleanroom?.genesis) throw new ToolError("kukulu_attest only works in clean-room mode, after genesis: this project has no clean-room flight in progress, so there is no log to attest");
  if (!st.summarized) throw new ToolError("the summary is not committed yet; call kukulu_summary_commit first, then kukulu_attest");
  const extra = checkEvidence(evidence);
  const dirty = porcelainExcludingPreexisting(st.preexistingUntracked);
  if (dirty.length) throw new ToolError("the working tree is not clean:\n" + dirty.join("\n") + "\nCommit or discard these before attesting; the bundle names the commit it was made at.");
  const docs = [["SUMMARY.md", P.summary], ["REVIEW.md", P.review], ["PROGRESS.md", P.progress], ["kukulu.json", P.config], ["state.json", P.state]];
  for (const [name, abs] of docs) {
    if (!exists(abs)) throw new ToolError(rel(abs) + " does not exist, so the bundle cannot hold " + name + "; attest before kukulu_flight_archive moves the flight's documents");
  }
  const base = git(["merge-base", cc.baseBranch, "HEAD"], { allowFail: true }).out;
  if (!base) throw new ToolError("cannot find a merge base with baseBranch '" + cc.baseBranch + "'; check out the build branch, or fix baseBranch in docs/kukulu.json");
  requireGate("summarize");

  const logPath = cleanroomLogPath();
  const logBytes = fs.readFileSync(logPath);
  const chain = verifyChain(logBytes.toString("utf8").split("\n").filter(Boolean));
  if (!chain.ok) throw new ToolError("the clean-room log does not verify (entry " + (chain.firstBad.seq ?? chain.firstBad.line) + ": " + chain.firstBad.reason + "); nothing was written");
  const entries = chain.entries;
  const genesis = entries.find((e) => e.kind === "genesis");
  if (!genesis) throw new ToolError("the clean-room log has no genesis entry; nothing was written");
  const key = loadKey(cc.cleanroom.signingKey);
  const policyPath = cleanroomPolicyPath(cc);
  const policyBytes = fs.readFileSync(policyPath);
  const selfTest = runShell("node " + shellQuote(path.join(PLUGIN_ROOT, "scripts", "cleanroom-guard.mjs")) + " --self-test " + shellQuote(policyPath), GATE_SELF_TEST_MS);
  if (!selfTest.ok) throw new ToolError("the guard self-test fails, so nothing was attested: " + (selfTest.stderrTail || selfTest.stdoutTail || "exit " + selfTest.exitCode).split("\n")[0]);
  const gl = spawnSync("git", ["log", "--format=%H%x1f%G?%x1f%s%x1f%(trailers:key=Kukulu-Stage,valueonly,separator=%x2C)%x1f%(trailers:key=Kukulu-Task,valueonly,separator=%x2C)", base + "..HEAD"], { cwd: ROOT, encoding: "utf8" });
  if (gl.status !== 0) throw new ToolError("git log " + base + "..HEAD failed: " + (gl.stderr || "").trim());
  const verifierBytes = fs.readFileSync(path.join(PLUGIN_ROOT, "scripts", "verify-attestation.mjs"));
  const hashes = pluginHashes();
  const head = git(["rev-parse", "HEAD"]).out;
  const similarityFile = path.join(P.stateDir, "cleanroom", "similarity.json");

  const files = new Map();
  files.set("log.jsonl", logBytes);
  files.set("policy.json", policyBytes);
  if (exists(similarityFile)) files.set("similarity.json", fs.readFileSync(similarityFile));
  for (const [name, abs] of docs) files.set(name, fs.readFileSync(abs));
  files.set("commits.txt", Buffer.from(gl.stdout, "utf8"));
  for (const p of extra) files.set("evidence/" + p, fs.readFileSync(path.join(ROOT, p)));
  files.set("publisher.pub", Buffer.from(key.publicKey.export({ type: "spki", format: "pem" })));

  const checkpoints = entries.filter((e) => e.kind === "checkpoint");
  const counts = summarizeEntries(entries);
  const policyHashes = [];
  for (const e of checkpoints) if (!policyHashes.includes(e.data.policyHash)) policyHashes.push(e.data.policyHash);
  const idleGapHours = cc.cleanroom.idleGapHours;
  const manifest = {
    version: 1,
    flight: cc.flight ?? gitFacts().branch,
    plugin: { version: VERSION, ...hashes, verifierHash: sha256Hex(verifierBytes) },
    repo: { baseBranch: cc.baseBranch, base, head, branch: gitFacts().branch },
    mode: "clean-room",
    genesis,
    policy: { path: cc.cleanroom.policy, hashes: policyHashes, current: policyHash(policyBytes) },
    chain: { entries: entries.length, first: entries[0].hash, tip: entries[entries.length - 1].hash },
    checkpoints: checkpoints.map((e) => ({ seq: e.seq, event: e.data.event, git: e.data.git, signature: e.data.signature, ok: verifyCheckpoint(e, key.publicKey) })),
    denials: counts.denials,
    calls: counts.calls,
    human: counts.human,
    selfTest: { ok: true, cases: Number(/\((\d+) cases\)/.exec(selfTest.stdoutTail || "")?.[1] ?? 0), at: new Date().toISOString() },
    coverage: { gaps: coverageGaps(entries, gl.stdout.split("\n"), { idleGapHours }), knownLimits: KNOWN_LIMITS, idleGapHours },
    similarity: files.has("similarity.json") ? { sha256: sha256Hex(files.get("similarity.json")) } : null,
    files: [...files].map(([name, bytes]) => ({ path: name, sha256: sha256Hex(bytes), bytes: bytes.length })),
    signer: { fingerprint: key.fingerprint, publicKey: "publisher.pub" },
    at: new Date().toISOString(),
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8");
  files.set("verify.mjs", verifierBytes);
  files.set("manifest.json", manifestBytes);
  files.set("manifest.sig", Buffer.from(signBytes(manifestBytes, key.privateKey) + "\n", "utf8"));

  const dir = path.join(ROOT, ATTEST_DIR);
  const existed = exists(dir);
  const old = existed ? walkFiles(dir) : [];
  const written = [...files.keys()].map((n) => path.join(dir, n));
  const crPaths = cleanroomPaths(st);
  let result;
  try {
    result = withRollback([...new Set([...old, ...written, ...crPaths])], () => {
      fs.rmSync(dir, { recursive: true, force: true });
      for (const [name, bytes] of files) {
        fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
        fs.writeFileSync(path.join(dir, name), bytes);
      }
      // The verifier that ships in the bundle checks the bundle before anything is committed.
      const run = spawnSync(process.execPath, [path.join(dir, "verify.mjs"), dir, "--key", key.fingerprint, "--json"], { encoding: "utf8", timeout: GATE_SELF_TEST_MS });
      let verdict;
      try {
        verdict = JSON.parse(run.stdout);
      } catch {
        throw new ToolError("the bundle's verifier produced no result (" + ((run.stderr || "").trim().split("\n")[0] || "exit " + run.status) + "); nothing was committed");
      }
      if (run.status !== 0 || !verdict.ok) {
        throw new ToolError("the attestation bundle did not verify, so it was removed and nothing was committed:\n" + verdict.reasons.map((x) => "  " + x.check + ": " + x.reason).join("\n"));
      }
      appendEntry(logPath, { kind: "attest", stage: "summarize", role: "session", data: { manifest: sha256Hex(manifestBytes) } });
      checkpoint("kukulu_attest", "summarize", st);
      const commit = gitCommitIfChanged([dir, ...crPaths], "chore: attestation bundle", { stage: "summarize" });
      return { verdict, commit };
    });
  } catch (e) {
    if (!existed) fs.rmSync(dir, { recursive: true, force: true });
    throw e;
  }
  const push = pushBranch(gitFacts().branch, st.policies.push);
  return { dir: ATTEST_DIR, files: [...files.keys()].sort(), manifest: sha256Hex(manifestBytes), fingerprint: key.fingerprint, commit: result.commit, verify: result.verdict, push };
}

function flightOptions(args = {}) {
  if (args.resume !== undefined && typeof args.resume !== "boolean") throw new ToolError("resume must be a boolean");
  const given = FLIGHT_OPTION_KEYS.filter((k) => args[k] !== undefined);
  if (!given.length) throw new ToolError(`pass at least one of ${FLIGHT_OPTION_KEYS.join(", ")}`);
  for (const k of given) {
    if (!Number.isInteger(args[k]) || args[k] <= 0) throw new ToolError(`${k} must be a positive integer`);
  }
  if (!exists(P.config)) throw new ToolError("docs/kukulu.json does not exist yet; set flight options once the plan stage has written it");
  const resume = args.resume === true;
  const st = loadState();
  if (resume) {
    if (!st.halted) throw new ToolError("the flight is not halted; there is nothing to resume");
    if (!st.haltCap) throw new ToolError(`this halt is not a round-cap halt, so resume cannot clear it: ${st.halted}`);
    const { cap, round, nonConverging } = st.haltCap;
    if (cap === "maxRoundsHard" && !(args.maxRoundsHard >= round)) {
      throw new ToolError(`the halt came from maxRoundsHard at round ${round}; pass maxRoundsHard: ${round} or more with resume, which is what would lift it`);
    }
    if (cap === "maxRounds" && !(args.maxRounds > nonConverging)) {
      throw new ToolError(`the halt came from maxRounds with ${nonConverging} non-converging rounds; pass maxRounds: ${nonConverging + 1} or more with resume, which is what would lift it`);
    }
  }
  const raw = loadConfig();
  const was = cfg();
  const before = Object.fromEntries(FLIGHT_OPTION_KEYS.map((k) => [k, was[k]]));
  for (const k of given) raw[k] = args[k];
  const paths = [...(resume ? [P.config, P.state] : [P.config]), ...cleanroomPaths(st)];
  return withRollback(paths, () => {
    write(P.config, `${JSON.stringify(raw, null, 2)}\n`);
    humanEntry(st, "kukulu_flight_options", args);
    if (resume) {
      st.halted = null;
      delete st.haltCap;
      saveState(st);
    }
    const after = Object.fromEntries(FLIGHT_OPTION_KEYS.map((k) => [k, cfg()[k]]));
    const label = `${given.map((k) => `${k}=${args[k]}`).join(", ")}${resume ? ", resume" : ""}`;
    const commit = gitCommitIfChanged(paths, `chore: flight options (${label})`, { stage: "controller" });
    return { before, after, commit, ...(resume ? { resumed: true } : {}) };
  });
}

/**
 * Stop a flight cleanly for an operator-level reason the implementer
 * cannot resolve itself (F-05): a signing agent that died mid-run, a disk
 * full, a verify command that cannot run at all, a base branch that
 * vanished. Never resets or cleans the tree — whatever state the run is in
 * stays exactly as it is for a human to look at.
 */
function runHalt({ reason }) {
  if (!reason) throw new ToolError("reason is required");
  refuseProgressText("reason", reason, "kukulu_run_halt");
  const st = loadState();
  st.halted = reason;
  delete st.haltCap; // only a round-cap halt is resumable through kukulu_flight_options
  delete st.haltStream;
  const commit = withRollback([P.state, P.progress, P.feedback], () => {
    saveState(st);
    if (exists(P.lock)) fs.unlinkSync(P.lock);
    if (cfg().policies.feedback) appendFeedback("controller", `Run halted: ${reason}`, "halt", "auto");
    return gitCommitIfChanged([P.state, P.progress, P.feedback], "chore: run halted", { stage: "controller" });
  });
  const g = gitFacts();
  const dirty = git(["status", "--porcelain"], { allowFail: true }).out !== "";
  return { halted: reason, branch: g.branch, head: g.head, commit, dirty, next: RESUME_HINT };
}

const RESUME_HINT = 'once the cause is fixed, call kukulu_run_resume({ reason: "<what you fixed>" })';

/**
 * Clear a halt that is not a round-cap halt, with a commit, so no operator
 * edits state.json by hand. Every refusal comes before anything is written.
 */
function runResume({ reason } = {}) {
  if (typeof reason !== "string" || !reason.trim()) throw new ToolError("reason must be a non-empty string: say what you fixed so the flight can continue");
  const st = loadState();
  const broken = cleanroomModeBreak(st, cleanroomOn(cfg()), exists(P.plan));
  if (broken) throw new ToolError(modeBreakText(broken));
  if (!st.halted) throw new ToolError("the flight is not halted; there is nothing to resume");
  if (st.haltCap) throw new ToolError("a round-cap halt is lifted by `kukulu_flight_options({ …, resume: true })`, not by kukulu_run_resume");
  const dirty = porcelainExcludingPreexisting(st.preexistingUntracked);
  if (dirty.length) throw new ToolError(`the working tree is not clean:\n${dirty.join("\n")}\nCommit or discard these, then call kukulu_run_resume again.`);
  const open = streamWorktrees();
  if (open.length) {
    throw new ToolError(`stream worktree ${open.map((n) => rel(streamDir(n))).join(", ")} still exists; merge or remove it (git worktree remove --force <dir>), then call kukulu_run_resume again`);
  }
  const c = cfg();
  if (!git(["rev-parse", "--verify", "--quiet", `refs/heads/${c.baseBranch}`], { allowFail: true }).ok) {
    throw new ToolError(`baseBranch '${c.baseBranch}' does not exist as a local branch; create it or fix baseBranch in docs/kukulu.json, then call kukulu_run_resume again`);
  }
  if (st.haltStream) {
    const current = git(["rev-parse", "--abbrev-ref", "HEAD"]).out;
    const branch = `${current}--${st.haltStream}`;
    const branchExists = git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], { allowFail: true }).ok;
    const merged = git(["branch", "--merged", current, "--format=%(refname:short)"], { allowFail: true }).out.split("\n").includes(branch);
    if (branchExists && !merged) {
      throw new ToolError(`the halt came from merging stream '${st.haltStream}', and its branch ${branch} is not merged into ${current}; run git merge --no-ff ${branch}, resolve any conflict and commit, then call kukulu_run_resume again`);
    }
  }
  const previousHalt = st.halted;
  st.halted = null;
  delete st.haltStream;
  const crPaths = cleanroomPaths(st);
  const commit = withRollback([P.state, P.feedback, ...crPaths], () => {
    saveState(st);
    if (c.policies.feedback) appendFeedback("controller", `Run resumed: ${reason.trim()}`, "resume", "human");
    humanEntry(st, "kukulu_run_resume", { reason });
    return gitCommitIfChanged([P.state, P.feedback, ...crPaths], "chore: run resumed", { stage: "controller" });
  });
  return { resumed: true, previousHalt, commit };
}

function formatTask(id, t) {
  const list = (v) => (Array.isArray(v) ? v.join(", ") : String(v ?? ""));
  return [
    `### ${id}: ${t.title}`,
    "",
    `**Goal:** ${t.goal || ""}`,
    `**Files touched:** ${list(t.files)}`,
    `**Design constraints:** ${t.constraints || ""}`,
    `**Acceptance tests:** ${t.tests || ""}`,
    `**Out of scope:** ${t.outOfScope || ""}`,
    `**Verification:** ${t.verification || ""}`,
    `**Depends on:** ${t.dependsOn && t.dependsOn.length ? list(t.dependsOn) : "none"}`,
  ].join("\n");
}

/** The number stamped on `docs/REVIEW.md`'s `Round:` line, or `null` if it is missing or unparseable. */
function reviewMdRound() {
  const m = read(P.review).match(/^Round:\s*(\d+)\s*$/m);
  return m ? Number(m[1]) : null;
}

/** 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st, 101st, 111th. */
function ordinal(n) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"}`;
}

function reviewSubmit({ verdict, tasks = [], unblock = [] }) {
  requireGate("review");
  // A crashed kukulu_mutate must not leave a mutated file under review.
  const recovered = recoverMutation();
  const recoveredField = recovered ? { recoveredMutation: recovered } : {};
  verdict = String(verdict || "").toUpperCase().trim();
  if (!["APPROVED", "CHANGES REQUESTED"].includes(verdict)) throw new ToolError("verdict must be APPROVED or CHANGES REQUESTED");
  if (!exists(P.review)) throw new ToolError("docs/REVIEW.md does not exist; write it before submitting");
  const st = loadState();
  if (!st.implemented) throw new ToolError("no implementation handoff recorded for this round; nothing to review");
  const c = cfg();
  // The round this review is itself stamped as: round is the count of fix
  // rounds already queued, so the review being submitted right now is
  // always round + 1 (F-10, F-11) — never guessed by the reviewer.
  const N = st.round + 1;
  const stampedRound = reviewMdRound();
  if (stampedRound !== N) {
    throw new ToolError(
      `docs/REVIEW.md's 'Round:' line is ${stampedRound === null ? "missing" : `'${stampedRound}'`}; this review must be stamped 'Round: ${N}'`,
    );
  }

  if (verdict === "APPROVED") {
    if (tasks.length || unblock.length) throw new ToolError("an APPROVED verdict cannot carry fix tasks or unblocks");
    st.reviewed = true; st.verdict = "APPROVED";
    st.rounds = [...st.rounds, { round: N, fixTasks: 0, unblocked: 0, verdict: "APPROVED", sources: { review: 0, mutation: 0, blocked: 0 }, at: new Date().toISOString() }];
    const crPaths = cleanroomPaths(st);
    const sha = withRollback([P.review, P.state, ...crPaths], () => {
      saveState(st);
      checkpoint("kukulu_review_submit", "review", st);
      return gitCommitIfChanged([P.review, P.state, ...crPaths], `review: round ${N} approved`, { stage: "review" });
    });
    const push = pushBranch(gitFacts().branch, st.policies.push);
    // `round` is the number this review was stamped with, as for CHANGES
    // REQUESTED — never the count of fix rounds (F-21).
    return { verdict, round: N, fixRounds: st.round, commit: sha, push, ...recoveredField };
  }

  if (!tasks.length && !unblock.length) throw new ToolError("CHANGES REQUESTED requires at least one fix task or unblock");
  const pr = parseProgress();
  for (const t of tasks) {
    for (const k of ["title", "goal", "files", "tests"]) if (!t[k] || (Array.isArray(t[k]) && !t[k].length)) throw new ToolError(`fix task '${t.title || "?"}' is missing '${k}'`);
    if (!FIX_SOURCES.includes(t.source)) throw new ToolError(`fix task '${t.title}' needs a source: ${FIX_SOURCES.map((x) => `"${x}"`).join(", ").replace(/, ("blocked")$/, " or $1")}`);
  }
  if (N > c.review.mutationFixRounds && tasks.some((t) => t.source === "mutation")) {
    throw new ToolError(
      `round ${N} is past review.mutationFixRounds=${c.review.mutationFixRounds}: a surviving mutant is advisory now. Put it under \`## Notes\` in REVIEW.md (the summarizer carries it) and resubmit; if the survivor shows a SPEC requirement is untested, resubmit it as source "review" naming that requirement.`,
    );
  }
  const sources = Object.fromEntries(FIX_SOURCES.map((x) => [x, tasks.filter((t) => t.source === x).length]));
  const ids = tasks.map((_, i) => `R${N}-${String(i + 1).padStart(2, "0")}`);
  // Every dependsOn must resolve to something that actually exists: an
  // already-known task, or one of this same submission's own new ids.
  for (const t of tasks) {
    for (const dep of t.dependsOn || []) {
      if (pr.tasks.some((x) => x.id === dep) || ids.includes(dep)) continue;
      throw new ToolError(`fix task '${t.title}' depends on '${dep}', which is neither an existing task in PROGRESS.md nor one of this submission's own ids (${ids.join(", ") || "none"})`);
    }
  }
  const unblocked = [];
  const reopened = [];
  const crPaths = cleanroomPaths(st);
  const sha = withRollback([P.review, P.plan, P.progress, P.state, P.feedback, ...crPaths], () => {
    if (tasks.length) {
      const block = [``, `## Review fixes (round ${N})`, ``, ...tasks.map((t, i) => formatTask(ids[i], t) + "\n")].join("\n");
      write(P.plan, read(P.plan).replace(/\s*$/, "\n") + block);
      appendTaskLines(pr, tasks.map((t, i) => ({ id: ids[i], title: t.title })));
    }
    for (const u of unblock) {
      const id = typeof u === "string" ? u : u.id;
      const reason = typeof u === "string" ? "unblocked by reviewer" : u.reason || "unblocked by reviewer";
      const t = pr.tasks.find((x) => x.id === id);
      if (!t) throw new ToolError(`cannot unblock ${id}: not in PROGRESS.md`);
      if (t.state !== "!" && t.state !== "-") {
        // Already reopened as a dependent of an earlier unblock in this call.
        if (reopened.includes(id)) continue;
        throw new ToolError(`cannot unblock ${id}: it is '${STATE_NAMES[t.state]}'`);
      }
      reopened.push(...reopenWithDependents(pr, [id], `unblocked (round ${N})`, reason));
      unblocked.push(id);
    }
    writeProgress(pr);

    // Convergence: a round is non-converging when it queues at least as much
    // work as the round before it. Round 1 has nothing to compare against, so
    // it is always allowed. maxRounds bounds how many non-converging rounds a
    // flight tolerates; maxRoundsHard is the absolute ceiling regardless
    // (F-13, F-15) — three rounds that shrink 15 → 3 → 2 never hit either.
    const thisCount = ids.length + unblocked.length;
    const priorFixRounds = st.rounds.filter((r) => r.verdict === "CHANGES REQUESTED");
    const prevRound = priorFixRounds[priorFixRounds.length - 1];
    const nonConverging = Boolean(prevRound) && thisCount >= prevRound.fixTasks + prevRound.unblocked;
    st.rounds = [...st.rounds, { round: N, fixTasks: ids.length, unblocked: unblocked.length, verdict: "CHANGES REQUESTED", nonConverging, sources, at: new Date().toISOString() }];
    const nonConvergingSoFar = st.rounds.filter((r) => r.nonConverging).length;
    const trail = st.rounds.filter((r) => r.verdict === "CHANGES REQUESTED").map((r) => r.fixTasks + r.unblocked).join(" → ");

    st.round = N; st.implemented = false; st.reviewed = true; st.verdict = "CHANGES REQUESTED";
    if (N > c.maxRoundsHard) {
      st.halted = `review round ${N} exceeds the hard cap maxRoundsHard=${c.maxRoundsHard} (findings per round: ${trail}); a human must decide whether to continue: call kukulu_flight_options({ maxRoundsHard: ${N}, resume: true })`;
      st.haltCap = { cap: "maxRoundsHard", round: N };
    } else if (nonConvergingSoFar >= c.maxRounds) {
      st.halted = `round ${N} is non-converging (findings per round: ${trail}), the ${ordinal(nonConvergingSoFar)} non-converging round, reaching maxRounds=${c.maxRounds}; a human must decide whether to continue: call kukulu_flight_options({ maxRounds: ${nonConvergingSoFar + 1}, resume: true })`;
      st.haltCap = { cap: "maxRounds", round: N, nonConverging: nonConvergingSoFar };
    }
    if (st.halted && c.policies.feedback) appendFeedback("review", st.halted, "round-cap", "auto");
    saveState(st);
    checkpoint("kukulu_review_submit", "review", st);
    return gitCommitIfChanged([P.review, P.plan, P.progress, P.state, P.feedback, ...crPaths], `review: round ${N}`, { stage: "review" });
  });
  const push = pushBranch(gitFacts().branch, st.policies.push);
  // Re-read rather than reuse `pr`: appendTaskLines edits pr.lines but not
  // pr.tasks, so counts(pr.tasks) would describe the file as it was before
  // this call queued its own fix tasks (F-03 of the 2026-09-23 flight feedback).
  return { verdict, round: N, fixTasks: ids, unblocked, reopenedDependents: reopened, commit: sha, halted: st.halted, counts: counts(parseProgress().tasks), push, ...recoveredField };
}

/**
 * The current branch's pull request as GitHub sees it, for a stage that
 * needs to say whether one exists (F-25): `{ url, state, draft, base }`
 * (plus `expectedBase` when it does not target `baseBranch`), or a string —
 * `"skipped: policy"`, `"none"`, or `"unknown: <why>"`. Never throws.
 */
function prState(policies, baseBranch) {
  if (policies.pr === "none") return "skipped: policy";
  if (!gitFacts().hasOrigin) return "none";
  if (spawnSync("gh", ["--version"], { encoding: "utf8" }).status !== 0) return "unknown: gh is not available";
  const r = spawnSync("gh", ["pr", "view", "--json", "url,state,isDraft,baseRefName"], { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) {
    const why = (r.stderr || r.stdout || "").trim().split("\n")[0];
    return /no (open )?pull requests? found/i.test(why) ? "none" : `unknown: ${why || "gh pr view failed"}`;
  }
  try {
    const j = JSON.parse(r.stdout);
    const pr = { url: j.url, state: j.state, draft: j.isDraft, base: j.baseRefName };
    return pr.base === baseBranch ? pr : { ...pr, expectedBase: baseBranch };
  } catch {
    return "unknown: gh pr view returned unparseable output";
  }
}

// An unavailable auto-merge keeps being asked for until the policy says otherwise.
const STOP_ASKING = '; set policies.finalize to "ready" to stop asking';

const CHECKS_FAIL = ["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"];
const CHECKS_PENDING = ["PENDING", "QUEUED", "IN_PROGRESS", "WAITING", "REQUESTED", "EXPECTED"];
const CHECKS_TIMEOUT_MS = 30000;

/**
 * The pull request's CI checks for `kukulu_status`: `null` when there is
 * nothing to ask (no origin, no gh, no pull request), else
 * `{ state: "pass" | "fail" | "pending" | "none", failing: [{ name, link }] }`,
 * or `"unknown: <why>"`. Never throws. `gh pr checks` exits non-zero for
 * failing or pending checks, so its stdout is parsed whatever the status.
 */
function prChecks() {
  if (!gitFacts().hasOrigin) return null;
  // A hung gh would hang this synchronous server, so every call is bounded; a timed-out --version reads as no gh.
  if (spawnSync("gh", ["--version"], { encoding: "utf8", timeout: CHECKS_TIMEOUT_MS }).status !== 0) return null;
  const view = spawnSync("gh", ["pr", "view", "--json", "url"], { cwd: ROOT, encoding: "utf8", timeout: CHECKS_TIMEOUT_MS });
  if (view.error) return `unknown: gh pr view failed: ${view.error.code === "ETIMEDOUT" ? `timed out after ${CHECKS_TIMEOUT_MS} ms` : view.error.message}`;
  if (view.status !== 0) {
    const why = (view.stderr || view.stdout || "").trim().split("\n")[0];
    return /no (open )?pull requests? found/i.test(why) ? null : `unknown: ${why || "gh pr view failed"}`;
  }
  const r = spawnSync("gh", ["pr", "checks", "--json", "name,state,link"], { cwd: ROOT, encoding: "utf8", timeout: CHECKS_TIMEOUT_MS });
  if (r.error) return `unknown: gh pr checks failed: ${r.error.code === "ETIMEDOUT" ? `timed out after ${CHECKS_TIMEOUT_MS} ms` : r.error.message}`;
  let list;
  try {
    list = JSON.parse(r.stdout);
  } catch {
    const why = (r.stderr || r.stdout || "").trim().split("\n")[0];
    return `unknown: ${why || "gh pr checks printed no JSON"}`;
  }
  if (!Array.isArray(list)) return "unknown: gh pr checks printed JSON that is not a list";
  const stateOf = (c) => String(c?.state ?? "").toUpperCase();
  const failing = list.filter((c) => CHECKS_FAIL.includes(stateOf(c))).map((c) => ({ name: c.name, link: c.link }));
  let state = "pass";
  if (!list.length) state = "none";
  else if (failing.length) state = "fail";
  else if (list.some((c) => CHECKS_PENDING.includes(stateOf(c)))) state = "pending";
  return { state, failing };
}

const SUMMARY_MAX_BYTES = 1024 * 1024;

function summaryCommit({ content } = {}) {
  requireGate("summarize");
  const st = loadState();
  if (content === undefined) {
    // 0.4.0 behavior: the summarizer wrote the file itself.
    if (!exists(P.summary)) throw new ToolError("docs/SUMMARY.md does not exist; pass the summary's full text as `content` and the tool will write it");
    if (st.verdict !== "APPROVED") throw new ToolError("summary can only be committed after an APPROVED review");
  } else {
    if (st.verdict !== "APPROVED") throw new ToolError("summary can only be committed after an APPROVED review; nothing was written");
    if (typeof content !== "string") throw new ToolError("content must be a string holding the full text of docs/SUMMARY.md");
    if (!content.trim()) throw new ToolError("content is empty; pass the full text of docs/SUMMARY.md");
    if (Buffer.byteLength(content, "utf8") >= SUMMARY_MAX_BYTES) {
      throw new ToolError(`content is ${SUMMARY_MAX_BYTES} bytes or more; a summary is for a human to read, so shorten it`);
    }
  }
  st.summarized = true;
  const crPaths = cleanroomPaths(st);
  const sha = withRollback([P.summary, P.state, P.feedback, ...crPaths], () => {
    if (content !== undefined) write(P.summary, content.endsWith("\n") ? content : `${content}\n`);
    saveState(st);
    checkpoint("kukulu_summary_commit", "summarize", st);
    return gitCommitIfChanged([P.summary, P.state, P.feedback, ...crPaths], "chore: build summary", { stage: "summarize" });
  });
  const g = gitFacts();
  const push = pushBranch(g.branch, st.policies.push);
  return { commit: sha, branch: g.branch, base: g.base, head: g.head, reviews: reviewCount(st), fixRounds: st.round, push, pr: prState(st.policies, cfg().baseBranch), archive: cfg().policies.archive };
}

/** The one line the operator needs when a flight's commits are not all signed. */
function nextSteps(mergeBase) {
  return `Unlock the signing agent, then tell the flight controller to finalize with re-signing: kukulu_pr_finalize({ resign: true }). Or by hand: git rebase -f --rebase-merges --gpg-sign ${mergeBase}, then git push --force-with-lease, then kukulu_pr_finalize({}).`;
}

/**
 * Count the flight's commits that carry no valid-looking signature, judged
 * from the commits themselves, never from state.signing. `%G?` of N (none)
 * or B (bad) is unsigned; anything else, E (cannot check) included, is
 * signed, because a machine without the signer's public key still holds a
 * signed commit. `first` is the oldest unsigned sha.
 */
function signedCheck(mergeBase) {
  const log = git(["log", "--format=%H %G?", `${mergeBase}..HEAD`]).out.split("\n").filter(Boolean);
  const unsigned = log.filter((l) => ["N", "B"].includes(l.split(" ")[1]));
  return { signed: log.length - unsigned.length, unsigned: unsigned.length, first: unsigned.length ? unsigned[unsigned.length - 1].split(" ")[0] : null };
}

/** The config a finalize runs under: docs/kukulu.json, or the archived copy once the flight has been archived. */
function finalizeConfig(st) {
  if (!exists(P.config) && st.archived) {
    // Flights archived before 0.6.0 hold their config under the old name; that name is history and stays readable.
    const archived = ["kukulu.json", "foun" + "dry.json"].map((n) => path.join(ROOT, st.archived.dir, n)).find(exists);
    if (archived) {
      let raw;
      try {
        raw = JSON.parse(read(archived));
      } catch (e) {
        throw new ToolError(`${rel(archived)} is not valid JSON: ${e.message}`);
      }
      return cfgFrom(raw, null);
    }
  }
  return cfg();
}

function prFinalize({ breaking, resign } = {}) {
  const st = loadState();
  let summarized = st.summarized === true;
  if (!summarized && st.archived) {
    try {
      summarized = JSON.parse(read(path.join(ROOT, st.archived.dir, "state.json"))).summarized === true;
    } catch {
      summarized = false;
    }
  }
  if (!summarized) throw new ToolError("the summary is not committed yet; call kukulu_summary_commit first, then kukulu_pr_finalize");
  if (breaking !== undefined && typeof breaking !== "boolean") throw new ToolError("breaking must be a boolean");
  if (resign !== undefined && typeof resign !== "boolean") throw new ToolError("resign must be a boolean");
  const brk = breaking !== undefined ? breaking : st.breaking;
  if (typeof brk !== "boolean") throw new ToolError("breaking is required on the first call: pass true or false");
  const cc = finalizeConfig(st);
  const mb = git(["merge-base", cc.baseBranch, "HEAD"], { allowFail: true }).out;
  if (!mb) throw new ToolError(`cannot find a merge base with baseBranch '${cc.baseBranch}'; check out the build branch, or fix baseBranch in docs/kukulu.json`);

  const branch = gitFacts().branch;
  const summaryPath = exists(P.summary) ? P.summary : st.archived && exists(path.join(ROOT, st.archived.dir, "SUMMARY.md")) ? path.join(ROOT, st.archived.dir, "SUMMARY.md") : null;

  const awaiting = (check) => {
    const prior = st.awaitingSigning;
    st.breaking = brk;
    st.awaitingSigning = { unsigned: check.unsigned, first: check.first, since: prior?.since || new Date().toISOString() };
    const paths = [P.state, P.feedback, ...(summaryPath ? [summaryPath] : [])];
    withRollback(paths, () => {
      saveState(st);
      if (!prior && feedbackEnabled()) {
        appendFeedback("summarize", `Flight is awaiting signing: ${check.unsigned} unsigned commit(s), oldest ${String(check.first).slice(0, 7)}.`, "signing", "auto");
      }
      if (summaryPath && !read(summaryPath).includes("## Awaiting signing")) {
        fs.appendFileSync(summaryPath, `${read(summaryPath).endsWith("\n") ? "" : "\n"}\n## Awaiting signing\n\n${nextSteps(mb)}\n`);
      }
      gitCommitIfChanged(paths, "chore: awaiting signing", { stage: "summarize" });
    });
    return {
      signed: check.signed, unsigned: check.unsigned, ready: false, merge: "skipped: awaiting signing", breaking: brk,
      awaitingSigning: st.awaitingSigning, resigned: false,
      push: pushBranch(branch, cc.policies.push), pr: prState(cc.policies, cc.baseBranch), next: nextSteps(mb),
    };
  };

  let resigned = false;
  let resignPush;
  if (resign === true) {
    const dirty = porcelainExcludingPreexisting(st.preexistingUntracked);
    if (dirty.length) throw new ToolError(`the working tree is not clean:\n${dirty.join("\n")}\nCommit or discard these before re-signing; the rebase needs a clean tree.`);
    if (branch === cc.baseBranch) throw new ToolError(`on the base branch '${cc.baseBranch}'; check out the build branch before re-signing`);
    // A run that fell back to unsigned commits left commit.gpgsign false
    // locally; the probe and the rebase must see the operator's own setting.
    const hadOverride = st.signingOverride === true;
    if (hadOverride) git(["config", "--local", "--unset", "commit.gpgsign"], { allowFail: true });
    const putOverrideBack = () => {
      if (hadOverride) git(["config", "--local", "commit.gpgsign", "false"]);
    };
    try {
      probeSigning("required");
    } catch (e) {
      putOverrideBack();
      throw e;
    }
    // The operator's instruction goes into the chain, and into a commit the rebase will re-sign, before the rebase needs a clean tree.
    const crPaths = cleanroomPaths(st);
    if (crPaths.length) {
      withRollback(crPaths, () => {
        humanEntry(st, "kukulu_pr_finalize", { breaking, resign: true });
        gitCommitIfChanged(crPaths, "chore: clean-room record", { stage: "controller" });
      });
    }
    const rb = spawnSync("git", ["rebase", "-f", "--rebase-merges", "--gpg-sign", mb], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: cc.commandTimeoutMs,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    if (rb.status !== 0 || rb.error) {
      git(["rebase", "--abort"], { allowFail: true });
      putOverrideBack();
      const why = (rb.stderr || rb.stdout || rb.error?.message || "git rebase failed").trim().split("\n").slice(0, 3).join(" | ");
      throw new ToolError(`re-signing failed: ${why}. The rebase was aborted and the branch is as it was.`);
    }
    delete st.signingOverride;
    const check = signedCheck(mb);
    if (check.unsigned) {
      throw new ToolError(`${check.unsigned} commit(s) are still unsigned after the rebase, the oldest ${String(check.first).slice(0, 7)}. The rewritten branch has been left as it is; check the signing agent and try again.`);
    }
    if (!cc.policies.push) resignPush = "skipped: policy";
    else if (!gitFacts().hasOrigin) resignPush = "skipped: no origin remote";
    else {
      const p = git(["push", "--force-with-lease", "origin", branch], { allowFail: true });
      resignPush = p.ok ? "pushed" : `failed: ${(p.err || p.out || "unknown error").split("\n")[0]}`;
    }
    delete st.awaitingSigning;
    st.signing = "on";
    resigned = true;
  }

  const before = signedCheck(mb);
  if (before.unsigned) return awaiting(before);

  st.breaking = brk;
  delete st.awaitingSigning;
  if (st.signingOverride) {
    git(["config", "--local", "--unset", "commit.gpgsign"], { allowFail: true });
    delete st.signingOverride;
    st.signing = "on";
  }
  withRollback([P.state], () => {
    saveState(st);
    gitCommitIfChanged([P.state], "chore: finalize flight", { stage: "summarize" });
  });
  const after = signedCheck(mb);
  if (after.unsigned) return awaiting(after);

  const push = pushBranch(branch, cc.policies.push);
  let pr = prState(cc.policies, cc.baseBranch);
  let merge;
  const gh = (args) => spawnSync("gh", args, { cwd: ROOT, encoding: "utf8" });
  const firstLine = (r) => (r.stderr || r.stdout || "gh failed").trim().split("\n")[0];
  if (typeof pr !== "object") {
    merge = "skipped: no pull request";
  } else if (cc.policies.pr !== "draft") {
    merge = "skipped: policy";
  } else if (cc.policies.finalize === "draft") {
    merge = "skipped: policy";
  } else {
    const readied = pr.draft ? gh(["pr", "ready"]) : { status: 0 };
    if (readied.status !== 0) merge = `unavailable: gh pr ready failed: ${firstLine(readied)}${STOP_ASKING}`;
    else if (cc.policies.finalize === "ready") merge = "skipped: policy";
    else if (brk) merge = "skipped: breaking";
    else {
      const m = spawnSync("gh", ["pr", "merge", "--auto", `--${cc.policies.mergeMethod}`], { cwd: ROOT, encoding: "utf8" });
      merge = m.status === 0 ? "enabled" : `unavailable: ${firstLine(m)}${STOP_ASKING}`;
    }
    pr = prState(cc.policies, cc.baseBranch);
  }
  return {
    signed: after.signed, unsigned: 0, ready: typeof pr === "object" ? pr.draft === false : false, merge, breaking: brk,
    awaitingSigning: null, resigned, ...(resignPush !== undefined ? { resignPush } : {}), push, pr,
  };
}

/** The clean-room files an archive moves: the log, and the similarity record when there is one. Empty outside clean-room mode. */
function cleanroomMovables(st) {
  const similarityJson = path.join(P.stateDir, "cleanroom", "similarity.json");
  return [...(st.cleanroom?.genesis ? [cleanroomLogPath()] : []), similarityJson].filter((abs) => !path.relative(ROOT, abs).startsWith("..") && exists(abs));
}

/** The files an archive moves, as [absolute path, repo-relative name]; a move keeps each file's name. */
const archivedFiles = () => [P.plan, P.progress, P.handoff, P.review, P.summary, P.similarityDoc, P.config, P.state, P.feedback].map((abs) => [abs, rel(abs)]);

/**
 * Move a summarized flight's artifacts into docs/flights/<slug>/ so the
 * repository can run its next flight (S-07). The live SPEC.md stays, copied
 * alongside. All-or-nothing: if the commit fails, every file is put back.
 */
function flightArchive({ slug } = {}) {
  const c0 = cfg();
  slug = slug === undefined ? c0.flight : slug;
  if (slug === null || slug === undefined) throw new ToolError('pass slug, or set "flight" in docs/kukulu.json');
  if (typeof slug !== "string" || !FLIGHT_SLUG.test(slug)) throw new ToolError(`slug must match ${FLIGHT_SLUG} (lowercase letters, digits and -, at most 40 characters), not ${JSON.stringify(slug)}`);
  const old = loadState();
  if (!old.summarized) throw new ToolError("the flight is not summarized yet; archive only after kukulu_summary_commit has run");
  if (exists(P.lock)) throw new ToolError("an implementation run is armed (.kukulu/implement.lock exists); finish or halt the run before archiving");
  const dirty = porcelainExcludingPreexisting(old.preexistingUntracked);
  if (dirty.length) throw new ToolError(`the working tree is not clean:\n${dirty.join("\n")}\nCommit or discard these before archiving.`);
  const relDir = `docs/flights/${slug}`;
  const dir = path.join(ROOT, relDir);
  if (exists(dir)) throw new ToolError(`${relDir} already exists; choose another slug, or remove the old archive`);
  // Everything that needs docs/kukulu.json is read before it moves.
  const pushAllowed = c0.policies.push;

  const sources = archivedFiles().filter(([abs]) => exists(abs));
  const copyDest = path.join(dir, "SPEC.md");
  // The clean-room log (and the similarity record) go to docs/flights/<slug>/cleanroom/, so the next flight's genesis is entry 1.
  const crDir = path.join(dir, "cleanroom");
  const crSources = cleanroomMovables(old);
  // The attestation bundle keeps its layout: docs/attestation/<file> becomes docs/flights/<slug>/attestation/<file>.
  const attDir = path.join(ROOT, ATTEST_DIR);
  const attSources = exists(attDir) ? walkFiles(attDir) : [];
  const attDest = (abs) => path.join(dir, "attestation", path.relative(attDir, abs));
  const touched = [...sources.map(([abs]) => abs), ...sources.map(([abs]) => path.join(dir, path.basename(abs))), copyDest, P.state, P.feedback, ...crSources, ...crSources.map((abs) => path.join(crDir, path.basename(abs))), ...attSources, ...attSources.map(attDest)];
  const all = [...new Set(touched)];
  const flightsDirExisted = exists(path.join(ROOT, "docs", "flights"));
  let commit;
  try {
    commit = withRollback(all, () => {
      fs.mkdirSync(dir, { recursive: true });
      checkpoint("kukulu_flight_archive", "summarize", old);
      for (const abs of crSources) {
        const dest = path.join(crDir, path.basename(abs));
        fs.mkdirSync(crDir, { recursive: true });
        if (git(["ls-files", "--error-unmatch", "--", rel(abs)], { allowFail: true }).ok) git(["mv", rel(abs), rel(dest)]);
        else fs.renameSync(abs, dest);
      }
      for (const abs of attSources) {
        const dest = attDest(abs);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        if (git(["ls-files", "--error-unmatch", "--", rel(abs)], { allowFail: true }).ok) git(["mv", rel(abs), rel(dest)]);
        else fs.renameSync(abs, dest);
      }
      if (attSources.length) fs.rmSync(attDir, { recursive: true, force: true });
      for (const [abs] of sources) {
        const dest = path.join(dir, path.basename(abs));
        const tracked = git(["ls-files", "--error-unmatch", "--", rel(abs)], { allowFail: true }).ok;
        if (tracked) git(["mv", rel(abs), rel(dest)]);
        else fs.renameSync(abs, dest);
      }
      fs.copyFileSync(P.spec, copyDest);
      saveState({ ...DEFAULT_STATE, archived: { slug, dir: relDir, at: new Date().toISOString() }, ...(old.signingOverride ? { signingOverride: true } : {}) });
      const rels = all.map(rel);
      // Old paths are already staged as deletions by git mv (or were never
      // tracked), and git add rejects a pathspec that matches nothing, so
      // only what exists now is added.
      git(["add", "-A", "--", ...rels.filter((r) => exists(path.join(ROOT, r)))]);
      const known = rels.filter((r) => exists(path.join(ROOT, r)) || git(["cat-file", "-e", `HEAD:${r}`], { allowFail: true }).ok);
      commitStaged(known, `chore: archive flight ${slug}`, { stage: "summarize", cleanroom: Boolean(old.cleanroom?.genesis) });
      return git(["rev-parse", "--short", "HEAD"]).out;
    });
  } catch (e) {
    if (exists(dir) && !fs.readdirSync(dir).length) fs.rmdirSync(dir);
    const flights = path.join(ROOT, "docs", "flights");
    if (!flightsDirExisted && exists(flights) && !fs.readdirSync(flights).length) fs.rmdirSync(flights);
    throw e;
  }
  const push = pushBranch(gitFacts().branch, pushAllowed);
  return { slug, dir: relDir, moved: [...sources.map(([, r]) => r), ...(attSources.length ? [ATTEST_DIR] : [])], copied: ["docs/SPEC.md"], commit, push };
}

// ---------------------------------------------------------------- plan validation and commit (S-06)

/**
 * Check a plan's four deliverables together and return every problem found,
 * `[{ check, id?, message }]`. Pure: it reads no files, so a caller can run
 * it on text it has not written yet. `allowSuffix` admits a headings such as
 * `P1-02a`, which only a renumbering pass may hold.
 */
function validatePlanTexts({ planText, progressText, configRaw, configError, claudeExists, branch = null, allowSuffix = false }) {
  const problems = [];
  const add = (check, message, id) => {
    if (!problems.some((p) => p.message === message)) problems.push({ check, ...(id ? { id } : {}), message });
  };
  if (planText == null) add("files", "docs/PLAN.md is missing");
  if (progressText == null) add("files", "docs/PROGRESS.md is missing");
  if (configRaw == null && !configError) add("files", "docs/kukulu.json is missing");
  if (configError) add("config", configError);
  if (!claudeExists) add("claude", "CLAUDE.md does not exist at the repository root; the implementer reads it first");

  const planLines = planText == null ? null : planText.split("\n");
  const ids = []; // task ids with a well-formed heading, in document order
  if (planLines) {
    const okHeading = allowSuffix ? /^### (?:P\d+-\d+[a-z]?|R\d+-\d+): \S/ : /^### [PR]\d+-\d+: \S/;
    const seen = new Set();
    for (const line of planLines) {
      if (!/^#{2,4}\s*[PR]\d+-\d+/.test(line)) continue;
      if (!okHeading.test(line)) {
        const hint = /^### P\d+-\d+[a-z]: /.test(line) ? "; a suffixed id such as P1-02a marks a split task, and kukulu_plan_commit with renumber: true gives it a clean number everywhere" : "";
        add("heading", `heading ${JSON.stringify(line)} must be exactly "### <ID>: <title>" (for example "### P1-03: Add the parser")${hint}`);
        continue;
      }
      const id = line.match(/^### ([PR]\d+-\d+[a-z]?):/)[1];
      if (seen.has(id)) add("duplicate", `${id} has two headings in docs/PLAN.md`, id);
      else {
        seen.add(id);
        ids.push(id);
      }
    }

    // P ids count up from 01 inside each phase with no gap; R ids are exempt.
    const byPhase = new Map();
    for (const id of ids) {
      const m = id.match(/^P(\d+)-(\d+)$/);
      if (m) byPhase.set(m[1], [...(byPhase.get(m[1]) || []), Number(m[2])]);
    }
    for (const [phase, nums] of byPhase) {
      if (nums.every((n, i) => n === i + 1)) continue;
      const want = nums.map((_, i) => `P${phase}-${String(i + 1).padStart(2, "0")}`).join(", ");
      const got = nums.map((n) => `P${phase}-${String(n).padStart(2, "0")}`).join(", ");
      add("sequence", `phase ${phase}: tasks must be numbered ${want} in document order with no gap, but are ${got}`);
    }

    // Dependencies point backwards, and never in a circle.
    const graph = new Map();
    for (const id of ids) {
      let deps = [];
      try {
        deps = planTaskFrom(planLines, id).depends;
      } catch {
        deps = [];
      }
      graph.set(id, deps);
      deps.forEach((dep) => {
        if (!seen.has(dep)) add("depends", `${id} depends on ${dep}, which has no heading in docs/PLAN.md`, id);
        else if (ids.indexOf(dep) >= ids.indexOf(id)) {
          add("depends", dep === id ? `${id} depends on itself` : `${id} depends on ${dep}, which comes later in docs/PLAN.md; a task may only depend on an earlier one`, id);
        }
      });
    }
    const state = new Map();
    const stack = [];
    const reported = new Set();
    const visit = (id) => {
      state.set(id, 1);
      stack.push(id);
      for (const dep of graph.get(id) || []) {
        if (!graph.has(dep)) continue;
        if (state.get(dep) === 1) {
          const cyc = stack.slice(stack.indexOf(dep));
          const start = cyc.indexOf([...cyc].sort()[0]);
          const canon = [...cyc.slice(start), ...cyc.slice(0, start)];
          if (!reported.has(canon.join(">"))) {
            reported.add(canon.join(">"));
            add("cycle", `dependency cycle: ${[...canon, canon[0]].join(" → ")}`);
          }
        } else if (!state.get(dep)) visit(dep);
      }
      stack.pop();
      state.set(id, 2);
    };
    for (const id of ids) if (!state.get(id)) visit(id);

    for (const id of ids) {
      const { stream } = planTaskFrom(planLines, id);
      if (stream !== null && !STREAM_SLUG.test(stream)) {
        add("streams", `${id}: **Stream:** ${JSON.stringify(stream)} must be a lowercase slug (a-z, 0-9 and -, starting with a letter) or none`, id);
      }
    }
  }

  let pr = null;
  if (progressText != null) {
    try {
      pr = parseProgressText(progressText);
    } catch (e) {
      add("progress", e.message);
    }
  }
  if (pr && planLines) {
    const a = ids.join(",");
    const b = pr.tasks.map((t) => t.id).join(",");
    if (a !== b) {
      const missing = ids.filter((id) => !pr.tasks.some((t) => t.id === id));
      const extra = pr.tasks.map((t) => t.id).filter((id) => !ids.includes(id));
      const why = [
        missing.length ? `missing from PROGRESS.md: ${missing.join(", ")}` : "",
        extra.length ? `not in PLAN.md: ${extra.join(", ")}` : "",
        !missing.length && !extra.length ? "the same tasks in a different order" : "",
      ].filter(Boolean).join("; ");
      add("progress", `docs/PROGRESS.md's tasks must match docs/PLAN.md's, in the same order (${why})`);
    }
  }

  let cc = null;
  if (configRaw != null && typeof configRaw === "object") {
    try {
      cc = cfgFrom(configRaw, null);
    } catch (e) {
      add("config", e.message);
    }
    const named = new Map(); // from id -> where it is used
    const note = (from, where) => {
      if (typeof from === "string") named.set(from, [...(named.get(from) || []), where]);
    };
    if (Array.isArray(configRaw.constraints)) configRaw.constraints.forEach((c) => c && note(c.from, `constraint '${c.id}'`));
    const entries = (list, label) => Array.isArray(list) && list.forEach((e, i) => e && typeof e === "object" && note(e.from, `${label}[${i}]`));
    entries(configRaw.verify, "verify");
    if (configRaw.extraVerify && typeof configRaw.extraVerify === "object") {
      for (const [prefix, list] of Object.entries(configRaw.extraVerify)) entries(list, `extraVerify['${prefix}']`);
    }
    if (planLines) {
      for (const [from, where] of named) {
        if (!ids.includes(from)) add("from", `from names ${from}, which has no heading in docs/PLAN.md (used by ${where.join(", ")})`, from);
      }
    }
  }

  // A plan committed on a branch that run_start would then refuse strands the operator after the planner is done.
  if (cc && branch) {
    if (branch !== cc.baseBranch && !branch.startsWith(cc.branchPrefix)) {
      add("branch", `on '${branch}', but docs/kukulu.json baseBranch is '${cc.baseBranch}'; set baseBranch to '${branch}' (the branch the plan is committed on) or switch to it`);
    }
  }

  if (pr && planLines && cc) {
    for (const w of computeWaves(pr, cc, planLines)) if (!w.valid) add("streams", `wave ${w.index}: ${w.reason}`);
  }
  return problems;
}

const SPLIT_ID = /(?<![A-Za-z0-9-])(P\d+-\d+[a-z]?)(?![A-Za-z0-9])/g;

/** `{ old: new }` for every P id that must change so each phase counts P<n>-01, P<n>-02, … in document order. */
function renumberMap(planText) {
  const next = new Map();
  const map = {};
  for (const m of planText.matchAll(/^### (P(\d+)-\d+[a-z]?):/gm)) {
    const n = (next.get(m[2]) || 0) + 1;
    next.set(m[2], n);
    const fresh = `P${m[2]}-${String(n).padStart(2, "0")}`;
    if (fresh !== m[1]) map[m[1]] = fresh;
  }
  return map;
}

/** The [start, end) character range of CLAUDE.md's `## Flight <slug> notes` section, up to the next `## ` heading or the end, or null. */
function flightNotesRange(text, slug) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trimEnd() === `## Flight ${slug} notes`);
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  if (end < 0) end = lines.length;
  const offset = (n) => lines.slice(0, n).reduce((sum, l) => sum + l.length + 1, 0);
  return [offset(start), Math.min(offset(end), text.length)];
}

/** `swap` applied to the flight's notes section of CLAUDE.md and to nothing else; the text is returned as it was when the flight has no slug or no section. */
function swapFlightNotes(claudeText, configText, swap) {
  let slug = null;
  try {
    slug = JSON.parse(configText ?? "null")?.flight;
  } catch {
    return claudeText;
  }
  if (typeof slug !== "string" || !slug) return claudeText;
  const range = flightNotesRange(claudeText, slug);
  if (!range) return claudeText;
  return claudeText.slice(0, range[0]) + swap(claudeText.slice(range[0], range[1])) + claudeText.slice(range[1]);
}

function planCommit({ renumber } = {}) {
  if (renumber !== undefined && typeof renumber !== "boolean") throw new ToolError("renumber must be a boolean");
  const readOrNull = (p) => (exists(p) ? read(p) : null);
  let planText = readOrNull(P.plan);
  let progressText = readOrNull(P.progress);
  let configText = readOrNull(P.config);
  const claudePath = path.join(ROOT, "CLAUDE.md");
  const claudeText = readOrNull(claudePath);
  let claudeNew = claudeText;
  let map = {};
  if (renumber === true && planText != null && progressText != null) {
    const started = (progressText.match(/^Started:\s*(.*)$/m) || [])[1];
    const touched = /^- \[[^ ]\] /m.test(progressText);
    if ((started && !started.startsWith("(")) || touched) {
      throw new ToolError("renumber is only for a plan no run has touched: docs/PROGRESS.md shows a run has started (a Started: stamp, or a task that is not [ ]). Renumbering now would rewrite ids that commits and log entries already cite.");
    }
    map = renumberMap(planText);
    // One pass over each text, never chained: P1-03 -> P1-04 must not then become P1-05.
    const swap = (text) => text.replace(SPLIT_ID, (id) => map[id] || id);
    planText = swap(planText);
    progressText = swap(progressText);
    if (configText != null) configText = configText.replace(/("from"\s*:\s*")([^"]+)(")/g, (_, a, id, b) => `${a}${map[id] || id}${b}`);
    // CLAUDE.md cites ids too, but only the flight's own notes section is rewritten: earlier flights' sections are history.
    claudeNew = claudeText != null ? swapFlightNotes(claudeText, configText, swap) : claudeText;
  }
  let configRaw = null;
  let configError = null;
  if (configText != null) {
    try {
      configRaw = JSON.parse(configText);
    } catch (e) {
      configError = `docs/kukulu.json is not valid JSON: ${e.message}`;
    }
  }
  const inRepo = git(["rev-parse", "--is-inside-work-tree"], { allowFail: true }).ok;
  const branch = inRepo ? git(["rev-parse", "--abbrev-ref", "HEAD"], { allowFail: true }).out || null : null;
  const problems = validatePlanTexts({ planText, progressText, configRaw, configError, claudeExists: exists(claudePath), branch });
  if (problems.length) {
    const head = `${problems.length} problem${problems.length === 1 ? "" : "s"} in the plan; fix every one, then call kukulu_plan_commit again. Nothing was committed.`;
    throw new ToolError(`${head}\n${problems.map((p, i) => `${i + 1}. [${p.check}] ${p.message}`).join("\n")}`, { problems });
  }
  const paths = [P.plan, P.progress, P.config, claudePath];
  const commit = withRollback(paths, () => {
    if (Object.keys(map).length) {
      write(P.plan, planText);
      write(P.progress, progressText);
      if (configText != null) write(P.config, configText);
      if (claudeNew !== claudeText) write(claudePath, claudeNew);
    }
    return gitCommitIfChanged(paths, "plan: derive build plan from SPEC", { stage: "plan" });
  });
  const pr = parseProgressText(progressText);
  const phases = new Map();
  for (const t of pr.tasks) {
    const m = t.id.match(/^P(\d+)-/);
    if (m) phases.set(Number(m[1]), (phases.get(Number(m[1])) || 0) + 1);
  }
  // A slug ending in a spec suffix means the title's dash was not honoured; say so, but never refuse.
  const notes = [];
  const slug = configRaw?.flight;
  if (Object.keys(map).length) {
    if (typeof slug !== "string" || !slug) notes.push("docs/kukulu.json has no flight slug; ids in CLAUDE.md were not renumbered");
    else if (flightNotesRange(claudeText ?? "", slug) === null) notes.push(`CLAUDE.md has no "## Flight ${slug} notes" section; ids there were not renumbered`);
  }
  if (typeof slug === "string" && /-spec(ification)?$/.test(slug)) {
    notes.push(`flight '${slug}' ends in a spec suffix; derive it from the text before the title's dash (plan-build), e.g. '${slug.replace(/-spec(ification)?$/, "")}'`);
  }
  return {
    commit,
    notes,
    tasks: pr.tasks.length,
    phases: [...phases].map(([phase, tasks]) => ({ phase, tasks })),
    waves: computeWaves(pr, cfg()).map((w) => ({ index: w.index, streams: Object.keys(w.streams), valid: w.valid })),
    renumbered: map,
  };
}

// ---------------------------------------------------------------- MCP plumbing

// `required: []` is legal but trips stricter schema validators; omit it instead.
const S = (props, required = []) => ({
  type: "object",
  properties: props,
  ...(required.length ? { required } : {}),
  additionalProperties: false,
});
const TOOLS = [
  { name: "kukulu_status", description: "Everything the pipeline knows from disk: which docs exist, task counts by state, branch/base/head, lock, round, review verdict, review.mutationFixRounds, and the pull request's CI checks as prChecks (every gh call bounded to 30 s). Read-only.", inputSchema: S({}), fn: () => ({ ...status(), prChecks: prChecks() }) },
  { name: "kukulu_next", description: "Deterministic stage selection: returns { stage, agent, agentFallback, fallbackAgent, restartRequired, model, agentModel, agentModelExact, round, reason, prompt, streams? }. stage is plan | implement | review | summarize | done | halt. agentModel is the value to pass as the Agent tool's model when agentFallback is true (an alias, or null to pass none); agentModelExact is false when a full claude-* id was mapped to its family alias. restartRequired is true only when the routed model cannot be reached without relaunching the session. Read-only, except that when a parallel wave's partition is invalid it records once (state, one feedback entry, one commit, only on a build branch) that the wave runs serially. When streams is present, spawn one implementer per entry, all at once, and wait for all of them.", inputSchema: S({}), fn: next },
  { name: "kukulu_plan_commit", description: "Validate the plan as a whole and commit it: docs/PLAN.md, docs/PROGRESS.md, docs/kukulu.json and CLAUDE.md must exist and agree (task headings, numbering, dependencies, streams, config, from references). Every problem is listed at once, as numbered lines and as structuredContent.problems [{ check, id?, message }]; nothing is committed while any remain. With renumber: true (only before any run has started) it first renumbers split ids everywhere. On success it commits 'plan: derive build plan from SPEC' and returns { commit, tasks, phases, waves, renumbered }. For the planner, as its last step.", inputSchema: S({ renumber: { type: "boolean", description: "rewrite split or out-of-sequence task ids (such as P1-02a) to a clean P<n>-01.. sequence everywhere they appear, then validate and commit; refused once a run has started" } }), fn: planCommit },
  { name: "kukulu_run_start", description: "Begin (or resume) an implementation run: create/reuse the build branch, arm the implement guard lock, stamp Branch/Started in PROGRESS.md, commit. Idempotent. With stream, also create (or resume) that stream's git worktree for a parallel wave, run parallel.setup in it, and return its cwd: do all of that stream's work inside cwd.", inputSchema: S({ stream: { type: "string", description: "a stream of the current parallel wave, when kukulu_next handed you one" } }), fn: runStart },
  { name: "kukulu_task_next", description: "Select the next task (first [~], else first [ ]), auto-skip tasks whose dependencies are blocked, mark it [~], and return its PLAN.md text plus dependency log entries. Returns { done: true } when none remain.", inputSchema: S({ stream: { type: "string", description: "restrict to this stream's tasks (parallel waves only)" } }), fn: taskNext },
  { name: "kukulu_task_done", description: "Mark a task [x] and append its log entry stamped with HEAD's sha. Requires HEAD's commit subject to start with '<id>:' and a clean tree. Commits PROGRESS.md.", inputSchema: S({ stream: { type: "string", description: "the stream this task belongs to, when working in a parallel wave" }, id: { type: "string" }, log: { type: "string", description: "Log entry body, under 15 lines" } }, ["id", "log"]), fn: taskDone },
  { name: "kukulu_task_block", description: "Give up on a task: hard-reset uncommitted changes, mark it [!], log BLOCKED: <reason>, commit PROGRESS.md.", inputSchema: S({ stream: { type: "string", description: "the stream this task belongs to, when working in a parallel wave" }, id: { type: "string" }, reason: { type: "string", description: "what you tried / what fails / what you think the fix is" } }, ["id", "reason"]), fn: taskBlock },
  {
    name: "kukulu_task_reopen",
    description: "Reopen a blocked [!] or skipped [-] task once whatever stopped it is resolved, together with every task skipped because of it (directly or transitively): sets them back to [ ], logs REOPENED: <reason>, commits PROGRESS.md. The next kukulu_task_next picks them up; after a finished run, kukulu_next hands out an implement stage again. Refused once the flight is summarized or while stream worktrees exist.",
    inputSchema: S({ id: { type: "string" }, reason: { type: "string", description: "what changed so the task can now succeed" } }, ["id", "reason"]),
    fn: taskReopen,
  },
  { name: "kukulu_verify", description: "Self-tests and runs every docs/kukulu.json constraint against the whole repo (tracked files plus new untracked ones, never ignored files or files untracked before the run started), then runs the verify commands plus extraVerify commands for any path prefix the given files fall under. Returns constraint results and per-command exit status and output tails.", inputSchema: S({ files: { type: "array", items: { type: "string" }, description: "Files touched by the task (optional); narrows extraVerify only, never the constraint scan" }, stream: { type: "string", description: "run in this stream's worktree (parallel waves only); refuses if an exclusive command would run" } }), fn: verify },
  { name: "kukulu_stream_finish", description: "Finish one stream of a parallel wave: requires no open tasks in the stream and a clean worktree, merges the stream's branch into the build branch (git merge --no-ff), then removes the worktree and branch. On a merge conflict it aborts, keeps the stream's branch and worktree, and halts the flight with instructions. Returns { stream, merged, mergeCommit, remainingStreams }.", inputSchema: S({ stream: { type: "string", description: "the stream whose tasks are all done or blocked" } }, ["stream"]), fn: streamFinish },
  { name: "kukulu_run_finish", description: "End an implementation run: requires zero open tasks and docs/HANDOFF.md; commits it, pushes and opens a draft PR against baseBranch unless policies say otherwise, disarms the lock, records the round as implemented, and reports a whole-tree constraint scan (constraints: { ok, failing }) without refusing on it.", inputSchema: S({}), fn: runFinish },
  {
    name: "kukulu_run_halt",
    description: "Stop the flight for an operator-level reason the implementer cannot resolve (a dead signing agent, a full disk, a vanished base branch): records the reason, disarms the lock, commits state and PROGRESS.md if they changed. Never resets or cleans the tree.",
    inputSchema: S({ reason: { type: "string", description: "why the flight cannot continue" } }, ["reason"]),
    fn: runHalt,
  },
  {
    name: "kukulu_run_resume",
    description: "Clear a halt that is not a round-cap halt once its cause is fixed, and commit `chore: run resumed`; a round-cap halt is lifted by kukulu_flight_options({ resume: true }). Refuses when the flight is not halted, the tree is dirty, a stream worktree exists, baseBranch is missing, or a stream-merge halt's branch is still unmerged.",
    inputSchema: S({ reason: { type: "string", description: "what you fixed so the flight can continue" } }, ["reason"]),
    fn: runResume,
  },
  {
    name: "kukulu_flight_options",
    description: "Apply an operator's flight options to docs/kukulu.json and commit them: maxRounds (non-converging review rounds tolerated) and maxRoundsHard (absolute ceiling on review rounds). For the flight controller, when /kukulu:go-flight was given options such as a maximum review depth. Refused before the plan stage has written docs/kukulu.json. With resume: true it also clears a round-cap halt, provided the bound passed lifts the cap that fired. Returns { before, after, commit } (plus resumed: true).",
    inputSchema: S({
      maxRounds: { type: "integer", minimum: 1, description: "non-converging review rounds tolerated before the flight halts" },
      maxRoundsHard: { type: "integer", minimum: 1, description: "a review numbered above this that requests changes halts the flight; an approving review ends it" },
      resume: { type: "boolean", description: "clear a round-cap halt (the call the halt message names); the bound passed must lift the cap that fired. Any other halt is refused" },
    }),
    fn: flightOptions,
  },
  {
    name: "kukulu_cleanroom_record",
    description: "Record what the operator said, did or decided in the clean-room chain, and commit it as 'chore: clean-room record': an instruction (the default), an intervention (something done outside the pipeline: a file supplied, a fix made by hand, a tool installed) or a verdict on a denial ('#<seq>: prior-art attempt|false positive|offline test — <note>'). Clean-room mode only; for the flight controller, on the operator's word.",
    inputSchema: S({
      text: { type: "string", description: "what the operator said, did or decided; a verdict starts with the denial's seq" },
      kind: { type: "string", enum: RECORD_KINDS, description: "instruction (default), intervention or verdict" },
    }, ["text"]),
    fn: cleanroomRecord,
  },
  {
    name: "kukulu_feedback_log",
    description: "Record one pipeline-friction entry — something Kūkulu's own tooling cost time on, not the project it is building. Appends to .kukulu/feedback.jsonl and commits it immediately, so it survives even if the flight never reaches summarize. Call it the moment friction happens.",
    inputSchema: S(
      {
        stage: { type: "string", enum: FEEDBACK_STAGES, description: "which role is logging this" },
        message: { type: "string", description: "one or two sentences: what happened and why it cost time" },
        category: { type: "string", description: "short free-form label, e.g. 'tool-refusal', 'ambiguous-prompt', 'stall' — defaults to 'other'" },
      },
      ["stage", "message"],
    ),
    fn: feedbackLog,
  },
  {
    name: "kukulu_mutate",
    description: "Mutation-test one file: apply one exact find/replace to a clean tracked file, run the verify commands that file triggers (verify plus matching extraVerify), always restore the file, undo anything else the commands changed (tracked files that were clean, untracked files that are new), and commit nothing. Returns { file, killed, verdict, results, restored, removed, recoveredMutation }; killed is true when at least one command failed. For reviewers checking that a test fails without the mechanic it covers — never edit source by hand instead.",
    inputSchema: S(
      {
        file: { type: "string", description: "repo-relative path of a tracked, clean text file" },
        find: { type: "string", description: "exact text to replace; must appear exactly once in the file" },
        replace: { type: "string", description: "the mutated text (\"\" deletes the match)" },
        commands: { type: "array", items: { type: "string" }, description: "optional: run only these configured verify/extraVerify commands, each spelled exactly as in docs/kukulu.json" },
        targeted: { type: "string", description: "optional: the name of a docs/kukulu.json mutation.targeted command to run instead of the verify commands; pass with filter, never with commands" },
        filter: { type: "string", description: "with targeted: the test name or path substituted for {filter} (letters, digits and _ . : / - only)" },
        timeoutMs: { type: "integer", minimum: 1, description: "optional: cap every command's timeout for this call (never raises a configured one), for a mutant you suspect hangs" },
        confirmKill: { type: "boolean", description: "optional: when the mutant is killed, re-run each failed command once on the unmutated tree; a command that fails there too makes the result inconclusive, not a kill" },
      },
      ["file", "find", "replace"],
    ),
    fn: mutate,
  },
  {
    name: "kukulu_review_submit",
    description: "Record a review verdict. APPROVED commits REVIEW.md. CHANGES REQUESTED assigns R<N>-<nn> ids, appends '## Review fixes (round N)' to PLAN.md, appends checkbox lines to PROGRESS.md, resets unblocked tasks along with every task skipped because of them (reopenedDependents), and commits 'review: round N'.",
    inputSchema: S({
      verdict: { type: "string", enum: ["APPROVED", "CHANGES REQUESTED"] },
      tasks: {
        type: "array",
        items: S({
          title: { type: "string" }, goal: { type: "string" }, files: { type: "array", items: { type: "string" } },
          constraints: { type: "string" }, tests: { type: "string" }, outOfScope: { type: "string" },
          verification: { type: "string" }, dependsOn: { type: "array", items: { type: "string" } },
          source: { type: "string", enum: FIX_SOURCES, description: "what produced this task: a review finding, a surviving mutant, or an unblocked/blocked task" },
        }, ["title", "goal", "files", "tests", "source"]),
      },
      unblock: { type: "array", items: S({ id: { type: "string" }, reason: { type: "string" } }, ["id"]) },
    }, ["verdict"]),
    fn: reviewSubmit,
  },
  { name: "kukulu_summary_commit", description: "Write docs/SUMMARY.md from `content` (preferred) or commit the file already on disk, and mark the flight complete. Only valid after an APPROVED review. Returns { commit, branch, base, head, reviews, fixRounds, push, pr, archive }; archive is the policies.archive setting (true means call kukulu_flight_archive next); pr is the branch's pull request ({ url, state, draft, base }) or \"none\", \"skipped: policy\" or \"unknown: <why>\".", inputSchema: S({ content: { type: "string", description: "the full text of docs/SUMMARY.md; the tool writes the file itself, so never Write it yourself" } }), fn: summaryCommit },
  {
    name: "kukulu_similarity",
    description: "Score the configured contamination pairs inside the server (the agents get numbers, never the prior art's text): writes .kukulu/cleanroom/similarity.json and docs/SIMILARITY.md, and in clean-room mode hashes every file it read into the chain with a score entry and a checkpoint, then commits 'chore: similarity scored'. Refuses without cleanroom.similarity, while an implementation run is armed, before an APPROVED review, for a missing or empty pair directory, and when the clean-room gate fails. For the summarizer, after kukulu_summary_commit.",
    inputSchema: S({}),
    fn: similarity,
  },
  {
    name: "kukulu_attest",
    description: "Write the signed attestation bundle for a finished clean-room flight into docs/attestation/ (the whole chain, the policy, the summary, review, progress, config and state, the commits since the base with their trailers, any evidence files, the signer's public key, the verifier as verify.mjs, and a manifest signed with the checkpoint key), run the bundle's own verifier on it, and commit it as 'chore: attestation bundle' only when it passes; push per policy. Clean-room mode only, after kukulu_summary_commit and before kukulu_flight_archive. Returns { dir, files, manifest, fingerprint, commit, verify, push }.",
    inputSchema: S({ evidence: { type: "array", items: { type: "string" }, description: "repo-relative paths of tracked files to include as evidence (conformance results, fuzz logs); each is copied to evidence/<path> in the bundle" } }),
    fn: attest,
  },
  { name: "kukulu_flight_archive", description: "Archive a summarized flight so the repository can run its next flight: move PLAN, PROGRESS, HANDOFF, REVIEW, SUMMARY, kukulu.json, .kukulu/state.json and .kukulu/feedback.jsonl into docs/flights/<slug>/ and docs/attestation/ into docs/flights/<slug>/attestation/ (copying SPEC.md, which stays), write a fresh state.json, commit 'chore: archive flight <slug>' and push per policy. slug defaults to the 'flight' key in docs/kukulu.json. Refused unless the flight is summarized, no run is armed, and the tree is clean. All-or-nothing. Returns { slug, dir, moved, copied, commit, push }.", inputSchema: S({ slug: { type: "string", description: "lowercase letters, digits and - (at most 40 characters); defaults to docs/kukulu.json's flight" } }), fn: flightArchive },
  { name: "kukulu_pr_finalize", description: "End a flight. Checks that every commit since the merge base with baseBranch is signed (judged from the commits, not from state): if so, marks the draft PR ready and, unless breaking is true, enables auto-merge (gh pr merge --auto, never an immediate merge), per policies.finalize and policies.mergeMethod. If any commit is unsigned the PR stays a draft, state.awaitingSigning is recorded, the steps are appended to SUMMARY.md, and kukulu_next reports done until it is resolved. breaking is required on the first call. Returns { signed, unsigned, ready, merge, breaking, awaitingSigning, resigned, push, pr, next? }; merge is enabled, skipped: breaking, skipped: policy, skipped: no pull request, skipped: awaiting signing or unavailable: <why>.", inputSchema: S({ breaking: { type: "boolean", description: "whether this flight is a breaking change, so its PR must not auto-merge; required on the first call, remembered after" }, resign: { type: "boolean", description: "HUMAN-INITIATED ONLY: never pass this on your own. Re-sign every commit of the branch (git rebase -f --rebase-merges --gpg-sign), force-push with lease, then finalize. For an operator who has unlocked the signing agent after an awaiting-signing result" } }), fn: prFinalize },
  {
    name: "kukulu_agents_sync",
    description: "Generate .claude/agents/kukulu-<role>.md from the merged routing config (plugin defaults < global file < profile < docs/kukulu.json roles). Writes only files whose content changed, excludes them from git, and returns the resolved per-role table. `restartRequired` is true only when this is the directory's first population and a changed role's model cannot be named directly by the Agent tool. Also ensures the MCP allow rule in .claude/settings.local.json (`permissions` in the result), without which a subagent's first kukulu_status call is denied under any permission mode.",
    inputSchema: S({}),
    fn: agentsSync,
  },
  { name: "kukulu_config_show", description: "The merged routing config with the source of every role/key (default | global | profile:<name> | project) and the global file path. Read-only.", inputSchema: S({}), fn: configShow },
];

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function handle(req) {
  const { id, method, params } = req;
  const reply = (result) => id !== undefined && send({ jsonrpc: "2.0", id, result });
  const fail = (code, message) => id !== undefined && send({ jsonrpc: "2.0", id, error: { code, message } });
  switch (method) {
    case "initialize":
      return reply({
        protocolVersion: params?.protocolVersion || "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "kukulu", version: VERSION },
      });
    case "notifications/initialized":
    case "notifications/cancelled":
      return;
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) return fail(-32602, `unknown tool ${params?.name}`);
      try {
        checkLayout();
        const result = tool.fn(params?.arguments || {});
        return reply({ content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
      } catch (e) {
        const text = e instanceof ToolError || e instanceof CleanroomError ? e.message : `${e.message}\n${e.stack}`;
        if (e instanceof ToolError && e.data !== undefined) return reply({ content: [{ type: "text", text }], isError: true, structuredContent: e.data });
        return reply({ content: [{ type: "text", text }], isError: true });
      }
    }
    default:
      return fail(-32601, `method not found: ${method}`);
  }
}

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }); continue; }
    try { handle(msg); } catch (e) { if (msg.id !== undefined) send({ jsonrpc: "2.0", id: msg.id, error: { code: -32603, message: e.message } }); }
  }
});
process.stdin.on("end", () => process.exit(0));
