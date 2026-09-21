#!/usr/bin/env node
// Foundry MCP server — the deterministic half of the pipeline.
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

const ROOT = path.resolve(process.env.FOUNDRY_PROJECT_DIR || process.cwd());
const P = {
  spec: path.join(ROOT, "docs", "SPEC.md"),
  plan: path.join(ROOT, "docs", "PLAN.md"),
  progress: path.join(ROOT, "docs", "PROGRESS.md"),
  handoff: path.join(ROOT, "docs", "HANDOFF.md"),
  review: path.join(ROOT, "docs", "REVIEW.md"),
  summary: path.join(ROOT, "docs", "SUMMARY.md"),
  config: path.join(ROOT, "docs", "foundry.json"),
  stateDir: path.join(ROOT, ".foundry"),
  state: path.join(ROOT, ".foundry", "state.json"),
  lock: path.join(ROOT, ".foundry", "implement.lock"),
  gitignore: path.join(ROOT, ".gitignore"),
  agentsDir: path.join(ROOT, ".claude", "agents"),
  settings: path.join(ROOT, ".claude", "settings.json"),
  settingsLocal: path.join(ROOT, ".claude", "settings.local.json"),
};

// The one rule an unattended flight needs before its first foundry_status
// call: without it, a subagent's MCP tool call is denied under every
// permission mode, and the flight stalls silently (F-03). Named once here so
// every place that writes or documents it says the same thing.
const MCP_ALLOW_RULE = "mcp__plugin_foundry_foundry";

// The plugin's own root — where agents/*.md ships — derived from this file's
// own location rather than ROOT, because ROOT is the *project* Foundry is
// operating on and is almost never the same directory as the installed
// plugin.
const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Keep in sync with .claude-plugin/plugin.json and package.json; test/plugin.mjs checks it.
const VERSION = "0.2.0";

const TASK_ID = /\b[PR]\d+-\d+\b/g;
const TASK_LINE = /^- \[( |~|x|!|-)\] ([PR]\d+-\d+)(?: (.*))?$/;
const STATE_NAMES = { " ": "todo", "~": "inProgress", x: "done", "!": "blocked", "-": "skipped" };

// ---------------------------------------------------------------- utilities

class ToolError extends Error {}

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

function git(args, { allowFail = false } = {}) {
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0 && !allowFail) {
    throw new ToolError(`git ${args.join(" ")} failed: ${(r.stderr || r.stdout || "").trim()}`);
  }
  return { ok: r.status === 0, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
}

function gitCommitIfChanged(paths, message) {
  const rels = paths.map(rel);
  git(["add", "-A", "--", ...rels]);
  const staged = git(["diff", "--cached", "--name-only", "--", ...rels]).out;
  if (!staged) return null;
  git(["commit", "-q", "-m", message, "--", ...rels]);
  return git(["rev-parse", "--short", "HEAD"]).out;
}

/**
 * Every currently untracked path, one per file (never a rolled-up
 * directory), exactly as `git status --porcelain` prints it — the same
 * shape `porcelainExcluding` matches against.
 */
function untrackedPaths() {
  return git(["status", "--porcelain", "--untracked-files=all"])
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
function porcelainExcludingPreexisting(ignore) {
  const set = new Set(ignore || []);
  return git(["status", "--porcelain", "--untracked-files=all"])
    .out.split("\n")
    .filter(Boolean)
    .filter((l) => !(l.startsWith("?? ") && set.has(l.slice(3))));
}

function loadConfig() {
  if (!exists(P.config)) return null;
  try {
    return JSON.parse(read(P.config));
  } catch (e) {
    throw new ToolError(`docs/foundry.json is not valid JSON: ${e.message}`);
  }
}

const SIGNING_POLICIES = ["auto", "off", "required"];
const PR_POLICIES = ["draft", "none"];
const POLICY_KEYS = ["signing", "push", "pr"];

/** Validate `docs/foundry.json`'s `policies` block; throws, never defaults a bad value away. */
function validatePolicies(policies) {
  if (policies === undefined) return;
  if (typeof policies !== "object" || policies === null || Array.isArray(policies)) {
    throw new ToolError("docs/foundry.json 'policies' must be an object");
  }
  for (const key of Object.keys(policies)) {
    if (!POLICY_KEYS.includes(key)) throw new ToolError(`docs/foundry.json policies has an unknown key '${key}'`);
  }
  if (policies.signing !== undefined && !SIGNING_POLICIES.includes(policies.signing)) {
    throw new ToolError(`docs/foundry.json policies.signing must be one of ${SIGNING_POLICIES.join(", ")}`);
  }
  if (policies.push !== undefined && typeof policies.push !== "boolean") {
    throw new ToolError("docs/foundry.json policies.push must be a boolean");
  }
  if (policies.pr !== undefined && !PR_POLICIES.includes(policies.pr)) {
    throw new ToolError(`docs/foundry.json policies.pr must be one of ${PR_POLICIES.join(", ")}`);
  }
}

/**
 * Normalise a verify/extraVerify/build entry to `{ cmd, timeoutMs }`. A bare
 * string takes `defaultTimeoutMs`; `{ cmd, timeoutMs }` may override it.
 * Throws on anything else, a missing `cmd`, or a non-positive integer
 * `timeoutMs` — a plan can give one slow end-to-end command a longer
 * timeout without lifting the timeout for everything else.
 */
function normalizeCommand(entry, defaultTimeoutMs, where) {
  if (typeof entry === "string") return { cmd: entry, timeoutMs: defaultTimeoutMs };
  if (entry && typeof entry === "object" && !Array.isArray(entry)) {
    if (typeof entry.cmd !== "string" || !entry.cmd) throw new ToolError(`${where} is missing 'cmd'`);
    const timeoutMs = entry.timeoutMs === undefined ? defaultTimeoutMs : entry.timeoutMs;
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new ToolError(`${where}.timeoutMs must be a positive integer`);
    return { cmd: entry.cmd, timeoutMs };
  }
  throw new ToolError(`${where} must be a command string or { cmd, timeoutMs }`);
}

const CONSTRAINT_KEYS = ["id", "description", "paths", "exclude", "pattern", "flags", "shouldMatch", "shouldNotMatch"];

/**
 * Validate `docs/foundry.json`'s `constraints` array: every rule must carry
 * proof that its own check works, so a grep with a blind spot fails its own
 * fixture instead of passing silently (F-14). Never checks the pattern
 * against real files — that is `checkConstraints`'s job at `foundry_verify`
 * time — only that the rule is well-formed.
 */
function validateConstraints(constraints) {
  if (constraints === undefined) return;
  if (!Array.isArray(constraints)) throw new ToolError("docs/foundry.json 'constraints' must be an array");
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
  const c = loadConfig() || {};
  validatePolicies(c.policies);
  validateConstraints(c.constraints);
  const commandTimeoutMs = c.commandTimeoutMs || 10 * 60 * 1000;
  const norm = (entry, i, where) => normalizeCommand(entry, commandTimeoutMs, `docs/foundry.json ${where}[${i}]`);
  return {
    verify: (c.verify || []).map((e, i) => norm(e, i, "verify")),
    extraVerify: Object.fromEntries(
      Object.entries(c.extraVerify || {}).map(([prefix, arr]) => [prefix, (arr || []).map((e, i) => norm(e, i, `extraVerify['${prefix}']`))]),
    ),
    build: (c.build || []).map((e, i) => norm(e, i, "build")),
    baseBranch: c.baseBranch || "main",
    branchPrefix: c.branchPrefix || "build/",
    maxRounds: Number.isInteger(c.maxRounds) ? c.maxRounds : 3,
    maxRoundsHard: Number.isInteger(c.maxRoundsHard) ? c.maxRoundsHard : 6,
    commandTimeoutMs,
    guardCap: Number.isInteger(c.guardCap) ? c.guardCap : 60,
    constraints: c.constraints || [],
    policies: {
      signing: c.policies?.signing ?? "auto",
      push: c.policies?.push ?? true,
      pr: c.policies?.pr ?? "draft",
    },
  };
}

// ---------------------------------------------------------------- routing config
//
// Per-role model routing (v0.2.0): which model and effort each of the four
// stage roles runs with, merged from the plugin's own defaults (agents/*.md),
// an optional global file, an optional named profile inside it, and an
// optional project override in docs/foundry.json. foundry_agents_sync turns
// the merged result into .claude/agents/foundry-<role>.md files that Claude
// Code will actually spawn; foundry_next and foundry_status read the merge
// without writing anything.

const ROLES = ["planner", "implementer", "reviewer", "summarizer"];
const ROLE_KEYS = ["model", "effort"];
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const ANTHROPIC_ALIASES = ["fable", "opus", "sonnet", "haiku", "inherit"];
const PERMISSION_MODES = ["default", "acceptEdits", "auto", "dontAsk", "bypassPermissions", "plan", "manual"];
const GLOBAL_KEYS = ["roles", "profiles", "profile", "permissionMode"];

const isAnthropicModel = (m) => ANTHROPIC_ALIASES.includes(m) || m.startsWith("claude-");

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
  if (process.env.FOUNDRY_CONFIG) return path.resolve(process.env.FOUNDRY_CONFIG);
  if (process.env.XDG_CONFIG_HOME) return path.join(process.env.XDG_CONFIG_HOME, "foundry", "config.json");
  return path.join(os.homedir(), ".config", "foundry", "config.json");
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

/** `where` names the block itself, e.g. "global config <path> roles" or "docs/foundry.json roles". */
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
  if (process.env.FOUNDRY_PROFILE) {
    profile = process.env.FOUNDRY_PROFILE;
    profileSource = "env";
  } else if (global.data.profile) {
    profile = global.data.profile;
    profileSource = "global";
  }
  if (profile !== null && !(profile in (global.data.profiles || {}))) {
    const src = profileSource === "env" ? `FOUNDRY_PROFILE=${profile}` : `"profile": "${profile}" in ${global.path}`;
    const globalDesc = global.present ? global.path : `${global.path} (does not exist)`;
    throw new ToolError(`${src} selects a profile, but ${globalDesc} has no profiles.${profile} entry`);
  }

  const project = loadConfig() || {};
  validateRolesBlock(project.roles, "docs/foundry.json roles");
  validatePermissionMode(project.permissionMode, "docs/foundry.json permissionMode");

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

/** The exact text foundry_agents_sync would write for one role's generated agent. */
function renderAgentFile(role, resolved, permissionMode) {
  const agent = pluginAgent(role);
  const fm = agent.frontmatter;
  const lines = ["---", `name: foundry-${role}`, `description: ${yamlScalar(fm.description)}`, `model: ${resolved.model}`];
  if (resolved.effort !== undefined) lines.push(`effort: ${resolved.effort}`);
  lines.push(`permissionMode: ${permissionMode}`);
  if (fm.tools) lines.push(`tools: ${fm.tools}`);
  lines.push("skills:");
  for (const s of fm.skills || []) lines.push(`  - ${s}`);
  lines.push(`color: ${fm.color}`, "---");
  const body = agent.body.replace(/^\n+/, "").replace(/\s+$/, "") + "\n";
  return `${lines.join("\n")}\n<!-- generated by foundry_agents_sync; edit config, not this file -->\n\n${body}`;
}

/** A ready-to-print Markdown table of the resolved per-role routing. */
function routingTable(r) {
  const rows = ROLES.map((role) => {
    const e = r.roles[role];
    const effort = e.effort !== undefined ? e.effort : "–";
    const source = e.source.model === e.source.effort ? e.source.model : `model:${e.source.model} effort:${e.source.effort}`;
    return `| ${role} | foundry-${role} | ${e.model} | ${effort} | ${source} |`;
  });
  return ["| role | agent | model | effort | source |", "|---|---|---|---|---|", ...rows].join("\n");
}

/** Roles whose generated agent file currently exists on disk. */
function agentsOnDisk() {
  return ROLES.filter((role) => exists(path.join(P.agentsDir, `foundry-${role}.md`)));
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
    const file = path.join(P.agentsDir, `foundry-${role}.md`);
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
      ROLES.map((role) => [role, { agent: `foundry-${role}`, model: r.roles[role].model, effort: r.roles[role].effort, source: r.roles[role].source }]),
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
 * Write .claude/agents/foundry-<role>.md for every role from the resolved
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
    const file = path.join(P.agentsDir, `foundry-${role}.md`);
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
  const restartRequired = agentsDirCreatedThisProcess && changed.some((role) => !isAnthropicModel(r.roles[role].model));

  const permissions = ensureMcpAllowRule();

  let excludeResult;
  if (gitFacts().inRepo) {
    // Claude Code gitignores .claude/settings.local.json only when it
    // creates the file itself; a copy this sync creates (or already found)
    // needs the same per-clone exclusion the agent files get, since it
    // encodes a person's own permission grant, not the project's.
    const addedAgents = ensureLineInFile(gitPath("info/exclude"), ".claude/agents/foundry-*.md");
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
      ROLES.map((role) => [role, { agent: `foundry-${role}`, model: r.roles[role].model, effort: r.roles[role].effort, source: r.roles[role].source }]),
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
  policies: { signing: "auto", push: true, pr: "draft" },
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
  const lines = read(P.progress).split("\n");
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
      if (m) tasks.push({ line: i, state: m[1], id: m[2], title: (m[3] || "").trim() });
    }
  });
  if (tasksStart < 0) throw new ToolError("docs/PROGRESS.md has no '## Tasks' section");
  if (tasksEnd < 0) tasksEnd = lines.length;
  // Log entries: "### <ID> — <sha or word>" followed by body until next ###
  const logs = {};
  if (logStart >= 0) {
    let cur = null;
    for (let i = logStart + 1; i < lines.length; i++) {
      const h = lines[i].match(/^### ([PR]\d+-\d+)\s+—\s+(.*)$/);
      if (h) { cur = h[1]; logs[cur] = (logs[cur] ? logs[cur] + "\n\n" : "") + lines[i]; continue; }
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
  pr.lines[t.line] = `- [${state}] ${t.id}${t.title ? " " + t.title : ""}`;
  t.state = state;
}

function appendLog(pr, id, stamp, body) {
  if (pr.logStart < 0) { pr.lines.push("", "## Log"); pr.logStart = pr.lines.length - 1; }
  while (pr.lines.length && pr.lines[pr.lines.length - 1].trim() === "") pr.lines.pop();
  pr.lines.push("", `### ${id} — ${stamp}`, body.replace(/\s+$/, ""));
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
  else pr.lines.splice(1, 0, `${key}: ${value}`);
}

const writeProgress = (pr) => write(P.progress, pr.lines.join("\n").replace(/\s*$/, "\n"));

// ---------------------------------------------------------------- PLAN.md

function planTask(id) {
  if (!exists(P.plan)) throw new ToolError("docs/PLAN.md does not exist");
  const lines = read(P.plan).split("\n");
  const start = lines.findIndex((l) => l.startsWith(`### ${id}:`));
  if (start < 0) throw new ToolError(`task ${id} has no '### ${id}: <title>' heading in docs/PLAN.md`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^###? /.test(lines[i])) { end = i; break; }
  }
  const text = lines.slice(start, end).join("\n").replace(/\s+$/, "");
  const dep = text.match(/\*\*Depends on:\*\*\s*(.*)/i);
  const depends = dep && !/^\s*none\b/i.test(dep[1]) ? Array.from(dep[1].matchAll(TASK_ID), (m) => m[0]) : [];
  const files = (text.match(/\*\*Files touched:\*\*\s*([\s\S]*?)(?=\n\*\*|$)/i) || [])[1] || "";
  return { id, title: lines[start].slice(`### ${id}:`.length).trim(), text, depends, files: files.trim() };
}

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
 * foundry_run_start writes from 0.3.0 and the legacy bare-number form a
 * 0.2.x run may have left armed. `null` when there is no lock to read.
 */
function lockCounter() {
  return exists(P.lock) ? parseLock().count : null;
}

/**
 * Reset the guard's re-block counter to zero on every task state change
 * (foundry_task_done, foundry_task_block, foundry_run_start on resume), so
 * the cap bounds re-blocks *since the last time work actually moved*
 * rather than accumulating over the whole run.
 */
function resetLockCounter() {
  if (!exists(P.lock)) return;
  const lock = parseLock();
  write(P.lock, `${lock.json ? JSON.stringify({ ...lock.json, count: 0 }) : "0"}\n`);
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
    reviewRoundsInPlan: reviewRoundCount(),
    branch: null,
    started: null,
    counts: null,
    blocked: [],
    skipped: [],
  };
  if (out.progressPresent) {
    const pr = parseProgress();
    out.branch = pr.branch;
    out.started = pr.started;
    out.counts = counts(pr.tasks);
    out.blocked = pr.tasks.filter((t) => t.state === "!").map((t) => t.id);
    out.skipped = pr.tasks.filter((t) => t.state === "-").map((t) => t.id);
  }
  if (out.reviewPresent) {
    const v = read(P.review).match(/\*\*Verdict\*\*:?\s*`?(APPROVED|CHANGES REQUESTED)`?/i) || read(P.review).match(/Verdict:?\s*`?(APPROVED|CHANGES REQUESTED)`?/i);
    out.reviewVerdictInFile = v ? v[1].toUpperCase() : null;
  }
  out.agentsGenerated = agentsOnDisk();
  out.agentsGeneratedThisSession = Array.from(generatedThisProcess);
  return out;
}

const AGENT = { plan: "foundry:planner", implement: "foundry:implementer", review: "foundry:reviewer", summarize: "foundry:summarizer" };
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
   * Agent tool can name directly (an Anthropic alias or a claude-* id), there
   * is no safe fallback and a restart is required.
   */
  const agentInfo = (name) => {
    const role = ROLE_OF_STAGE[name];
    const fallbackAgent = role ? AGENT[name] : null;
    if (!role) return { agent: null, agentFallback: false, fallbackAgent: null, restartRequired: false };
    const onDisk = exists(path.join(P.agentsDir, `foundry-${role}.md`));
    const agentFallback = !onDisk || agentsDirCreatedThisProcess;
    const model = routing.roles[role].model;
    if (agentFallback && !isAnthropicModel(model)) {
      return { agent: null, agentFallback: true, fallbackAgent, restartRequired: true };
    }
    return { agent: onDisk ? `foundry-${role}` : fallbackAgent, agentFallback, fallbackAgent, restartRequired: false };
  };
  const modelFor = (name) => {
    const role = ROLE_OF_STAGE[name];
    return role ? routing.roles[role].model : null;
  };
  // Read fresh from foundry.json rather than state, so the sentence is
  // accurate even before this round's foundry_run_start has recorded
  // state.policies (round 0, before the implementer's first call).
  const policySentence = `Run policies: signing=${c.policies.signing}, push=${c.policies.push ? "on" : "off"}, pr=${c.policies.pr}.`;
  const stage = (name, reason, extra = {}) => {
    const info = agentInfo(name);
    return {
      stage: name,
      agent: info.agent,
      agentFallback: info.agentFallback,
      fallbackAgent: info.fallbackAgent,
      restartRequired: info.restartRequired,
      model: modelFor(name),
      round: st.round,
      reviewRound: st.round + 1,
      reason,
      prompt: PROMPTS[name] ? PROMPTS[name](st.round, s, policySentence, st.round + 1) : null,
      ...extra,
    };
  };

  if (!s.specPresent) return stage("halt", "docs/SPEC.md is missing; nothing to build from");
  if (st.halted) return stage("halt", st.halted);
  if (!s.planPresent || !s.progressPresent || !s.configPresent) {
    return stage("plan", "no plan on disk (docs/PLAN.md, docs/PROGRESS.md and docs/foundry.json are all required)");
  }
  const open = s.counts.open;
  // The round cap decision is made once, by foundry_review_submit, and
  // recorded as state.halted (checked above) — next() never re-derives it,
  // so a converging flight is never second-guessed here.
  if (open > 0) return stage("implement", `${open} open task(s) in docs/PROGRESS.md`);
  if (s.lockPresent) return stage("implement", "implementation lock present but no open tasks: the run stopped before foundry_run_finish; finish the handoff");
  if (!st.implemented) return stage("implement", "no handoff recorded for this round");
  if (!st.reviewed) return stage("review", `round ${st.round} implemented and not yet reviewed`);
  if (st.verdict === "CHANGES REQUESTED") {
    return stage("halt", "review requested changes but no fix tasks are open; foundry_review_submit should have queued them");
  }
  if (st.verdict === "APPROVED" && !st.summarized) return stage("summarize", "review approved; summary not yet written");
  if (st.summarized) return stage("done", `flight complete after ${st.round} review round(s); branch ${s.branch} is ready for a human to merge`);
  return stage("halt", "unrecognised state; run foundry_status");
}

const PROMPTS = {
  plan: () =>
    "Run the Foundry plan stage for this repository. Read docs/SPEC.md and everything else in docs/ in full, then produce docs/PLAN.md, docs/PROGRESS.md, docs/foundry.json and CLAUDE.md exactly as your plan-build instructions specify, commit them, and report. Do not write implementation code.",
  implement: (round, s, policies) =>
    `Run the Foundry implement stage. ${round === 0 ? "This is the initial build." : `This is review-fix round ${round}; the open tasks are R${round}-* fix tasks queued by the reviewer.`} Call foundry_run_start, then loop on foundry_task_next until it reports done, then write docs/HANDOFF.md and call foundry_run_finish. You are unattended; never ask a question and never stop with open tasks. ${s.counts ? `${s.counts.open} task(s) are open.` : ""} ${policies}`,
  review: (round, s, policies, reviewRound) =>
    `Run the Foundry review stage. This review is round ${reviewRound}; write \`Round: ${reviewRound}\` on the second line of docs/REVIEW.md, and use \`R${reviewRound}-<nn>\` when a fix task's dependsOn must reference another fix task in the same submission. Review the whole build branch against docs/SPEC.md and docs/PLAN.md as your review-build instructions specify, write docs/REVIEW.md, and call foundry_review_submit exactly once with your verdict. Do not fix code yourself. ${policies}`,
  summarize: (round, s, policies) =>
    `Run the Foundry summarize stage. The review is APPROVED. Write docs/SUMMARY.md as your summarize instructions specify and call foundry_summary_commit. Do not merge. ${policies}`,
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
  const probe = spawnSync("git", ["commit-tree", "-S", "HEAD^{tree}", "-m", "foundry signing probe"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 30_000,
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

function runStart() {
  for (const [k, p] of Object.entries({ spec: P.spec, plan: P.plan, progress: P.progress, config: P.config })) {
    if (!exists(p)) throw new ToolError(`${rel(p)} is missing (${k}); run the plan stage first`);
  }
  const c = cfg();
  const g = gitFacts();
  if (!g.inRepo) throw new ToolError("not a git repository");
  const pr = parseProgress();
  const st = loadState();

  let branch = g.branch;
  let basePush;
  if (exists(P.lock) && pr.branch && !pr.branch.startsWith("(")) {
    resetLockCounter();
    return { alreadyStarted: true, branch, counts: counts(pr.tasks), round: st.round, policies: st.policies, signing: st.signing };
  }
  if (branch === c.baseBranch) {
    // Untracked files never block a run from starting: branching off HEAD
    // does not touch them, and they are recorded as pre-existing below
    // regardless (F-09). Only uncommitted changes to *tracked* files are
    // grounds to refuse — those would otherwise ride along into a task's
    // first commit or be stranded on a branch nobody asked to switch to.
    const trackedDirty = git(["status", "--porcelain", "--untracked-files=no"]).out !== "";
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
    throw new ToolError(`on branch '${branch}'; runs start from '${c.baseBranch}' or an existing '${c.branchPrefix}*' branch`);
  }

  // Snapshot what is untracked *before* this call's own writes (starting
  // with .gitignore below) can create anything new — otherwise a freshly
  // created .gitignore would be misfiled as if it predated the run.
  const preexistingUntracked = untrackedPaths();

  // .gitignore the lock, arm it, stamp PROGRESS, commit.
  ensureLineInFile(P.gitignore, ".foundry/implement.lock");
  fs.mkdirSync(P.stateDir, { recursive: true });
  write(P.lock, `${JSON.stringify({ count: 0, armedAt: new Date().toISOString(), round: st.round, cap: c.guardCap })}\n`);
  if (!pr.branch || pr.branch.startsWith("(")) setHeader(pr, "Branch", branch);
  if (!pr.started || pr.started.startsWith("(")) setHeader(pr, "Started", new Date().toISOString());
  writeProgress(pr);
  // Whatever was untracked before this call is not this run's business: not
  // a deliverable to commit, not debris to clean up, not a signal to act on
  // (F-09, F-17).
  st.preexistingUntracked = preexistingUntracked;
  st.policies = c.policies;
  st.signing = probeSigning(c.policies.signing);
  st.implemented = false; st.reviewed = false; st.verdict = null;
  saveState(st);
  const sha = gitCommitIfChanged([P.gitignore, P.progress, P.state], st.round === 0 ? "chore: start implementation run" : `chore: start review-fix round ${st.round}`);
  return { alreadyStarted: false, branch, commit: sha, counts: counts(pr.tasks), round: st.round, policies: st.policies, signing: st.signing, basePush };
}

function taskNext() {
  const pr = parseProgress();
  const skipped = [];
  for (;;) {
    const pick = pr.tasks.find((t) => t.state === "~") || pr.tasks.find((t) => t.state === " ");
    if (!pick) {
      writeProgress(pr);
      if (skipped.length) gitCommitIfChanged([P.progress], `progress: skip ${skipped.map((s) => s.id).join(", ")}`);
      return { done: true, counts: counts(pr.tasks), skipped };
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
    const dependencyLogs = {};
    for (const d of task.depends) if (pr.logs[d]) dependencyLogs[d] = pr.logs[d];
    return {
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
    };
  }
}

function taskDone({ id, log }) {
  if (!id || !log) throw new ToolError("id and log are required");
  const pr = parseProgress();
  const t = pr.tasks.find((x) => x.id === id);
  if (!t) throw new ToolError(`task ${id} not in docs/PROGRESS.md`);
  if (t.state !== "~") throw new ToolError(`task ${id} is '${STATE_NAMES[t.state]}', not in progress; call foundry_task_next first`);
  const subject = git(["log", "-1", "--format=%s"]).out;
  if (!subject.startsWith(`${id}:`)) {
    throw new ToolError(`HEAD commit '${subject}' is not this task's commit; commit the task as '${id}: <title>' before calling foundry_task_done`);
  }
  const st = loadState();
  const dirtyOutsideProgress = porcelainExcludingPreexisting(st.preexistingUntracked).filter((l) => !l.endsWith("docs/PROGRESS.md"));
  if (dirtyOutsideProgress.length) {
    throw new ToolError(
      `uncommitted changes remain after the task commit:\n${dirtyOutsideProgress.join("\n")}\nCommit them as part of ${id} or \`git checkout --\`/\`git clean\` them.`,
    );
  }
  const sha = git(["rev-parse", "--short", "HEAD"]).out;
  setTaskState(pr, id, "x");
  appendLog(pr, id, sha, log);
  writeProgress(pr);
  const psha = gitCommitIfChanged([P.progress], `progress: ${id} done`);
  resetLockCounter();
  return { id, taskCommit: sha, progressCommit: psha, counts: counts(pr.tasks), guardReset: true };
}

function taskBlock({ id, reason }) {
  if (!id || !reason) throw new ToolError("id and reason are required");
  let pr = parseProgress();
  const t = pr.tasks.find((x) => x.id === id);
  if (!t) throw new ToolError(`task ${id} not in docs/PROGRESS.md`);
  const st = loadState();
  // Discard whatever the attempt left behind; the lock is gitignored so
  // clean leaves it alone, and -e spares every path that was already
  // untracked before this run started (F-09) — `git clean` would otherwise
  // delete it outright, which is worse than merely being tempted to move it.
  git(["reset", "-q", "--hard", "HEAD"]);
  git(["clean", "-qfd", ...(st.preexistingUntracked || []).flatMap((p) => ["-e", gitCleanExcludePattern(p)])]);
  pr = parseProgress();
  setTaskState(pr, id, "!");
  appendLog(pr, id, "blocked", `BLOCKED: ${reason}`);
  writeProgress(pr);
  const psha = gitCommitIfChanged([P.progress], `progress: ${id} blocked`);
  resetLockCounter();
  return { id, progressCommit: psha, counts: counts(pr.tasks) };
}

function runShell(cmd, timeoutMs) {
  const r = spawnSync(cmd, { cwd: ROOT, shell: true, encoding: "utf8", timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
  const tail = (s, n = 60) => (s || "").replace(/\s+$/, "").split("\n").slice(-n).join("\n");
  return {
    command: cmd,
    ok: r.status === 0 && !r.error,
    exitCode: r.status,
    timedOut: r.error?.code === "ETIMEDOUT",
    timeoutMs,
    stdoutTail: tail(r.stdout),
    stderrTail: tail(r.stderr),
  };
}

/** Does `file` (a repo-relative path) fall under path or exclude prefix `p`? */
const pathUnder = (file, p) => file === p || file.startsWith(p.endsWith("/") ? p : `${p}/`);

/**
 * Run every constraint rule: first self-test it against its own fixtures —
 * a `shouldMatch` line that fails to match, or a `shouldNotMatch` line that
 * matches, fails the rule outright and is never trusted to scan anything
 * (F-14) — then scan every *tracked* file under its `paths` minus
 * `exclude` (`git ls-files`, so untracked and ignored files are never
 * scanned), line by line. Line-based only; no multi-line patterns.
 */
function checkConstraints(constraints) {
  const testLine = (c, line) => new RegExp(c.pattern, c.flags || "").test(line);
  const results = constraints.map((c) => {
    for (const line of c.shouldMatch) {
      if (!testLine(c, line)) return { id: c.id, ok: false, fixture: `shouldMatch ${JSON.stringify(line)} did not match`, hits: [] };
    }
    for (const line of c.shouldNotMatch) {
      if (testLine(c, line)) return { id: c.id, ok: false, fixture: `shouldNotMatch ${JSON.stringify(line)} matched`, hits: [] };
    }
    const listed = git(["ls-files", "--", ...c.paths], { allowFail: true });
    const files = listed.ok ? listed.out.split("\n").filter(Boolean) : [];
    const excluded = c.exclude || [];
    const hits = [];
    for (const file of files) {
      if (excluded.some((ex) => pathUnder(file, ex))) continue;
      const full = path.join(ROOT, file);
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

function verify({ files = [] } = {}) {
  const c = loadConfig();
  if (!c) throw new ToolError("docs/foundry.json is missing; the plan stage must write it");
  const cc = cfg();
  if (!cc.verify.length) throw new ToolError("docs/foundry.json has no 'verify' commands");
  // Constraints are whole-repo, always — `files` narrows which shell
  // commands' extras run, never what a constraint scans.
  const constraints = checkConstraints(cc.constraints);
  const cmds = [...cc.verify];
  const touched = Array.isArray(files) ? files : String(files).split(/[\s,]+/).filter(Boolean);
  for (const [prefix, extra] of Object.entries(cc.extraVerify)) {
    if (touched.some((f) => f.startsWith(prefix))) for (const x of extra) if (!cmds.some((c2) => c2.cmd === x.cmd)) cmds.push(x);
  }
  const results = cmds.map((c2) => runShell(c2.cmd, c2.timeoutMs));
  return { ok: constraints.ok && results.every((r) => r.ok), constraints, results };
}

/**
 * Push `branch` to `origin`, honouring the run's push policy. Never throws:
 * `"pushed"`, `"skipped: policy"`, `"skipped: no origin remote"`, or
 * `"failed: <git's first line>"` — every caller (F-18) treats a push the
 * same way a `foundry_run_finish` failure always has, as informational,
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
  const pr = parseProgress();
  const cnt = counts(pr.tasks);
  if (cnt.open > 0) throw new ToolError(`${cnt.open} task(s) still open; keep calling foundry_task_next`);
  if (!exists(P.handoff)) throw new ToolError("docs/HANDOFF.md does not exist; write it before calling foundry_run_finish");
  const st = loadState();
  const c = cfg();
  const g = gitFacts();
  const handoffCommit = gitCommitIfChanged([P.handoff], "chore: handoff for review");
  const dirtyLines = porcelainExcludingPreexisting(st.preexistingUntracked);
  if (dirtyLines.length) {
    throw new ToolError(`working tree is not clean:\n${dirtyLines.join("\n")}\nCommit them as part of the handoff or \`git checkout --\`/\`git clean\` them.`);
  }

  st.implemented = true; st.reviewed = false; st.verdict = null;
  saveState(st);
  const stateCommit = gitCommitIfChanged([P.state], `chore: round ${st.round} implemented`);

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
        const cr = spawnSync("gh", ["pr", "create", "--draft", "--title", title, "--body-file", P.handoff], { cwd: ROOT, encoding: "utf8" });
        pr_url = cr.status === 0 ? cr.stdout.trim() : `pr create failed: ${(cr.stderr || "").trim()}`;
      }
    }
  }
  if (exists(P.lock)) fs.unlinkSync(P.lock);
  const head = git(["rev-parse", "--short", "HEAD"]).out;
  return {
    branch: g.branch, base: g.base, head, handoffCommit, stateCommit, push, pr: pr_url, counts: cnt, round: st.round,
    readyLine: `READY FOR REVIEW — branch ${g.branch}, head ${head}, ${cnt.done} done / ${cnt.blocked} blocked / ${cnt.skipped} skipped of ${cnt.total}`,
  };
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
  const st = loadState();
  st.halted = reason;
  saveState(st);
  if (exists(P.lock)) fs.unlinkSync(P.lock);
  const commit = gitCommitIfChanged([P.state, P.progress], "chore: run halted");
  const g = gitFacts();
  const dirty = git(["status", "--porcelain"], { allowFail: true }).out !== "";
  return { halted: reason, branch: g.branch, head: g.head, commit, dirty };
}

function formatTask(id, t) {
  const list = (v) => (Array.isArray(v) ? v.join(", ") : String(v ?? ""));
  return [
    `### ${id}: ${t.title}`,
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

function reviewSubmit({ verdict, tasks = [], unblock = [] }) {
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
    st.rounds = [...st.rounds, { round: N, fixTasks: 0, unblocked: 0, verdict: "APPROVED", at: new Date().toISOString() }];
    saveState(st);
    const sha = gitCommitIfChanged([P.review, P.state], `review: round ${N} approved`);
    const push = pushBranch(gitFacts().branch, st.policies.push);
    return { verdict, round: st.round, commit: sha, push };
  }

  if (!tasks.length && !unblock.length) throw new ToolError("CHANGES REQUESTED requires at least one fix task or unblock");
  const pr = parseProgress();
  for (const t of tasks) {
    for (const k of ["title", "goal", "files", "tests"]) if (!t[k] || (Array.isArray(t[k]) && !t[k].length)) throw new ToolError(`fix task '${t.title || "?"}' is missing '${k}'`);
  }
  const ids = tasks.map((_, i) => `R${N}-${String(i + 1).padStart(2, "0")}`);
  // Every dependsOn must resolve to something that actually exists: an
  // already-known task, or one of this same submission's own new ids.
  for (const t of tasks) {
    for (const dep of t.dependsOn || []) {
      if (pr.tasks.some((x) => x.id === dep) || ids.includes(dep)) continue;
      throw new ToolError(`fix task '${t.title}' depends on '${dep}', which is neither an existing task in PROGRESS.md nor one of this submission's own ids (${ids.join(", ") || "none"})`);
    }
  }
  if (tasks.length) {
    const block = [``, `## Review fixes (round ${N})`, ``, ...tasks.map((t, i) => formatTask(ids[i], t) + "\n")].join("\n");
    write(P.plan, read(P.plan).replace(/\s*$/, "\n") + block);
    appendTaskLines(pr, tasks.map((t, i) => ({ id: ids[i], title: t.title })));
  }
  const unblocked = [];
  for (const u of unblock) {
    const id = typeof u === "string" ? u : u.id;
    const reason = typeof u === "string" ? "unblocked by reviewer" : u.reason || "unblocked by reviewer";
    const t = pr.tasks.find((x) => x.id === id);
    if (!t) throw new ToolError(`cannot unblock ${id}: not in PROGRESS.md`);
    if (t.state !== "!" && t.state !== "-") throw new ToolError(`cannot unblock ${id}: it is '${STATE_NAMES[t.state]}'`);
    setTaskState(pr, id, " ");
    appendLog(pr, id, `unblocked (round ${N})`, reason);
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
  st.rounds = [...st.rounds, { round: N, fixTasks: ids.length, unblocked: unblocked.length, verdict: "CHANGES REQUESTED", nonConverging, at: new Date().toISOString() }];
  const nonConvergingSoFar = st.rounds.filter((r) => r.nonConverging).length;
  const trail = st.rounds.filter((r) => r.verdict === "CHANGES REQUESTED").map((r) => r.fixTasks + r.unblocked).join(" → ");

  st.round = N; st.implemented = false; st.reviewed = true; st.verdict = "CHANGES REQUESTED";
  if (N > c.maxRoundsHard) {
    st.halted = `review round ${N} exceeds the hard cap maxRoundsHard=${c.maxRoundsHard} (findings per round: ${trail}); a human must decide whether to continue (edit .foundry/state.json to clear 'halted' and raise maxRoundsHard in docs/foundry.json)`;
  } else if (nonConvergingSoFar >= c.maxRounds) {
    st.halted = `round ${N} is non-converging (findings per round: ${trail}), the ${nonConvergingSoFar}th non-converging round, reaching maxRounds=${c.maxRounds}; a human must decide whether to continue (edit .foundry/state.json to clear 'halted' and raise maxRounds in docs/foundry.json)`;
  }
  saveState(st);
  const sha = gitCommitIfChanged([P.review, P.plan, P.progress, P.state], `review: round ${N}`);
  const push = pushBranch(gitFacts().branch, st.policies.push);
  return { verdict, round: N, fixTasks: ids, unblocked, commit: sha, halted: st.halted, counts: counts(pr.tasks), push };
}

function summaryCommit() {
  if (!exists(P.summary)) throw new ToolError("docs/SUMMARY.md does not exist");
  const st = loadState();
  if (st.verdict !== "APPROVED") throw new ToolError("summary can only be committed after an APPROVED review");
  st.summarized = true;
  saveState(st);
  const sha = gitCommitIfChanged([P.summary, P.state], "chore: build summary");
  const g = gitFacts();
  const push = pushBranch(g.branch, st.policies.push);
  return { commit: sha, branch: g.branch, base: g.base, head: g.head, rounds: st.round, push };
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
  { name: "foundry_status", description: "Everything the pipeline knows from disk: which docs exist, task counts by state, branch/base/head, lock, round, review verdict. Read-only.", inputSchema: S({}), fn: status },
  { name: "foundry_next", description: "Deterministic stage selection: returns { stage, agent, agentFallback, fallbackAgent, restartRequired, model, round, reason, prompt }. stage is plan | implement | review | summarize | done | halt. restartRequired is true only when the routed model cannot be reached without relaunching the session. Read-only.", inputSchema: S({}), fn: next },
  { name: "foundry_run_start", description: "Begin (or resume) an implementation run: create/reuse the build branch, arm the implement guard lock, stamp Branch/Started in PROGRESS.md, commit. Idempotent.", inputSchema: S({}), fn: runStart },
  { name: "foundry_task_next", description: "Select the next task (first [~], else first [ ]), auto-skip tasks whose dependencies are blocked, mark it [~], and return its PLAN.md text plus dependency log entries. Returns { done: true } when none remain.", inputSchema: S({}), fn: taskNext },
  { name: "foundry_task_done", description: "Mark a task [x] and append its log entry stamped with HEAD's sha. Requires HEAD's commit subject to start with '<id>:' and a clean tree. Commits PROGRESS.md.", inputSchema: S({ id: { type: "string" }, log: { type: "string", description: "Log entry body, under 15 lines" } }, ["id", "log"]), fn: taskDone },
  { name: "foundry_task_block", description: "Give up on a task: hard-reset uncommitted changes, mark it [!], log BLOCKED: <reason>, commit PROGRESS.md.", inputSchema: S({ id: { type: "string" }, reason: { type: "string", description: "what you tried / what fails / what you think the fix is" } }, ["id", "reason"]), fn: taskBlock },
  { name: "foundry_verify", description: "Self-tests and runs every docs/foundry.json constraint against the whole tracked repo, then runs the verify commands plus extraVerify commands for any path prefix the given files fall under. Returns constraint results and per-command exit status and output tails.", inputSchema: S({ files: { type: "array", items: { type: "string" }, description: "Files touched by the task (optional); narrows extraVerify only, never the constraint scan" } }), fn: verify },
  { name: "foundry_run_finish", description: "End an implementation run: requires zero open tasks and docs/HANDOFF.md; commits it, pushes and opens a draft PR unless policies say otherwise, disarms the lock, records the round as implemented.", inputSchema: S({}), fn: runFinish },
  {
    name: "foundry_run_halt",
    description: "Stop the flight for an operator-level reason the implementer cannot resolve (a dead signing agent, a full disk, a vanished base branch): records the reason, disarms the lock, commits state and PROGRESS.md if they changed. Never resets or cleans the tree.",
    inputSchema: S({ reason: { type: "string", description: "why the flight cannot continue" } }, ["reason"]),
    fn: runHalt,
  },
  {
    name: "foundry_review_submit",
    description: "Record a review verdict. APPROVED commits REVIEW.md. CHANGES REQUESTED assigns R<N>-<nn> ids, appends '## Review fixes (round N)' to PLAN.md, appends checkbox lines to PROGRESS.md, resets unblocked tasks, and commits 'review: round N'.",
    inputSchema: S({
      verdict: { type: "string", enum: ["APPROVED", "CHANGES REQUESTED"] },
      tasks: {
        type: "array",
        items: S({
          title: { type: "string" }, goal: { type: "string" }, files: { type: "array", items: { type: "string" } },
          constraints: { type: "string" }, tests: { type: "string" }, outOfScope: { type: "string" },
          verification: { type: "string" }, dependsOn: { type: "array", items: { type: "string" } },
        }, ["title", "goal", "files", "tests"]),
      },
      unblock: { type: "array", items: S({ id: { type: "string" }, reason: { type: "string" } }, ["id"]) },
    }, ["verdict"]),
    fn: reviewSubmit,
  },
  { name: "foundry_summary_commit", description: "Commit docs/SUMMARY.md and mark the flight complete. Only valid after an APPROVED review.", inputSchema: S({}), fn: summaryCommit },
  {
    name: "foundry_agents_sync",
    description: "Generate .claude/agents/foundry-<role>.md from the merged routing config (plugin defaults < global file < profile < docs/foundry.json roles). Writes only files whose content changed, excludes them from git, and returns the resolved per-role table. `restartRequired` is true only when this is the directory's first population and a changed role's model cannot be named directly by the Agent tool. Also ensures the MCP allow rule in .claude/settings.local.json (`permissions` in the result), without which a subagent's first foundry_status call is denied under any permission mode.",
    inputSchema: S({}),
    fn: agentsSync,
  },
  { name: "foundry_config_show", description: "The merged routing config with the source of every role/key (default | global | profile:<name> | project) and the global file path. Read-only.", inputSchema: S({}), fn: configShow },
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
        serverInfo: { name: "foundry", version: VERSION },
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
        const result = tool.fn(params?.arguments || {});
        return reply({ content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
      } catch (e) {
        const text = e instanceof ToolError ? e.message : `${e.message}\n${e.stack}`;
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
