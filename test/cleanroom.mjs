// Clean-room mode (0.7.0): the policy loader, the guard, the hash chain,
// checkpoints, the gate and scoring. The module under test, mcp/cleanroom.mjs,
// is pure, so most assertions call it directly; the tools and hooks that use
// it are exercised through the real server and the real hook scripts.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  finish, ok, eq, like, isError, ROOT, plannedRepo, cleanroomRepo, withServer, runHook, mkDir, writeFile, readFile, hasFile, git, subject, testKeyFor, addPlan, commitTask, setState,
} from "./harness.mjs";
import { spawn, spawnSync } from "node:child_process";
import { createHash as sha, generateKeyPairSync } from "node:crypto";
import {
  CleanroomError, loadPolicy, policyHash,
  ENTRY_KEYS, KINDS, ZERO_HASH, TARGET_MAX, truncateTarget, canonical, entryHash, appendEntry, readEntries, verifyChain, logPathFor, targetOf, projectContext, entryFields,
  splitSegments, shellWords, commandWord, isPathLike, tokenPath, canonicalPaths,
  evaluate, lockdownActive, NETWORK_COMMANDS, READ_FAMILY, WRITE_FAMILY, protectedPaths,
  generateKey, loadKey, keyFingerprint, CHECKPOINT_KEYS, signCheckpoint, verifyCheckpoint,
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
  // Where the policy is looked for: docs/kukulu.json names it, else the default path.
  const repo = plannedRepo();
  writeFile(repo, "docs/cleanroom.json", EXAMPLE);
  const env = { CLAUDE_PROJECT_DIR: repo };
  const probe = { hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "/usr/include/zlib.h" }, cwd: repo };
  eq(runHook(LOGGER, { hook_event_name: "PostToolUse", cwd: repo }, env).status, 0, "the logger exits 0 with a policy present");
  eq(runHook(GUARD, probe, env).status, 2, "with a policy present the guard checks the call");
  writeFile(repo, "docs/kukulu.json", JSON.stringify({ cleanroom: { policy: "policy/cr.json" } }));
  eq(runHook(GUARD, probe, env).status, 0, "a policy named in docs/kukulu.json is the one looked for (the default file no longer counts)");
  writeFile(repo, "policy/cr.json", EXAMPLE);
  eq(runHook(GUARD, probe, env).status, 2, "...and its presence turns the mode on");
  writeFile(repo, "docs/kukulu.json", "{ not json");
  eq(runHook(GUARD, probe, env).status, 2, "an unparseable docs/kukulu.json means the default policy path");
}

// ---------------------------------------------------------------- the hash chain

const tmpLog = () => path.join(mkDir("kukulu-chain-"), ".kukulu", "cleanroom", "log.jsonl");
const linesOf = (log) => fs.readFileSync(log, "utf8").split("\n").filter(Boolean);
const sample = (n) => ({ kind: "allowed", stage: "implement", task: "P0-01", role: "session", tool: "Read", target: `/x/${n}`, decision: "allowed" });

{
  const log = tmpLog();
  const first = appendEntry(log, sample(1));
  eq(first.seq, 1, "appendEntry writes seq 1");
  eq(first.prev, ZERO_HASH, "...with a 64-zero prev");
  eq(ZERO_HASH.length, 64, "ZERO_HASH is 64 characters");
  like(first.at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/, "...a millisecond UTC timestamp");
  eq(first.model, null, "...and every field the caller left out is null");
  const second = appendEntry(log, { ...sample(2), data: { k: 1 } });
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
  try { appendEntry(log, { ...sample(3), seq: 9 }); refused = null; } catch (e) { refused = e; }
  like(refused?.message, /fills 'seq' itself/, "...and a caller-supplied seq");
  try { appendEntry(log, { ...sample(3), extra: 1 }); refused = null; } catch (e) { refused = e; }
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
  for (let i = 1; i <= 5; i++) appendEntry(log, sample(i));
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
  try { appendEntry(log, sample(1)); } catch (e) { refused = e; }
  const waited = Date.now() - started;
  ok(refused instanceof CleanroomError && refused.message.includes(log + ".lock"), "appendEntry gives up on a lock held over two seconds, naming the lock");
  ok(waited >= 1900 && waited < 6000, `...after about two seconds (${waited} ms)`);
  ok(!fs.existsSync(log), "...and writes nothing");
  fs.rmdirSync(log + ".lock");
  eq(appendEntry(log, sample(1)).seq, 1, "...and works again once the lock is gone");
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

// ---------------------------------------------------------------- the key and checkpoints

{
  const dir = mkDir("kukulu-key-");
  const keyPath = path.join(dir, "keys", "ed25519.pem");
  const key = generateKey(keyPath);
  eq((fs.statSync(keyPath).mode & 0o777).toString(8), "600", "generateKey writes a 0600 private key");
  ok(fs.existsSync(keyPath + ".pub") && /BEGIN PUBLIC KEY/.test(fs.readFileSync(keyPath + ".pub", "utf8")), "...and a .pub in SPKI PEM");
  eq((fs.statSync(path.dirname(keyPath)).mode & 0o777).toString(8), "700", "...in a 0700 directory");
  let refused = null;
  try { generateKey(keyPath); } catch (e) { refused = e; }
  like(refused?.message, /already exists/, "generateKey refuses an existing key");
  eq(key.fingerprint, "sha256:" + sha("sha256").update(key.publicKey.export({ type: "spki", format: "der" })).digest("hex"), "keyFingerprint is sha256: over the public DER");
  const loaded = loadKey(keyPath);
  eq(loaded.fingerprint, key.fingerprint, "loadKey returns the same fingerprint");
  eq(keyFingerprint(loaded.publicKey), key.fingerprint, "...and the public key matches");

  const rsa = path.join(dir, "rsa.pem");
  fs.writeFileSync(rsa, generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }));
  try { loadKey(rsa); refused = null; } catch (e) { refused = e; }
  ok(refused?.message.includes(rsa) && /rsa key/.test(refused.message), "loadKey refuses a non-Ed25519 key, naming the path");
  try { loadKey(path.join(dir, "absent.pem")); refused = null; } catch (e) { refused = e; }
  like(refused?.message, /cannot read an Ed25519 signing key at/, "...and an unreadable one");

  const data = { chainTip: ZERO_HASH, git: "abc1234", policyHash: "p".repeat(64), guardHash: "g".repeat(64), loggerHash: "l".repeat(64), hooksHash: "h".repeat(64), keyFingerprint: key.fingerprint, event: "run-start" };
  const signed = signCheckpoint(data, key.privateKey);
  ok(typeof signed.signature === "string" && Buffer.from(signed.signature, "base64").length === 64, "signCheckpoint adds a base64 Ed25519 signature");
  eq(CHECKPOINT_KEYS.join(","), "chainTip,git,policyHash,guardHash,loggerHash,hooksHash,keyFingerprint,event", "the checkpoint fields are fixed and ordered");
  eq(verifyCheckpoint({ kind: "checkpoint", data: signed }, key.publicKey), true, "a signed checkpoint verifies");
  eq(verifyCheckpoint({ kind: "checkpoint", data: { signature: signed.signature, ...Object.fromEntries([...CHECKPOINT_KEYS].reverse().map((k) => [k, data[k]])) } }, key.publicKey), true, "...whatever order the data's keys are stored in");
  const other = generateKey(path.join(dir, "other.pem"));
  eq(verifyCheckpoint({ kind: "checkpoint", data: signed }, other.publicKey), false, "...fails with another key");
  eq(verifyCheckpoint({ kind: "checkpoint", data: { ...signed, git: "def5678" } }, key.publicKey), false, "...fails after a field changes");
  eq(verifyCheckpoint({ kind: "checkpoint", data: { ...signed, extra: 1 } }, key.publicKey), false, "...fails with an added field");
  eq(verifyCheckpoint({ kind: "allowed", data: signed }, key.publicKey), false, "...fails when the entry is not a checkpoint");
  eq(verifyCheckpoint({ kind: "checkpoint", data }, key.publicKey), false, "...and when it carries no signature");
  let unsigned = null;
  try { signCheckpoint({ ...data, extra: 1 }, key.privateKey); } catch (e) { unsigned = e; }
  like(unsigned?.message, /exactly the fields/, "signCheckpoint refuses data with a field it would not sign");
}

// ---------------------------------------------------------------- genesis and sticky mode

const logOf = (repo) => readEntries(path.join(repo, ".kukulu", "cleanroom", "log.jsonl"));
const stateOf = (repo) => (hasFile(repo, ".kukulu/state.json") ? JSON.parse(readFile(repo, ".kukulu/state.json")) : {});

{
  const repo = cleanroomRepo();
  await withServer(repo, async ({ call }) => {
    const n = await call("kukulu_next");
    eq(n.stage, "plan", "the first kukulu_next in a clean-room project goes on to the plan stage");
    const log = logOf(repo);
    eq(log.length + "|" + log[0].kind + "|" + log[0].stage, "1|genesis|controller", "the first kukulu_next with a policy appends a genesis entry");
    const d = log[0].data;
    eq(Object.keys(d).join(","), "mode,policyHash,guardHash,loggerHash,hooksHash,pluginVersion,keyFingerprint,baseBranch,head", "...whose data names mode, the four hashes, pluginVersion, keyFingerprint, baseBranch and head");
    eq(d.mode + "|" + d.baseBranch, "clean-room|main", "...in clean-room mode on main");
    like(d.head, /^[0-9a-f]{40}$/, "...at the commit it was written on");
    eq(d.policyHash, policyHash(fs.readFileSync(path.join(repo, "docs", "cleanroom.json"))), "...the policy hash is the SHA-256 of the file");
    eq(d.guardHash, policyHash(fs.readFileSync(path.join(ROOT, "scripts", "cleanroom-guard.mjs"))), "...and the guard hash of the installed script");
    const st = stateOf(repo);
    eq(JSON.stringify(st.cleanroom), JSON.stringify({ genesis: log[0].hash, policyHash: d.policyHash, guardHash: d.guardHash, loggerHash: d.loggerHash, hooksHash: d.hooksHash }), "...and records state.cleanroom");
    eq(subject(repo), "chore: clean-room genesis", "...commits chore: clean-room genesis");
    eq(git(repo, ["show", "--name-only", "--format=", "HEAD"]).split("\n").sort().join(","), ".kukulu/cleanroom/log.jsonl,.kukulu/state.json", "...with the log and state");
    ok(fs.existsSync(testKeyFor(repo)), "...generating the key at KUKULU_CLEANROOM_KEY");
    eq(d.keyFingerprint, loadKey(testKeyFor(repo)).fingerprint, "...and the genesis names its fingerprint");
    await call("kukulu_next");
    eq(logOf(repo).length, 1, "a second kukulu_next appends no second genesis");
    eq(git(repo, ["status", "--porcelain"]), "", "...and the tree is clean");
  });
}

{
  const repo = cleanroomRepo();
  const viaConfig = path.join(mkDir("kukulu-key-a-"), "k.pem");
  const viaEnv = path.join(mkDir("kukulu-key-b-"), "k.pem");
  writeFile(repo, "docs/kukulu.json", JSON.stringify({ cleanroom: { signingKey: viaConfig } }));
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "config"]);
  await withServer(repo, async ({ call }) => {
    await call("kukulu_next");
  }, { env: { KUKULU_CLEANROOM_KEY: viaEnv } });
  ok(fs.existsSync(viaEnv) && !fs.existsSync(viaConfig), "KUKULU_CLEANROOM_KEY wins over cleanroom.signingKey");
  const repo2 = cleanroomRepo();
  writeFile(repo2, "docs/kukulu.json", JSON.stringify({ cleanroom: { signingKey: viaConfig } }));
  git(repo2, ["add", "-A"]);
  git(repo2, ["commit", "-qm", "config"]);
  await withServer(repo2, async ({ call }) => {
    await call("kukulu_next");
  }, { env: { KUKULU_CLEANROOM_KEY: "" } });
  ok(fs.existsSync(viaConfig), "...and an empty KUKULU_CLEANROOM_KEY falls back to cleanroom.signingKey");
}

{
  const repo = plannedRepo();
  await withServer(repo, async ({ call }) => {
    await call("kukulu_next");
    ok(!hasFile(repo, ".kukulu/cleanroom"), "a project without a policy writes no log at kukulu_next");
    eq(stateOf(repo).cleanroom, undefined, "...and records nothing in state");
    await call("kukulu_run_start");
    eq(JSON.stringify(stateOf(repo).cleanroom), JSON.stringify({ mode: "general" }), "kukulu_run_start records mode general without a policy");
    ok(!hasFile(repo, ".kukulu/cleanroom"), "...still without a log");
    writeFile(repo, "docs/cleanroom.json", EXAMPLE);
    const n = await call("kukulu_next");
    eq(n.stage, "halt", "a policy that appears after run_start halts");
    like(n.reason, /^clean-room coverage is broken: the mode changed after genesis \(a clean-room policy appeared after the flight started in general mode\); archive this flight with kukulu_flight_archive and start another$/, "...with the mode-change reason");
    isError(await call("kukulu_run_resume", { reason: "ignore it" }), /clean-room coverage is broken.*archive this flight/, "kukulu_run_resume refuses a mode-change halt and says to archive");
  });
}

{
  const repo = plannedRepo();
  writeFile(repo, "docs/cleanroom.json", EXAMPLE);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "policy after the plan"]);
  await withServer(repo, async ({ call }) => {
    const n = await call("kukulu_next");
    eq(n.stage, "halt", "a policy first seen after the plan exists halts");
    like(n.reason, /first seen after the plan was written/, "...saying so");
    ok(!hasFile(repo, ".kukulu/cleanroom"), "...and writes no genesis");
  });
}

{
  const repo = cleanroomRepo();
  await withServer(repo, async ({ call }) => {
    await call("kukulu_next");
    git(repo, ["rm", "-q", "docs/cleanroom.json"]);
    git(repo, ["commit", "-qm", "drop the policy"]);
    const n = await call("kukulu_next");
    eq(n.stage, "halt", "a policy removed after genesis halts");
    like(n.reason, /the clean-room policy file was removed after genesis/, "...saying so");
    isError(await call("kukulu_run_resume", { reason: "restored it" }), /archive this flight with kukulu_flight_archive/, "kukulu_run_resume refuses it too");
    git(repo, ["checkout", "HEAD~1", "--", "docs/cleanroom.json"]);
    git(repo, ["commit", "-qm", "restore the policy"]);
    ok((await call("kukulu_next")).stage !== "halt", "...and restoring the policy clears it, because the halt is computed each call");
  });
}

{
  const repo = cleanroomRepo({ policy: '{"version":2}' });
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_next"), /policy version must be 1/, "an invalid policy file is a refusal at genesis");
    ok(!hasFile(repo, ".kukulu/cleanroom/log.jsonl") && !hasFile(repo, ".kukulu/state.json"), "...and nothing is written");
  });
}

// ---------------------------------------------------------------- checkpoints from the tools

const LOG = (repo) => path.join(repo, ".kukulu", "cleanroom", "log.jsonl");
const checkpoints = (repo, log = LOG(repo)) => readEntries(log).filter((e) => e.kind === "checkpoint");
const touched = (repo, ref = "HEAD") => git(repo, ["show", "--name-only", "--format=", ref]).split("\n").filter(Boolean);

/** A clean-room project taken past genesis, with its plan committed. */
async function genesisRepo(planOpts = {}) {
  const repo = cleanroomRepo();
  await withServer(repo, async ({ call }) => { await call("kukulu_next"); });
  addPlan(repo, planOpts);
  return repo;
}

{
  const repo = await genesisRepo({ config: { flight: "w1" } });
  const publicKey = loadKey(testKeyFor(repo)).publicKey;
  await withServer(repo, async ({ call }) => {
    // The hooks append to the log after every tool call, so the log is routinely dirty between commits.
    appendEntry(LOG(repo), sample(0));
    await call("kukulu_run_start");
    let cps = checkpoints(repo);
    eq(cps.length + "|" + cps[0].data.event, "1|run-start", "kukulu_run_start appends a run-start checkpoint (with a dirty log)");
    ok(touched(repo).includes(".kukulu/cleanroom/log.jsonl") && subject(repo) === "chore: start implementation run", "...and commits the log with its own files");
    eq(git(repo, ["status", "--porcelain"]), "", "...leaving a clean tree");

    await call("kukulu_task_next");
    commitTask(repo, "P0-01", "Create hello", { "hello.txt": "hi\n" });
    appendEntry(LOG(repo), sample(1));
    await call("kukulu_task_done", { id: "P0-01", log: "done" });
    cps = checkpoints(repo);
    eq(cps[cps.length - 1].data.event, "kukulu_task_done", "kukulu_task_done appends a kukulu_task_done checkpoint (tolerating an uncommitted log append)");
    ok(touched(repo).includes(".kukulu/cleanroom/log.jsonl") && touched(repo).includes("docs/PROGRESS.md"), "...committing the log with PROGRESS.md");

    await call("kukulu_task_next");
    writeFile(repo, "debris.txt", "half done\n");
    appendEntry(LOG(repo), sample(2));
    const lines = readEntries(LOG(repo)).length;
    await call("kukulu_task_block", { id: "P0-02", reason: "cannot" });
    cps = checkpoints(repo);
    eq(cps[cps.length - 1].data.event, "kukulu_task_block", "kukulu_task_block appends a kukulu_task_block checkpoint");
    ok(!hasFile(repo, "debris.txt") && readEntries(LOG(repo)).length === lines + 1, "...and its hard reset does not throw the hooks' log entries away");

    await call("kukulu_task_next");
    writeFile(repo, "docs/HANDOFF.md", "# Handoff\n");
    appendEntry(LOG(repo), sample(3));
    await call("kukulu_run_finish");
    cps = checkpoints(repo);
    eq(cps[cps.length - 1].data.event, "kukulu_run_finish", "kukulu_run_finish appends a kukulu_run_finish checkpoint (tolerating an uncommitted log append)");

    writeFile(repo, "docs/REVIEW.md", "# Review\nRound: 1\n**Verdict**: APPROVED\n");
    await call("kukulu_review_submit", { verdict: "APPROVED" });
    cps = checkpoints(repo);
    eq(cps[cps.length - 1].data.event, "kukulu_review_submit", "kukulu_review_submit appends a kukulu_review_submit checkpoint");
    await call("kukulu_summary_commit", { content: "# Summary\n" });
    cps = checkpoints(repo);
    eq(cps[cps.length - 1].data.event, "kukulu_summary_commit", "kukulu_summary_commit appends a kukulu_summary_commit checkpoint");
    ok(touched(repo).includes(".kukulu/cleanroom/log.jsonl"), "...committing the log with SUMMARY.md");

    const before = checkpoints(repo).length;
    const arch = await call("kukulu_flight_archive");
    ok(!arch.error, "kukulu_flight_archive succeeds in clean-room mode");
    ok(!hasFile(repo, ".kukulu/cleanroom/log.jsonl"), "the archive moves the log out of .kukulu/cleanroom/");
    const archived = path.join(repo, "docs", "flights", "w1", "cleanroom", "log.jsonl");
    ok(fs.existsSync(archived), "...into docs/flights/<slug>/cleanroom/");
    const archivedLines = fs.readFileSync(archived, "utf8").split("\n").filter(Boolean);
    ok(verifyChain(archivedLines).ok, "...a log that still verifies");
    const all = checkpoints(repo, archived);
    eq(all.length, before + 1, "...with the archive's own checkpoint last");
    eq(all[all.length - 1].data.event, "kukulu_flight_archive", "...named kukulu_flight_archive");
    eq(all.map((e) => e.data.event).join(","), "run-start,kukulu_task_done,kukulu_task_block,kukulu_run_finish,kukulu_review_submit,kukulu_summary_commit,kukulu_flight_archive", "the checkpoints appear in the order the tools ran");
    eq(all.every((e) => verifyCheckpoint(e, publicKey)), true, "every checkpoint verifies with the public key");
    eq(all[0].data.git.length, 40, "...each recording the full HEAD sha");
    eq(all[0].data.keyFingerprint, loadKey(testKeyFor(repo)).fingerprint, "...and the key's fingerprint");
    eq(git(repo, ["status", "--porcelain"]), "", "the archive leaves a clean tree");
  });
}

{
  // A failed progress commit restores the log byte for byte (the commit-failure protocol).
  const repo = await genesisRepo();
  await withServer(repo, async ({ call }) => {
    await call("kukulu_run_start");
    await call("kukulu_task_next");
    commitTask(repo, "P0-01", "Create hello", { "hello.txt": "hi\n" });
    const hook = path.join(repo, ".git", "hooks", "commit-msg");
    fs.mkdirSync(path.dirname(hook), { recursive: true });
    fs.writeFileSync(hook, `#!/bin/sh\nif head -n1 "$1" | grep -q '^progress:'; then echo rejected >&2; exit 1; fi\n`);
    fs.chmodSync(hook, 0o755);
    const files = ["docs/PROGRESS.md", ".kukulu/cleanroom/log.jsonl"];
    const before = files.map((f) => readFile(repo, f));
    const head = git(repo, ["rev-parse", "HEAD"]);
    ok((await call("kukulu_task_done", { id: "P0-01", log: "x" })).error, "a failed progress commit is an error");
    files.forEach((f, i) => eq(readFile(repo, f), before[i], `...${f} is byte-identical`));
    eq(git(repo, ["diff", "--cached", "--name-only"]), "", "...nothing is staged");
    eq(git(repo, ["rev-parse", "HEAD"]), head, "...HEAD did not move");
  });
}

{
  // General mode: no checkpoint, no log.
  const repo = plannedRepo();
  await withServer(repo, async ({ call }) => {
    await call("kukulu_run_start");
    await call("kukulu_task_next");
    commitTask(repo, "P0-01", "Create hello", { "hello.txt": "hi\n" });
    await call("kukulu_task_done", { id: "P0-01", log: "done" });
    ok(!hasFile(repo, ".kukulu/cleanroom"), "general mode writes no checkpoint and no log");
    ok(!touched(repo).some((f) => f.includes("cleanroom")), "...and commits nothing about one");
  });
}

// ---------------------------------------------------------------- Bash segments and paths

{
  eq(JSON.stringify(splitSegments("a; b && c || d | e & f\ng")), JSON.stringify(["a", "b", "c", "d", "e", "f", "g"]), "splitSegments splits on ; && || | & and newlines");
  eq(JSON.stringify(splitSegments('grep -E "a|b" file | wc -l')), JSON.stringify(['grep -E "a|b" file', "wc -l"]), "...keeps a quoted |");
  eq(JSON.stringify(splitSegments("grep 'a;b&&c' f; echo ok")), JSON.stringify(["grep 'a;b&&c' f", "echo ok"]), "...keeps quoted ; and && in single quotes");
  eq(JSON.stringify(splitSegments('echo "a \\" ; b" ; ls')), JSON.stringify(['echo "a \\" ; b"', "ls"]), "...handles escaped quotes");
  eq(JSON.stringify(splitSegments("echo a\\;b; ls")), JSON.stringify(["echo a\\;b", "ls"]), "...and a backslash-escaped ; outside quotes");
  eq(JSON.stringify(splitSegments("make 2>&1 | tee out &> log")), JSON.stringify(["make 2>&1", "tee out &> log"]), "...and does not split a redirection's &");
  eq(JSON.stringify(splitSegments("  \n ; ")), "[]", "...and drops empty segments");
  eq(JSON.stringify(shellWords(`cp 'a b' "c \\"d\\"" e\\ f`)), JSON.stringify(["cp", "a b", 'c "d"', "e f"]), "shellWords removes quotes and unescapes");
  eq(JSON.stringify(shellWords("a '' b")), JSON.stringify(["a", "", "b"]), "...keeping an empty quoted word");

  const cw = (s) => commandWord(shellWords(s));
  eq(cw("FOO=1 BAR=2 curl http://x").word, "curl", "commandWord skips assignments");
  eq(cw("sudo -E env X=1 wget u").word, "wget", "...and wrappers with their flags");
  eq(cw("nice -n 10 time cat f").word, "cat", "...nice -n with its value");
  eq(cw("xargs -0 -n1 rm").word, "rm", "...xargs flags");
  eq(cw("/usr/bin/curl -s u").word, "curl", "...the base name of a path");
  eq(JSON.stringify(cw("env A=1 grep -r x .").args), JSON.stringify(["-r", "x", "."]), "...with the arguments after it");
  eq(cw("FOO=1").word, null, "...and null when there is only an assignment");

  eq(isPathLike("/etc/passwd") && isPathLike("src/a.rs") && isPathLike("~/x") && isPathLike("./a") && isPathLike("../b") && isPathLike(".hidden"), true, "isPathLike accepts / ~ and . forms");
  eq(isPathLike("https://example.invalid/a/b") || isPathLike("git+ssh://h/p"), false, "isPathLike ignores URLs");
  eq(isPathLike("plainword") || isPathLike("-r") || isPathLike("a.b"), false, "...and plain words");
  eq(isPathLike("--out=/tmp/x") && !isPathLike("--mode=fast"), true, "...judging an --opt=value by its value");
  eq(tokenPath("--out=/tmp/x") + "|" + tokenPath("/tmp/y"), "/tmp/x|/tmp/y", "tokenPath returns the value of --opt=value");
}

{
  const dir = mkDir("kukulu-canon-");
  const home = path.join(dir, "home");
  fs.mkdirSync(home);
  eq(JSON.stringify(canonicalPaths("~/a/b", { cwd: "/", home })), JSON.stringify([path.join(home, "a", "b")]), "canonicalPaths expands ~/");
  eq(JSON.stringify(canonicalPaths("~", { cwd: "/", home })), JSON.stringify([home]), "...and a bare ~");
  const cwd = path.join(dir, "work");
  fs.mkdirSync(cwd);
  eq(JSON.stringify(canonicalPaths("../work/./x/../y", { cwd, home })), JSON.stringify([path.join(cwd, "y")]), "canonicalPaths resolves relative to cwd and normalizes");
  eq(JSON.stringify(canonicalPaths("/abs/p", { cwd, home })), JSON.stringify(["/abs/p"]), "...and leaves an absolute path alone");
  const real = path.join(dir, "real");
  fs.mkdirSync(real);
  fs.writeFileSync(path.join(real, "f.txt"), "x");
  const link = path.join(dir, "link");
  fs.symlinkSync(real, link);
  eq(JSON.stringify(canonicalPaths(path.join(link, "f.txt"), { cwd, home })), JSON.stringify([path.join(link, "f.txt"), path.join(real, "f.txt")]), "...adds the real path through a symlinked repo");
  eq(JSON.stringify(canonicalPaths(path.join(link, "new", "g.txt"), { cwd, home })), JSON.stringify([path.join(link, "new", "g.txt"), path.join(real, "new", "g.txt")]), "...even for a file that does not exist yet");
}

// ---------------------------------------------------------------- the guard's decision

{
  // Every case of the fixture file, one assertion each. __ROOT__ and __HOME__ are real temp directories.
  const cases = JSON.parse(fs.readFileSync(path.join(ROOT, "test", "fixtures", "guard-cases.json"), "utf8"));
  const root = mkDir("kukulu-guard-root-");
  const home = mkDir("kukulu-guard-home-");
  const sub = (v) => JSON.parse(JSON.stringify(v).replaceAll("__ROOT__", root).replaceAll("__HOME__", home));
  const fixtureEnv = (rootDir, homeDir, c) => ({
    root: rootDir,
    home: homeDir,
    progressText: c.progress ?? null,
    policyPath: path.join(rootDir, "docs", "cleanroom.json"),
    pluginRoot: path.join(homeDir, "plugin-root"),
    keyPath: path.join(homeDir, ".config", "kukulu", "cleanroom", "ed25519.pem"),
    planExists: Boolean(c.planExists),
  });
  eq(new Set(cases.map((c) => c.name)).size, cases.length, "every guard case has its own name");
  for (const c of cases) {
    const policy = loadPolicy(c.policy === "template" ? EXAMPLE : JSON.stringify(c.policy));
    const r = evaluate(policy, sub(c.input), fixtureEnv(root, home, c));
    const reason = c.reason ? new RegExp(c.reason) : null;
    ok(r.decision === c.expect && (!reason || (r.reason && reason.test(r.reason))), `guard case: ${c.name}`);
    if (r.decision !== c.expect || (reason && !reason.test(r.reason ?? ""))) console.log(`  #   expected ${c.expect}${c.reason ? ` /${c.reason}/` : ""}, got ${r.decision}: ${r.reason}`);
  }
}

{
  const policy = loadPolicy('{"version":1,"lockdown":{"after":"P0-10"}}');
  const before = "## Tasks\n- [x] P0-01 a\n- [~] P0-10 b\n- [ ] P0-11 c\n";
  eq(lockdownActive(policy, before), false, "lockdownActive is false before the lockdown task");
  eq(lockdownActive(policy, before.replace("[~] P0-10", "[x] P0-10")), true, "...true once it is done");
  eq(lockdownActive(policy, "## Tasks\n- [x] P0-01 a\n- [!] P0-02 b\n- [-] P0-03 c\n"), true, "...true when no task is open");
  eq(lockdownActive(policy, null), false, "...false without a PROGRESS.md");
  eq(lockdownActive(loadPolicy('{"version":1}'), "## Tasks\n- [x] P0-01 a\n"), false, "...false without lockdown.after");
  eq(lockdownActive(policy, "## Tasks\n"), false, "...false for a PROGRESS.md with no tasks at all");
  eq(NETWORK_COMMANDS.join("|"), "curl|wget|gh|ssh|scp|nc|git clone|git fetch|git pull|pip download|cargo vendor|cargo download|npm install|npm i|npm ci|go get|composer install", "NETWORK_COMMANDS is the fixed list");
  eq([...READ_FAMILY].join(" "), "cat less more head tail grep egrep fgrep rg ag ack find fd locate ls tree sed awk bat strings xxd od hexdump file zcat zless zgrep view vi vim nano emacs", "READ_FAMILY is the fixed list");
  eq([...WRITE_FAMILY].join(" "), "cp mv rm tee sed truncate chmod chown ln install dd git", "WRITE_FAMILY is the fixed list");
}

// ---------------------------------------------------------------- the guard hook

{
  const repo = plannedRepo();
  writeFile(repo, "docs/cleanroom.json", EXAMPLE);
  setState(repo, { cleanroom: { genesis: "g" } }); // the hooks log once the flight has its genesis
  const env = { CLAUDE_PROJECT_DIR: repo };
  const log = LOG(repo);
  const read = (file_path, extra = {}) => ({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path }, cwd: repo, session_id: "s-9", model: "m-1", ...extra });

  const denial = runHook(GUARD, read("/usr/include/zlib.h"), env);
  eq(denial.status, 2, "a denied Read exits 2 with the reason on stderr");
  eq(denial.stderr, "kukulu clean-room guard: denied path: /usr/include/zlib.h (deny.paths)\n", "...the exact line");
  eq(denial.stdout, "", "...and nothing on stdout");
  const entries = readEntries(log);
  const e = entries[0];
  eq(entries.length + "|" + e.kind + "|" + e.decision + "|" + e.tool + "|" + e.target + "|" + e.role + "|" + e.session + "|" + e.model, "1|denied|denied|Read|/usr/include/zlib.h|session|s-9|m-1", "...and appends a denied entry with the payload's fields");
  like(e.reason, /denied path: \/usr\/include\/zlib\.h \(deny\.paths\)/, "...carrying the reason");
  eq(verifyChain(linesOf(log)).ok, true, "...in a chain that verifies");

  const fine = runHook(GUARD, read(path.join(repo, "docs", "notes.md")), env);
  eq(fine.status + "|" + fine.stdout + "|" + fine.stderr, "0||", "an allowed call exits 0 silently");
  eq(readEntries(log).length, 1, "...and logs nothing (the logger does that)");

  eq(runHook(GUARD, "", env).status, 2, "an empty hook input is a denial when a policy exists");
  like(runHook(GUARD, "[1,2]", env).stderr, /guard internal error: the hook input is empty or not a JSON object/, "...as is one that is not an object");
  like(readEntries(log).at(-1).reason, /guard internal error/, "...and the internal error is logged too");

  // A malformed policy is a denial naming the problem, not a pass.
  writeFile(repo, "docs/cleanroom.json", '{"version":2}');
  const bad = runHook(GUARD, read(path.join(repo, "a.txt")), env);
  eq(bad.status, 2, "a malformed policy is a denial");
  like(bad.stderr, /^kukulu clean-room guard: guard internal error: policy version must be 1/, "...with guard internal error and the loader's message");
  writeFile(repo, "docs/cleanroom.json", EXAMPLE);
}

{
  // An exception in evaluate is a denial, never exit 0: a temp plugin copy whose evaluate throws.
  const plugin = mkDir("kukulu-plugin-");
  fs.mkdirSync(path.join(plugin, "scripts"));
  fs.mkdirSync(path.join(plugin, "mcp"));
  fs.copyFileSync(GUARD, path.join(plugin, "scripts", "cleanroom-guard.mjs"));
  const source = fs.readFileSync(path.join(ROOT, "mcp", "cleanroom.mjs"), "utf8");
  const hook = "export function evaluate(policy, hookInput, env) {";
  ok(source.includes(hook), "the evaluate signature this test patches is present");
  fs.writeFileSync(path.join(plugin, "mcp", "cleanroom.mjs"), source.replace(hook, `${hook}\n  throw new Error("evaluate exploded");`));
  const repo = plannedRepo();
  writeFile(repo, "docs/cleanroom.json", EXAMPLE);
  setState(repo, { cleanroom: { genesis: "g" } });
  const r = runHook(path.join(plugin, "scripts", "cleanroom-guard.mjs"), { tool_name: "Read", tool_input: { file_path: "/x" }, cwd: repo }, { CLAUDE_PROJECT_DIR: repo });
  eq(r.status, 2, "an exception in evaluate is a denial, never exit 0");
  like(r.stderr, /guard internal error: evaluate exploded/, "...saying what threw");
  like(readEntries(LOG(repo)).at(-1).reason, /evaluate exploded/, "...and logged");
  const noModule = mkDir("kukulu-plugin-");
  fs.mkdirSync(path.join(noModule, "scripts"));
  fs.copyFileSync(GUARD, path.join(noModule, "scripts", "cleanroom-guard.mjs"));
  const gone = runHook(path.join(noModule, "scripts", "cleanroom-guard.mjs"), { tool_name: "Read", cwd: repo }, { CLAUDE_PROJECT_DIR: repo });
  eq(gone.status, 2, "a guard that cannot load mcp/cleanroom.mjs still denies");
  like(gone.stderr, /^kukulu clean-room guard: guard internal error: /, "...with guard internal error");
}

{
  const run = (policyPath, cwd) => spawnSync(process.execPath, [GUARD, "--self-test", policyPath], { cwd, encoding: "utf8", env: { PATH: process.env.PATH, HOME: process.env.HOME } });
  const repo = plannedRepo();
  const template = run(path.join(ROOT, "templates", "cleanroom.example.json"), repo);
  eq(template.status, 0, "--self-test on the template exits 0");
  like(template.stdout, /^guard self-test: ok \(\d+ cases\)\n$/, "...printing guard self-test: ok with the case count");
  ok(!fs.existsSync(path.join(repo, ".kukulu")), "--self-test never writes .kukulu/cleanroom/log.jsonl");
  const disagree = JSON.parse(EXAMPLE);
  disagree.deny.pathPatterns[0].shouldMatch = ["/home/u/p/target/debug/deps/x"];
  writeFile(repo, "bad-policy.json", JSON.stringify(disagree));
  const bad = run(path.join(repo, "bad-policy.json"), repo);
  ok(bad.status !== 0 && /shouldMatch "\/home\/u\/p\/target\/debug\/deps\/x" did not match/.test(bad.stderr), "--self-test fails on a policy whose own fixture disagrees");
  eq(run(path.join(repo, "absent.json"), repo).status !== 0, true, "...and on a policy that does not exist");
  const noArg = spawnSync(process.execPath, [GUARD, "--self-test"], { cwd: repo, encoding: "utf8" });
  ok(noArg.status !== 0 && /pass the policy to test/.test(noArg.stderr), "...and with no policy argument");
  // The given policy's own patterns are exercised: a pattern that does not deny its shouldMatch line in the real evaluator fails.
  const broken = JSON.parse(EXAMPLE);
  broken.deny.commandPatterns[0].pattern = "^never$";
  broken.deny.commandPatterns[0].shouldMatch = ["never"];
  broken.deny.commandPatterns[0].shouldNotMatch = ["perf record target/release/examples/profile_decode"];
  writeFile(repo, "ok-policy.json", JSON.stringify(broken));
  const okRun = run(path.join(repo, "ok-policy.json"), repo);
  eq(okRun.status, 0, "a policy whose patterns agree with their fixtures passes the self-test");
}

// ---------------------------------------------------------------- the logger hook

{
  const repo = plannedRepo();
  writeFile(repo, "docs/cleanroom.json", EXAMPLE);
  writeFile(repo, "PROGRESS-NOTE", "x");
  writeFile(repo, "docs/PROGRESS.md", "# p\n\n## Tasks\n\n- [~] P0-04 working\n");
  const env = { CLAUDE_PROJECT_DIR: repo };
  const post = (tool_name, tool_input, extra = {}) => ({ hook_event_name: "PostToolUse", tool_name, tool_input, cwd: repo, session_id: "s-3", model: "m-2", ...extra });

  const before = runHook(LOGGER, post("Read", { file_path: "/x/a" }), env);
  eq(before.status + "|" + before.stdout + "|" + before.stderr, "0||", "before genesis the logger exits 0 silently");
  ok(!fs.existsSync(LOG(repo)), "...and writes no log, so the genesis entry can be entry 1");

  setState(repo, { round: 0, cleanroom: { genesis: "g" } });
  eq(runHook(LOGGER, post("Read", { file_path: "/x/a" }), env).status, 0, "the logger exits 0");
  runHook(LOGGER, post("Bash", { command: "ls -la" }, { agent_type: "kukulu-implementer" }), env);
  runHook(LOGGER, post("Grep", { pattern: "x", glob: "*.rs" }), env);
  const entries = readEntries(LOG(repo));
  eq(entries.length, 3, "PostToolUse appends one allowed entry per call");
  const [a, b] = entries;
  eq(a.kind + "|" + a.decision + "|" + a.reason + "|" + a.tool + "|" + a.target, "allowed|allowed|null|Read|/x/a", "...an allowed entry for the call");
  eq(a.stage + "|" + a.task + "|" + a.role + "|" + a.model + "|" + a.session, "null|P0-04|session|m-2|s-3", "...with stage, task, role, model and session");
  eq(b.stage + "|" + b.role + "|" + b.target, "implement|kukulu-implementer|ls -la", "...an implementer's call is filed under implement");
  eq(entries[2].target, "glob=*.rs pattern=x", "...a Grep's target is its parts");
  // The guard denies in between: one chain.
  runHook(GUARD, { hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "/usr/include/zlib.h" }, cwd: repo }, env);
  runHook(LOGGER, post("Read", { file_path: "/x/b" }), env);
  const v = verifyChain(linesOf(LOG(repo)));
  eq(v.ok + "|" + v.entries.length + "|" + v.entries.map((e) => e.kind).join(","), "true|5|allowed,allowed,allowed,denied,allowed", "the chain stays valid across guard and logger appends");
  eq(runHook(LOGGER, { hook_event_name: "UserPromptSubmit", prompt: "hello", cwd: repo }, env).status, 0, "UserPromptSubmit exits 0 for now");
  eq(readEntries(LOG(repo)).length, 5, "...without logging");

  // Its own failure: an unparseable payload is logged as a logger-error and the call goes on.
  const garbled = runHook(LOGGER, "{nope", env);
  eq(garbled.status, 0, "a logger failure exits 0");
  const last = readEntries(LOG(repo)).at(-1);
  eq(last.kind + "|" + last.tool + "|" + last.decision, "allowed|unknown|null", "...after appending an entry with tool unknown");
  like(last.reason, /^logger-error: /, "...whose reason says logger-error");

  // When the log cannot be written either: one stderr line, still exit 0.
  const blocked = runHook(LOGGER, post("Read", { file_path: "/x/c" }), { ...env, KUKULU_CLEANROOM_LOG: "/dev/null/cannot/log.jsonl" });
  eq(blocked.status, 0, "an unwritable log still exits 0");
  eq(blocked.stderr.split("\n").filter(Boolean).length, 1, "...with exactly one stderr line");
  like(blocked.stderr, /^kukulu clean-room logger: could not log/, "...naming the logger");
}

{
  // Before genesis a denial still blocks, but there is no chain to put it in.
  const repo = plannedRepo();
  writeFile(repo, "docs/cleanroom.json", EXAMPLE);
  const r = runHook(GUARD, { hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "/usr/include/zlib.h" }, cwd: repo }, { CLAUDE_PROJECT_DIR: repo });
  eq(r.status, 2, "before genesis the guard still denies");
  ok(!fs.existsSync(LOG(repo)), "...but writes no log");
}

// ---------------------------------------------------------------- self-protection

{
  const policy = loadPolicy('{"version":1,"protected":["tools/","/opt/extra"]}');
  const env = { root: "/p", home: "/h", policyPath: "/p/docs/cleanroom.json", pluginRoot: "/h/.claude/plugins/cache/kukulu", keyPath: "/h/.config/kukulu/cleanroom/ed25519.pem", planExists: true };
  const list = protectedPaths(policy, env);
  const want = [
    "/p/docs/cleanroom.json", "/p/.kukulu/cleanroom", "/p/.kukulu/state.json", "/p/docs/kukulu.json",
    "/p/.claude/settings.json", "/p/.claude/settings.local.json", "/p/.claude/hooks", "/p/.mcp.json",
    "/h/.claude/plugins/cache/kukulu", "/h/.claude/plugins", "/h/.claude/settings.json",
    "/h/.config/kukulu/cleanroom/ed25519.pem", "/h/.config/kukulu/cleanroom/ed25519.pem.pub",
    "/p/.git/hooks", "/p/.git/config", "/p/.git/info", "/p/tools", "/opt/extra",
  ];
  eq(list.map((p) => p.replace(/\/$/, "")).join("\n"), want.join("\n"), "protectedPaths lists the always-protected set, then the policy's own");
  ok(!protectedPaths(policy, { ...env, planExists: false }).includes("/p/docs/kukulu.json"), "docs/kukulu.json is not protected before docs/PLAN.md exists");
  eq(protectedPaths(policy, { root: "/p", home: "/h" }).length > 0, true, "a missing piece of the environment is skipped, not a crash");
}

finish();
