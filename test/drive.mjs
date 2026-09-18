// Drives foundry MCP server over stdio through a full plan→implement→review→fix→approve→summary cycle.
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Usage: node test/drive.mjs            (fresh temp repo, plugin's own server)
//        node test/drive.mjs <repo> <server.mjs>
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = process.argv[3] ? path.resolve(process.argv[3]) : path.join(HERE, "..", "mcp", "server.mjs");
let REPO = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (!REPO) {
  REPO = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-test-"));
  execSync("git init -q -b main && git config user.email t@t && git config user.name t && git commit -q --allow-empty -m init", { cwd: REPO });
  process.on("exit", () => { if (!process.env.KEEP_REPO) fs.rmSync(REPO, { recursive: true, force: true }); });
}
const sh = (c) => execSync(c, { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const srv = spawn("node", [SERVER], { env: { ...process.env, FOUNDRY_PROJECT_DIR: REPO }, stdio: ["pipe", "pipe", "inherit"] });
let nextId = 1; const pending = new Map(); let buf = "";
srv.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (!l.trim()) continue; const m = JSON.parse(l); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } } });
const rpc = (method, params) => new Promise((res) => { const id = nextId++; pending.set(id, res); srv.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); });
const call = async (name, args = {}) => { const r = await rpc("tools/call", { name, arguments: args }); const t = r.result.content[0].text; if (r.result.isError) return { error: t }; return JSON.parse(t); };
const assert = (c, m) => { if (!c) { console.error("ASSERT FAILED:", m); process.exit(1); } console.log("ok  ", m); };

const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "drive", version: "0" } });
assert(init.result.serverInfo.name === "foundry", "initialize");
const tl = await rpc("tools/list", {});
assert(tl.result.tools.length === 10, "tools/list has 10 tools");

// 0. empty repo, no spec
let n = await call("foundry_next");
assert(n.stage === "halt" && /SPEC/.test(n.reason), "no SPEC → halt");

// 1. spec present → plan
fs.mkdirSync(path.join(REPO, "docs"), { recursive: true });
fs.writeFileSync(path.join(REPO, "docs/SPEC.md"), "# Spec\n");
sh("git add -A && git commit -qm 'spec'");
n = await call("foundry_next");
assert(n.stage === "plan" && n.agent === "foundry:planner", "spec only → plan");

// 2. "planner" writes plan/progress/config/CLAUDE.md
fs.writeFileSync(path.join(REPO, "docs/PLAN.md"), `# Test build plan
## Decisions
- none
## Phase 0 — Scaffold
### P0-01: Create hello
**Goal:** write hello.txt
**Files touched:** hello.txt
**Design constraints:** none
**Acceptance tests:** test.sh
**Out of scope:** everything else
**Verification:** ./test.sh
**Depends on:** none

### P0-02: Impossible task
**Goal:** fail
**Files touched:** nope.txt
**Design constraints:** none
**Acceptance tests:** none
**Out of scope:** none
**Verification:** none
**Depends on:** P0-01

### P0-03: Depends on the impossible one
**Goal:** skip me
**Files touched:** x
**Design constraints:** none
**Acceptance tests:** none
**Out of scope:** none
**Verification:** none
**Depends on:** P0-02
`);
fs.writeFileSync(path.join(REPO, "docs/PROGRESS.md"), `# Test build progress
Branch: (set by implement)
Started: (set by implement)

## Tasks
- [ ] P0-01 Create hello
- [ ] P0-02 Impossible task
- [ ] P0-03 Depends on the impossible one

## Log
(one entry per task, appended by implement)
`);
fs.writeFileSync(path.join(REPO, "docs/foundry.json"), JSON.stringify({ verify: ["test -f hello.txt"], extraVerify: { "src/": ["echo extra"] }, maxRounds: 2 }, null, 2));
fs.writeFileSync(path.join(REPO, "CLAUDE.md"), "# rules\n");
sh("git add -A && git commit -qm 'plan: derive build plan from SPEC'");
n = await call("foundry_next");
assert(n.stage === "implement" && n.round === 0, "plan on disk → implement round 0");

// 3. run start
let r = await call("foundry_run_start");
assert(!r.error && r.branch.startsWith("build/"), "run_start creates build branch: " + r.branch);
assert(fs.existsSync(path.join(REPO, ".foundry/implement.lock")), "lock armed");
assert(sh("git log -1 --format=%s") === "chore: start implementation run", "start committed");
r = await call("foundry_run_start");
assert(r.alreadyStarted === true, "run_start idempotent");

// 4. task loop
let t = await call("foundry_task_next");
assert(t.id === "P0-01" && /write hello/.test(t.text), "task_next → P0-01 with plan text");
// verify before implementing should fail
let v = await call("foundry_verify", { files: ["hello.txt"] });
assert(v.ok === false, "verify fails before implementation");
// try to mark done without commit → refused
let bad = await call("foundry_task_done", { id: "P0-01", log: "x" });
assert(bad.error && /HEAD commit/.test(bad.error), "task_done refuses without task commit");
fs.writeFileSync(path.join(REPO, "hello.txt"), "hi\n");
sh("git add hello.txt && git commit -qm 'P0-01: Create hello'");
v = await call("foundry_verify", { files: ["hello.txt", "src/a.js"] });
assert(v.ok === true && v.results.length === 2 && v.results[1].command === "echo extra", "verify passes; extraVerify matched by prefix");
r = await call("foundry_task_done", { id: "P0-01", log: "Added hello.txt.\nInterpretation: none." });
assert(!r.error && r.counts.done === 1, "task_done marks [x] and logs");
assert(/^### P0-01 — [0-9a-f]{7,}\nAdded hello/m.test(fs.readFileSync(path.join(REPO, "docs/PROGRESS.md"), "utf8")), "log entry stamped with sha");

t = await call("foundry_task_next");
assert(t.id === "P0-02" && t.dependencyLogs["P0-01"] && /Added hello/.test(t.dependencyLogs["P0-01"]), "P0-02 receives P0-01's log");
fs.writeFileSync(path.join(REPO, "junk.txt"), "half-done\n");
r = await call("foundry_task_block", { id: "P0-02", reason: "tried A / fails B / fix C" });
assert(!r.error && !fs.existsSync(path.join(REPO, "junk.txt")) && fs.existsSync(path.join(REPO, ".foundry/implement.lock")), "task_block resets tree, keeps lock");

t = await call("foundry_task_next");
assert(t.done === true && t.skipped.length === 1 && t.skipped[0].id === "P0-03", "P0-03 auto-skipped (dep blocked) → done");
assert(t.counts.open === 0 && t.counts.blocked === 1 && t.counts.skipped === 1, "counts after loop");

// 5. guard hook behaviour
const guard = path.join(HERE, "..", "scripts", "implement-guard.sh");
const runGuard = () => execSync(`bash ${guard}`, { cwd: REPO, encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: REPO } }).trim();
assert(runGuard() === "", "guard allows stop when no open tasks");
fs.writeFileSync(path.join(REPO, "docs/PROGRESS.md"), fs.readFileSync(path.join(REPO, "docs/PROGRESS.md"), "utf8").replace("- [-] P0-03", "- [ ] P0-03"));
const g = JSON.parse(runGuard());
assert(g.decision === "block" && /P0-03/.test(g.reason), "guard blocks stop with open task, names it");
fs.writeFileSync(path.join(REPO, "docs/PROGRESS.md"), fs.readFileSync(path.join(REPO, "docs/PROGRESS.md"), "utf8").replace("- [ ] P0-03", "- [-] P0-03"));
sh("git checkout -q -- docs/PROGRESS.md");

// 6. finish
bad = await call("foundry_run_finish");
assert(bad.error && /HANDOFF/.test(bad.error), "run_finish requires HANDOFF.md");
fs.writeFileSync(path.join(REPO, "docs/HANDOFF.md"), "# handoff\n");
r = await call("foundry_run_finish");
assert(!r.error && /^READY FOR REVIEW/.test(r.readyLine) && !fs.existsSync(path.join(REPO, ".foundry/implement.lock")), "run_finish: " + r.readyLine);
n = await call("foundry_next");
assert(n.stage === "review" && n.agent === "foundry:reviewer", "→ review");

// 7. review: changes requested
fs.writeFileSync(path.join(REPO, "docs/REVIEW.md"), "# Review\nRound: 0\n**Verdict**: CHANGES REQUESTED\n");
r = await call("foundry_review_submit", {
  verdict: "CHANGES REQUESTED",
  tasks: [{ title: "Fix hello", goal: "hello must say hello", files: ["hello.txt"], constraints: "none", tests: "test.sh", outOfScope: "none", verification: "cat hello.txt", dependsOn: [] }],
  unblock: [{ id: "P0-02", reason: "reviewer clarified" }],
});
assert(!r.error && r.fixTasks[0] === "R1-01" && r.unblocked[0] === "P0-02" && r.round === 1, "review_submit CR → R1-01 queued, P0-02 unblocked");
const plan = fs.readFileSync(path.join(REPO, "docs/PLAN.md"), "utf8");
assert(/## Review fixes \(round 1\)\n\n### R1-01: Fix hello/.test(plan), "PLAN.md has review section in task format");
const prog = fs.readFileSync(path.join(REPO, "docs/PROGRESS.md"), "utf8");
assert(/- \[ \] P0-02 Impossible task\n- \[-\] P0-03[^\n]*\n- \[ \] R1-01 Fix hello\n\n## Log/.test(prog), "PROGRESS.md: R1-01 appended to Tasks before Log, P0-02 reset");
assert(sh("git log -1 --format=%s") === "review: round 1", "review committed");
n = await call("foundry_next");
assert(n.stage === "implement" && n.round === 1 && /round 1/.test(n.prompt), "→ implement round 1");

// 8. fix round
r = await call("foundry_run_start");
assert(!r.error && r.alreadyStarted === false && sh("git log -1 --format=%s") === "chore: start review-fix round 1", "fix round start");
t = await call("foundry_task_next"); assert(t.id === "P0-02", "unblocked P0-02 comes first");
fs.writeFileSync(path.join(REPO, "nope.txt"), "ok\n"); sh("git add -A && git commit -qm 'P0-02: Impossible task'");
await call("foundry_task_done", { id: "P0-02", log: "done after all" });
t = await call("foundry_task_next"); assert(t.id === "R1-01" && /hello must say hello/.test(t.text), "R1-01 text extracted from review section");
fs.writeFileSync(path.join(REPO, "hello.txt"), "hello\n"); sh("git add -A && git commit -qm 'R1-01: Fix hello'");
await call("foundry_task_done", { id: "R1-01", log: "fixed" });
t = await call("foundry_task_next"); assert(t.done === true, "fix round complete");
fs.writeFileSync(path.join(REPO, "docs/HANDOFF.md"), "# handoff\n## Round 1\n");
r = await call("foundry_run_finish"); assert(!r.error, "fix round finish");
n = await call("foundry_next"); assert(n.stage === "review" && n.round === 1, "→ review round 1");

// 9. approve → summarize → done
fs.writeFileSync(path.join(REPO, "docs/REVIEW.md"), "# Review\nRound: 1\n**Verdict**: APPROVED\n");
bad = await call("foundry_summary_commit"); assert(bad.error, "summary refused before approval");
r = await call("foundry_review_submit", { verdict: "APPROVED" }); assert(!r.error && sh("git log -1 --format=%s") === "review: approved", "approved");
n = await call("foundry_next"); assert(n.stage === "summarize", "→ summarize");
fs.writeFileSync(path.join(REPO, "docs/SUMMARY.md"), "# summary\n");
r = await call("foundry_summary_commit"); assert(!r.error, "summary committed");
n = await call("foundry_next"); assert(n.stage === "done", "→ done: " + n.reason);
assert(sh("git status --porcelain") === "", "tree clean at end");
console.log("\nALL PASSED\n" + sh("git log --oneline"));
srv.stdin.end();
