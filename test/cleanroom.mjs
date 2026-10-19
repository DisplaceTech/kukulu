// Clean-room mode (0.7.0): the policy loader, the guard, the hash chain,
// checkpoints, the gate and scoring. The module under test, mcp/cleanroom.mjs,
// is pure, so most assertions call it directly; the tools and hooks that use
// it are exercised through the real server and the real hook scripts.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { finish, ok, eq, like, isError, ROOT, plannedRepo, withServer, runHook, mkDir, writeFile } from "./harness.mjs";
import { spawn, spawnSync } from "node:child_process";
import {
  CleanroomError, loadPolicy, policyHash,
  ENTRY_KEYS, KINDS, ZERO_HASH, TARGET_MAX, truncateTarget, canonical, entryHash, appendEntry, readEntries, verifyChain, logPathFor, targetOf, projectContext, entryFields,
} from "../mcp/cleanroom.mjs";

const EXAMPLE = fs.readFileSync(path.join(ROOT, "templates", "cleanroom.example.json"), "utf8");

/** The error loadPolicy throws for a policy object, or null when it loads. */
function refusal(policy) {
  try {
    loadPolicy(typeof policy === "string" ? policy : JSON.stringify(policy));
    return null;
  } catch (e) {
    if (!(e instanceof CleanroomError)) throw e;
    return e.message;
  }
}

const base = (extra = {}) => ({ version: 1, ...extra });
const pattern = (extra = {}) => ({ id: "p", pattern: "/build/", shouldMatch: ["/x/build/y"], shouldNotMatch: ["/x/deps/y"], ...extra });

// ---------------------------------------------------------------- loadPolicy

{
  const policy = loadPolicy(EXAMPLE);
  eq(policy.version, 1, "the example policy loads");
  eq(policy.deny.words.length, 7, "...with its seven denied words");
  eq(policy.deny.pathPatterns[0].id, "build-script-output", "...and its path pattern");
  eq(policy.lockdown.after, "P0-10", "...and its lockdown task");
  eq(loadPolicy('{"version":1}').deny.network, true, "deny.network defaults to true");
  const empty = loadPolicy('{"version":1}');
  eq(JSON.stringify([empty.deny.tools, empty.deny.paths, empty.deny.words, empty.allow.paths, empty.allow.urls, empty.protected]), "[[],[],[],[],[],[]]", "every list defaults to empty");
  eq(empty.lockdown.after, null, "...and lockdown.after to null");
  eq(loadPolicy('{"version":1,"deny":{"network":false}}').deny.network, false, "deny.network false is kept");
}

{
  const bytes = Buffer.from("hello policy");
  eq(policyHash(bytes), createHash("sha256").update(bytes).digest("hex"), "policyHash is the SHA-256 of the bytes");
  eq(policyHash("héllo"), createHash("sha256").update(Buffer.from("héllo", "utf8")).digest("hex"), "...and a string is hashed as UTF-8");
  like(policyHash(""), /^[0-9a-f]{64}$/, "...as 64 lowercase hex digits");
}

like(refusal("{nope"), /policy is not valid JSON/, "loadPolicy refuses invalid JSON");
like(refusal("[]"), /policy must be a JSON object/, "...a non-object");
like(refusal(base({ extra: 1 })), /policy has an unknown key 'extra'/, "...an unknown top-level key");
like(refusal({ version: 2 }), /policy version must be 1/, "...version 2");
like(refusal({}), /policy version must be 1/, "...a missing version");
like(refusal(base({ deny: { tools: "WebSearch" } })), /deny\.tools must be an array/, "...deny.tools that is not an array");
like(refusal(base({ deny: { words: ["a", "b", ""] } })), /deny\.words\[2\] must be a non-empty string/, "...an empty word, naming its index");
like(refusal(base({ deny: { paths: [1] } })), /deny\.paths\[0\] must be a non-empty string/, "...a non-string path");
like(refusal(base({ allow: { paths: [""] } })), /allow\.paths\[0\]/, "...an empty allow.paths entry");
like(refusal(base({ allow: { urls: {} } })), /allow\.urls must be an array/, "...allow.urls that is not an array");
like(refusal(base({ protected: [null] })), /protected\[0\] must be a non-empty string/, "...a non-string protected entry");
like(refusal(base({ deny: { network: "yes" } })), /deny\.network must be a boolean/, "...deny.network that is not a boolean");
like(refusal(base({ deny: { bogus: 1 } })), /deny has an unknown key 'bogus'/, "...an unknown deny key");
like(refusal(base({ allow: { bogus: 1 } })), /allow has an unknown key 'bogus'/, "...an unknown allow key");
like(refusal(base({ deny: 5 })), /deny must be an object/, "...a deny that is not an object");
like(refusal(base({ deny: { pathPatterns: [pattern({ bogus: 1 })] } })), /deny\.pathPatterns 'p' has an unknown key 'bogus'/, "...an unknown pathPatterns key");
like(refusal(base({ deny: { pathPatterns: [pattern(), pattern()] } })), /defines the id 'p' more than once/, "...a duplicate pattern id");
like(refusal(base({ deny: { commandPatterns: [pattern({ pattern: "(" })] } })), /deny\.commandPatterns 'p' has an invalid pattern/, "...an invalid regex");
like(refusal(base({ deny: { commandPatterns: [pattern({ flags: "zz" })] } })), /invalid pattern/, "...an invalid flag");
like(refusal(base({ deny: { pathPatterns: [{ id: "p", pattern: "x", shouldMatch: ["x"] }] } })), /at least one 'shouldNotMatch' fixture/, "...a pattern without shouldNotMatch");
like(refusal(base({ deny: { pathPatterns: [pattern({ shouldMatch: [] })] } })), /at least one 'shouldMatch' fixture/, "...a pattern with an empty shouldMatch");
like(refusal(base({ deny: { pathPatterns: [pattern({ shouldMatch: ["/x/deps/y"] })] } })), /deny\.pathPatterns 'p': shouldMatch "\/x\/deps\/y" did not match/, "...a shouldMatch fixture that does not match, naming the line");
like(refusal(base({ deny: { commandPatterns: [pattern({ shouldNotMatch: ["a/build/b"] })] } })), /deny\.commandPatterns 'p': shouldNotMatch "a\/build\/b" matched/, "...a shouldNotMatch fixture that matches, naming the line");
like(refusal(base({ lockdown: { after: "soon" } })), /lockdown\.after must be a task id/, "...lockdown.after that is not a task id");
like(refusal(base({ lockdown: { when: "P0-01" } })), /lockdown has an unknown key 'when'/, "...an unknown lockdown key");
eq(refusal(base({ lockdown: { after: "R2-01" } })), null, "lockdown.after accepts a fix-task id");
eq(refusal(base({ deny: { pathPatterns: [pattern({ flags: "gi" })] } })), null, "a global flag does not break fixture self-testing");

// ---------------------------------------------------------------- docs/kukulu.json: the cleanroom object

for (const [block, re, label] of [
  [{ policy: "/etc/policy.json" }, /cleanroom\.policy must be repo-relative/, "cleanroom.policy must be repo-relative: an absolute path is refused"],
  [{ policy: "../x" }, /cleanroom\.policy must be repo-relative/, "...and so is ../x"],
  [{ policy: "~/policy.json" }, /cleanroom\.policy must be repo-relative/, "...and ~"],
  [{ policy: "" }, /cleanroom\.policy must be a non-empty string/, "...and an empty one"],
  [{ other: 1 }, /cleanroom has an unknown key 'other'/, "cleanroom has an unknown key"],
  [{ signingKey: 3 }, /cleanroom\.signingKey must be a non-empty string/, "cleanroom.signingKey must be a string"],
  [[], /'cleanroom' must be an object/, "cleanroom must be an object"],
]) {
  const repo = plannedRepo({ config: { cleanroom: block } });
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_status"), re, label);
  });
}

{
  const repo = plannedRepo({ config: { cleanroom: { policy: "policy/cr.json", signingKey: "~/keys/k.pem" } } });
  await withServer(repo, async ({ call }) => {
    const st = await call("kukulu_status");
    ok(!st.error, "a valid cleanroom block is accepted");
  });
}

// ---------------------------------------------------------------- hook fast path (no policy)

const GUARD = path.join(ROOT, "scripts", "cleanroom-guard.mjs");
const LOGGER = path.join(ROOT, "scripts", "cleanroom-log.mjs");

{
  const repo = plannedRepo();
  const env = { CLAUDE_PROJECT_DIR: repo };
  const payload = { hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "/etc/passwd" }, cwd: repo };
  const g = runHook(GUARD, payload, env);
  eq(g.status + "|" + g.stdout + "|" + g.stderr, "0||", "with no policy the guard exits 0 with no output");
  const l = runHook(LOGGER, { ...payload, hook_event_name: "PostToolUse" }, env);
  eq(l.status + "|" + l.stdout + "|" + l.stderr, "0||", "...the logger exits 0 with no output");
  ok(!fs.existsSync(path.join(repo, ".kukulu", "cleanroom")), "...and neither creates .kukulu/cleanroom/");
  eq(runHook(GUARD, "not json at all", env).status, 0, "empty or invalid input is tolerated on the fast path");
  eq(runHook(GUARD, "", {}).status, 0, "...even with no CLAUDE_PROJECT_DIR (the working directory has no policy)");
  const viaCwd = runHook(GUARD, { cwd: repo }, {});
  eq(viaCwd.status, 0, "the project can come from the input's cwd");
}

{
  // The fast path must not even load mcp/cleanroom.mjs: a temp plugin copy whose module throws on import.
  const plugin = mkDir("kukulu-plugin-");
  fs.mkdirSync(path.join(plugin, "scripts"));
  fs.mkdirSync(path.join(plugin, "mcp"));
  for (const f of ["cleanroom-guard.mjs", "cleanroom-log.mjs"]) fs.copyFileSync(path.join(ROOT, "scripts", f), path.join(plugin, "scripts", f));
  fs.writeFileSync(path.join(plugin, "mcp", "cleanroom.mjs"), 'throw new Error("mcp/cleanroom.mjs was loaded");\n');
  const repo = plannedRepo();
  for (const script of ["cleanroom-guard.mjs", "cleanroom-log.mjs"]) {
    const r = runHook(path.join(plugin, "scripts", script), { cwd: repo }, { CLAUDE_PROJECT_DIR: repo });
    eq(r.status + "|" + r.stderr, "0|", `the fast path does not load mcp/cleanroom.mjs (${script})`);
  }
}

{
  // The 50 ms budget is a test bound, not a config key (SPEC 5.3, an ASSUMPTION): the median
  // hook run minus the median bare Node start, over ten runs each.
  const repo = plannedRepo();
  const median = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const time = (fn) => median(Array.from({ length: 10 }, () => {
    const t = process.hrtime.bigint();
    fn();
    return Number(process.hrtime.bigint() - t) / 1e6;
  }));
  const bare = time(() => spawnSync(process.execPath, ["-e", "0"]));
  for (const [name, script] of [["guard", GUARD], ["logger", LOGGER]]) {
    const hook = time(() => runHook(script, { cwd: repo }, { CLAUDE_PROJECT_DIR: repo }));
    ok(hook - bare < 50, `the ${name}'s fast path costs under 50 ms beyond Node's own startup (${(hook - bare).toFixed(1)} ms)`);
  }
}

{
  // With a policy present and no implementation yet, the guard fails closed; the logger never blocks.
  const repo = plannedRepo();
  writeFile(repo, "docs/cleanroom.json", EXAMPLE);
  const env = { CLAUDE_PROJECT_DIR: repo };
  const g = runHook(GUARD, { hook_event_name: "PreToolUse", tool_name: "Read", tool_input: {}, cwd: repo }, env);
  eq(g.status, 2, "with a policy present the guard denies until it is implemented");
  like(g.stderr, /^kukulu clean-room guard: guard internal error: the guard is not implemented yet/, "...saying why");
  eq(runHook(LOGGER, { hook_event_name: "PostToolUse", cwd: repo }, env).status, 0, "the logger exits 0 with a policy present");
  writeFile(repo, "docs/kukulu.json", JSON.stringify({ cleanroom: { policy: "policy/cr.json" } }));
  eq(runHook(GUARD, { cwd: repo }, env).status, 0, "a policy named in docs/kukulu.json is the one looked for (the default file no longer counts)");
  writeFile(repo, "policy/cr.json", EXAMPLE);
  eq(runHook(GUARD, { cwd: repo }, env).status, 2, "...and its presence turns the mode on");
  writeFile(repo, "docs/kukulu.json", "{ not json");
  eq(runHook(GUARD, { cwd: repo }, env).status, 2, "an unparseable docs/kukulu.json means the default policy path");
}

// ---------------------------------------------------------------- the hash chain

const tmpLog = () => path.join(mkDir("kukulu-chain-"), ".kukulu", "cleanroom", "log.jsonl");
const linesOf = (log) => fs.readFileSync(log, "utf8").split("\n").filter(Boolean);
const call = (n) => ({ kind: "allowed", stage: "implement", task: "P0-01", role: "session", tool: "Read", target: `/x/${n}`, decision: "allowed" });

{
  const log = tmpLog();
  const first = appendEntry(log, call(1));
  eq(first.seq, 1, "appendEntry writes seq 1");
  eq(first.prev, ZERO_HASH, "...with a 64-zero prev");
  eq(ZERO_HASH.length, 64, "ZERO_HASH is 64 characters");
  like(first.at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/, "...a millisecond UTC timestamp");
  eq(first.model, null, "...and every field the caller left out is null");
  const second = appendEntry(log, { ...call(2), data: { k: 1 } });
  eq(second.seq + "|" + second.prev, `2|${first.hash}`, "appendEntry links the second entry to the first");
  eq(Object.keys(second).join(","), [...ENTRY_KEYS, "data", "hash"].join(","), "a stored entry has the format's keys in order, data before hash");
  eq(entryHash(second.prev, (({ hash, ...r }) => r)(second)), second.hash, "the hash is SHA-256 of prev, a newline and the canonical entry");
  eq(readEntries(log).length, 2, "readEntries returns both");
  eq(readEntries(path.join(path.dirname(log), "absent.jsonl")).length, 0, "...and none for an absent file");
  eq(KINDS.length, 9, "there are nine entry kinds");
  eq(logPathFor("/p", {}), path.join("/p", ".kukulu", "cleanroom", "log.jsonl"), "the log lives under .kukulu/cleanroom/");
  eq(logPathFor("/p", { KUKULU_CLEANROOM_LOG: "/tmp/x.jsonl" }), "/tmp/x.jsonl", "...unless KUKULU_CLEANROOM_LOG says otherwise");
  let refused = null;
  try { appendEntry(log, { kind: "bogus" }); } catch (e) { refused = e; }
  ok(refused instanceof CleanroomError && /kind must be one of/.test(refused.message), "appendEntry refuses an unknown kind");
  try { appendEntry(log, { ...call(3), seq: 9 }); refused = null; } catch (e) { refused = e; }
  like(refused?.message, /fills 'seq' itself/, "...and a caller-supplied seq");
  try { appendEntry(log, { ...call(3), extra: 1 }); refused = null; } catch (e) { refused = e; }
  like(refused?.message, /unknown field 'extra'/, "...and an unknown field");
  eq(readEntries(log).length, 2, "...and a refusal writes nothing");
}

{
  const body = { seq: 1, prev: ZERO_HASH, at: "2026-01-01T00:00:00.000Z", kind: "allowed" };
  const shuffled = { kind: "allowed", at: body.at, prev: body.prev, seq: 1, data: { b: 1, a: 2 } };
  const c = canonical(shuffled);
  ok(c.indexOf('"seq"') < c.indexOf('"prev"') && c.indexOf('"prev"') < c.indexOf('"at"') && c.indexOf('"kind"') < c.indexOf('"stage"') && c.indexOf('"reason"') < c.indexOf('"data"'), "canonical orders the keys");
  ok(!c.includes(" ") && c.includes('"stage":null'), "...with no whitespace and null for a missing field");
  let refused = null;
  try { canonical({ ...body, nope: 1 }); } catch (e) { refused = e; }
  like(refused?.message, /unknown field 'nope'/, "...and refuses an unknown field");
}

{
  const log = tmpLog();
  for (let i = 1; i <= 5; i++) appendEntry(log, call(i));
  const lines = linesOf(log);
  const v = verifyChain(lines);
  eq(v.ok + "|" + v.entries.length + "|" + (v.tip === JSON.parse(lines[4]).hash) + "|" + v.firstBad, "true|5|true|null", "verifyChain accepts an intact chain");
  eq(verifyChain([]).ok, true, "...and an empty one");
  const edited = lines.slice();
  edited[2] = edited[2].replace("/x/3", "/x/evil");
  const t = verifyChain(edited);
  eq(t.ok + "|" + t.firstBad.line + "|" + t.firstBad.seq, "false|3|3", "verifyChain names a tampered middle line");
  like(t.firstBad.reason, /edited/, "...and says the entry was edited");
  const swapped = lines.slice();
  [swapped[1], swapped[2]] = [swapped[2], swapped[1]];
  eq(verifyChain(swapped).firstBad.line, 2, "verifyChain names a reordered line");
  const dropped = lines.slice(0, 2).concat(lines.slice(3));
  const d = verifyChain(dropped);
  eq(d.ok + "|" + d.firstBad.line, "false|3", "verifyChain names a dropped line");
  like(verifyChain(["{nope"]).firstBad.reason, /not valid JSON/, "...a line that is not JSON");
  const reKeyed = JSON.stringify({ hash: JSON.parse(lines[0]).hash, ...JSON.parse(lines[0]) });
  like(verifyChain([reKeyed]).firstBad.reason, /keys are not exactly/, "...and keys out of order");
  eq(verifyChain(lines.slice(1)).firstBad.line, 1, "...and a chain that does not start at seq 1");
}

{
  // Two processes appending at once leave one dense chain.
  const log = tmpLog();
  const mod = path.join(ROOT, "mcp", "cleanroom.mjs");
  const script = `import { appendEntry } from ${JSON.stringify("file://" + mod)}; for (let i = 0; i < 50; i++) appendEntry(${JSON.stringify(log)}, { kind: "allowed", role: process.argv[1], target: String(i) });`;
  const runChild = (name) => new Promise((resolve) => {
    const p = spawn(process.execPath, ["--input-type=module", "-e", script, name], { stdio: ["ignore", "ignore", "inherit"] });
    p.on("exit", resolve);
  });
  const codes = await Promise.all([runChild("a"), runChild("b")]);
  eq(codes.join(","), "0,0", "two child processes appended without error");
  const v = verifyChain(linesOf(log));
  eq(v.ok + "|" + v.entries.length, "true|100", "two processes appending 50 entries each leave one dense chain");
  eq(["a", "b"].map((r) => v.entries.filter((e) => e.role === r).length).join(","), "50,50", "...with every entry present");
  ok(!fs.existsSync(log + ".lock"), "...and no lock left behind");
}

{
  const log = tmpLog();
  fs.mkdirSync(path.dirname(log), { recursive: true });
  fs.mkdirSync(log + ".lock");
  const started = Date.now();
  let refused = null;
  try { appendEntry(log, call(1)); } catch (e) { refused = e; }
  const waited = Date.now() - started;
  ok(refused instanceof CleanroomError && refused.message.includes(log + ".lock"), "appendEntry gives up on a lock held over two seconds, naming the lock");
  ok(waited >= 1900 && waited < 6000, `...after about two seconds (${waited} ms)`);
  ok(!fs.existsSync(log), "...and writes nothing");
  fs.rmdirSync(log + ".lock");
  eq(appendEntry(log, call(1)).seq, 1, "...and works again once the lock is gone");
}

{
  eq(truncateTarget("x".repeat(TARGET_MAX + 10)).length, TARGET_MAX, "targets are truncated to TARGET_MAX");
  eq(truncateTarget("short"), "short", "...and a short one is untouched");
  const log = tmpLog();
  eq(appendEntry(log, { kind: "allowed", target: "y".repeat(TARGET_MAX * 2) }).target.length, TARGET_MAX, "appendEntry truncates the logged target");
}

// ---------------------------------------------------------------- entry fields from a payload

eq(targetOf("Read", { file_path: "/a/b.rs" }), "/a/b.rs", "targetOf: Read is the file path");
eq(targetOf("MultiEdit", { file_path: "/a/c.rs" }), "/a/c.rs", "...as is MultiEdit");
eq(targetOf("NotebookEdit", { notebook_path: "/a/n.ipynb" }), "/a/n.ipynb", "...NotebookEdit is its notebook path");
eq(targetOf("Grep", { path: "/src", glob: "*.rs", pattern: "fn main" }), "path=/src glob=*.rs pattern=fn main", "...Grep is path, glob and pattern");
eq(targetOf("Grep", { pattern: "x" }), "pattern=x", "...with missing parts omitted");
eq(targetOf("Glob", { path: "/src", pattern: "**/*.rs" }), "path=/src pattern=**/*.rs", "...Glob is path and pattern");
eq(targetOf("WebFetch", { url: "https://example.invalid/x" }), "https://example.invalid/x", "...WebFetch is the URL");
eq(targetOf("WebSearch", { query: "deflate" }), "deflate", "...WebSearch is the query");
eq(targetOf("Bash", { command: "ls -la" }), "ls -la", "...Bash is the command");
eq(targetOf("Bash", { command: "x".repeat(TARGET_MAX + 5) }).length, TARGET_MAX, "...truncated to TARGET_MAX");
eq(targetOf("Agent", { subagent_type: "kukulu-implementer", description: "build it" }), "kukulu-implementer: build it", "...Agent is subagent_type: description");
eq(targetOf("Task", { subagent_type: "x", description: "y" }), "x: y", "...and Task");
eq(targetOf("mcp__plugin_kukulu_kukulu__kukulu_status", { a: 1 }), 'mcp__plugin_kukulu_kukulu__kukulu_status {"a":1}', "...an MCP tool is its name and arguments");
eq(targetOf("Read", null), "", "...and a missing input is empty");

{
  const progress = "# p\n\n## Tasks\n\n- [x] P0-01 a\n- [~] P0-02 b\n- [ ] P0-03 c\n";
  const ctx = (round, extra = {}) => ({ progress, lock: null, state: { round }, ...extra });
  eq(entryFields({ agent_type: "kukulu-implementer" }, ctx(0)).stage, "implement", "entryFields: an implementer in round 0 is implement");
  eq(entryFields({ agent_type: "kukulu:implementer" }, ctx(1)).stage, "fix", "...in round 1 is fix");
  eq(entryFields({ agent_type: "kukulu-reviewer" }, ctx(0)).stage, "review", "...a reviewer is review");
  eq(entryFields({ agent_type: "kukulu-planner" }, ctx(0)).stage, "plan", "...a planner is plan");
  eq(entryFields({ agent_type: "kukulu-summarizer" }, ctx(0)).stage, "summarize", "...a summarizer is summarize");
  eq(entryFields({ agent_type: "Explore" }, ctx(0)).stage, null, "...an unrelated agent has no stage");
  const main = entryFields({ tool_name: "Read", tool_input: { file_path: "/x" } }, ctx(0));
  eq(main.role + "|" + main.stage, "session|null", "...the main session has role session, and no stage without a lock");
  eq(entryFields({}, ctx(0, { lock: { round: 0 } })).stage, "implement", "...a lock without an agent_type means implement");
  eq(entryFields({}, ctx(0, { lock: { round: 2 } })).stage, "fix", "...or fix by the lock's round");
  eq(entryFields({ agent_type: "kukulu-implementer" }, ctx(0)).role, "kukulu-implementer", "...the role is agent_type verbatim");
  eq(entryFields({}, ctx(0)).task, "P0-02", "...the task is the first in-progress task");
  eq(entryFields({}, { progress: "## Tasks\n- [x] P0-01 a\n" }).task, null, "...null when none is in progress");
  eq(entryFields({}, {}).task, null, "...and null with no PROGRESS.md");
  const f = entryFields({ model: "claude-x", session_id: "s-1", tool_name: "Bash", tool_input: { command: "ls" } }, ctx(0));
  eq(f.model + "|" + f.session + "|" + f.tool + "|" + f.target, "claude-x|s-1|Bash|ls", "...model, session, tool and target come from the payload");
  const bare = entryFields({}, ctx(0));
  eq(bare.model + "|" + bare.session + "|" + bare.tool, "null|null|null", "...and are null when the payload lacks them");
}

{
  const repo = mkDir("kukulu-ctx-");
  eq(JSON.stringify(projectContext(repo)), '{"progress":null,"lock":null,"state":null}', "projectContext is all null for a bare directory");
  writeFile(repo, "docs/PROGRESS.md", "## Tasks\n- [~] P0-09 x\n");
  writeFile(repo, ".kukulu/implement.lock", '{"count":0,"round":1}');
  writeFile(repo, ".kukulu/state.json", "{ not json");
  const c = projectContext(repo);
  eq(c.lock.round + "|" + c.state + "|" + /P0-09/.test(c.progress), "1|null|true", "...and reads PROGRESS.md and the lock, with an unreadable state as null");
}

finish();
