// Clean-room mode (0.7.0): the policy loader, the guard, the hash chain,
// checkpoints, the gate and scoring. The module under test, mcp/cleanroom.mjs,
// is pure, so most assertions call it directly; the tools and hooks that use
// it are exercised through the real server and the real hook scripts.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { finish, ok, eq, like, isError, ROOT, plannedRepo, withServer, runHook, mkDir, writeFile } from "./harness.mjs";
import { spawnSync } from "node:child_process";
import { CleanroomError, loadPolicy, policyHash } from "../mcp/cleanroom.mjs";

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

finish();
