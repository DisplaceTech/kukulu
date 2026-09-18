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
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

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
};

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

function loadConfig() {
  if (!exists(P.config)) return null;
  try {
    return JSON.parse(read(P.config));
  } catch (e) {
    throw new ToolError(`docs/foundry.json is not valid JSON: ${e.message}`);
  }
}

function cfg() {
  const c = loadConfig() || {};
  return {
    verify: c.verify || [],
    extraVerify: c.extraVerify || {},
    build: c.build || [],
    baseBranch: c.baseBranch || "main",
    branchPrefix: c.branchPrefix || "build/",
    maxRounds: Number.isInteger(c.maxRounds) ? c.maxRounds : 3,
    commandTimeoutMs: c.commandTimeoutMs || 10 * 60 * 1000,
  };
}

const DEFAULT_STATE = { round: 0, implemented: false, reviewed: false, verdict: null, summarized: false, halted: null };

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
    git: g,
    state: st,
    round: st.round,
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
  return out;
}

const AGENT = { plan: "foundry:planner", implement: "foundry:implementer", review: "foundry:reviewer", summarize: "foundry:summarizer" };

function next() {
  const s = status();
  const c = cfg();
  const st = s.state;
  const stage = (name, reason, extra = {}) => ({
    stage: name,
    agent: AGENT[name] || null,
    round: st.round,
    reason,
    prompt: PROMPTS[name] ? PROMPTS[name](st.round, s) : null,
    ...extra,
  });

  if (!s.specPresent) return stage("halt", "docs/SPEC.md is missing; nothing to build from");
  if (st.halted) return stage("halt", st.halted);
  if (!s.planPresent || !s.progressPresent || !s.configPresent) {
    return stage("plan", "no plan on disk (docs/PLAN.md, docs/PROGRESS.md and docs/foundry.json are all required)");
  }
  const open = s.counts.open;
  if (open > 0 && st.round > c.maxRounds) {
    return stage("halt", `review round ${st.round} exceeds maxRounds=${c.maxRounds} with ${open} fix task(s) still open; human intervention required`);
  }
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
  implement: (round, s) =>
    `Run the Foundry implement stage. ${round === 0 ? "This is the initial build." : `This is review-fix round ${round}; the open tasks are R${round}-* fix tasks queued by the reviewer.`} Call foundry_run_start, then loop on foundry_task_next until it reports done, then write docs/HANDOFF.md and call foundry_run_finish. You are unattended; never ask a question and never stop with open tasks. ${s.counts ? `${s.counts.open} task(s) are open.` : ""}`,
  review: (round) =>
    `Run the Foundry review stage for round ${round}. Review the whole build branch against docs/SPEC.md and docs/PLAN.md as your review-build instructions specify, write docs/REVIEW.md, and call foundry_review_submit exactly once with your verdict. Do not fix code yourself.`,
  summarize: () =>
    "Run the Foundry summarize stage. The review is APPROVED. Write docs/SUMMARY.md as your summarize instructions specify and call foundry_summary_commit. Do not merge.",
};

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
  if (exists(P.lock) && pr.branch && !pr.branch.startsWith("(")) {
    return { alreadyStarted: true, branch, counts: counts(pr.tasks), round: st.round };
  }
  if (branch === c.baseBranch) {
    if (g.dirty) throw new ToolError(`working tree is dirty on ${c.baseBranch}; commit or stash before starting a run`);
    let name = `${c.branchPrefix}${today()}`;
    let n = 2;
    while (git(["rev-parse", "--verify", "--quiet", name], { allowFail: true }).ok) name = `${c.branchPrefix}${today()}-${n++}`;
    git(["checkout", "-q", "-b", name]);
    branch = name;
  } else if (!branch || !branch.startsWith(c.branchPrefix)) {
    throw new ToolError(`on branch '${branch}'; runs start from '${c.baseBranch}' or an existing '${c.branchPrefix}*' branch`);
  }

  // .gitignore the lock, arm it, stamp PROGRESS, commit.
  const ignoreLine = ".foundry/implement.lock";
  const gi = exists(P.gitignore) ? read(P.gitignore) : "";
  if (!gi.split("\n").includes(ignoreLine)) write(P.gitignore, gi.replace(/\s*$/, "") + (gi ? "\n" : "") + ignoreLine + "\n");
  fs.mkdirSync(P.stateDir, { recursive: true });
  write(P.lock, "0\n");
  if (!pr.branch || pr.branch.startsWith("(")) setHeader(pr, "Branch", branch);
  if (!pr.started || pr.started.startsWith("(")) setHeader(pr, "Started", new Date().toISOString());
  writeProgress(pr);
  st.implemented = false; st.reviewed = false; st.verdict = null;
  saveState(st);
  const sha = gitCommitIfChanged([P.gitignore, P.progress, P.state], st.round === 0 ? "chore: start implementation run" : `chore: start review-fix round ${st.round}`);
  return { alreadyStarted: false, branch, commit: sha, counts: counts(pr.tasks), round: st.round };
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
      resumed: pick.state === "~",
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
  const dirtyOutsideProgress = git(["status", "--porcelain"]).out.split("\n").filter((l) => l && !l.endsWith("docs/PROGRESS.md"));
  if (dirtyOutsideProgress.length) {
    throw new ToolError(`uncommitted changes remain after the task commit:\n${dirtyOutsideProgress.join("\n")}\nCommit them as part of ${id} or discard them.`);
  }
  const sha = git(["rev-parse", "--short", "HEAD"]).out;
  setTaskState(pr, id, "x");
  appendLog(pr, id, sha, log);
  writeProgress(pr);
  const psha = gitCommitIfChanged([P.progress], `progress: ${id} done`);
  return { id, taskCommit: sha, progressCommit: psha, counts: counts(pr.tasks) };
}

function taskBlock({ id, reason }) {
  if (!id || !reason) throw new ToolError("id and reason are required");
  let pr = parseProgress();
  const t = pr.tasks.find((x) => x.id === id);
  if (!t) throw new ToolError(`task ${id} not in docs/PROGRESS.md`);
  // Discard whatever the attempt left behind; the lock is gitignored so clean leaves it alone.
  git(["reset", "-q", "--hard", "HEAD"]);
  git(["clean", "-qfd"]);
  pr = parseProgress();
  setTaskState(pr, id, "!");
  appendLog(pr, id, "blocked", `BLOCKED: ${reason}`);
  writeProgress(pr);
  const psha = gitCommitIfChanged([P.progress], `progress: ${id} blocked`);
  return { id, progressCommit: psha, counts: counts(pr.tasks) };
}

function runShell(cmd, timeoutMs) {
  const r = spawnSync(cmd, { cwd: ROOT, shell: true, encoding: "utf8", timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
  const tail = (s, n = 60) => (s || "").split("\n").slice(-n).join("\n").trim();
  return {
    command: cmd,
    ok: r.status === 0 && !r.error,
    exitCode: r.status,
    timedOut: r.error?.code === "ETIMEDOUT",
    stdoutTail: tail(r.stdout),
    stderrTail: tail(r.stderr),
  };
}

function verify({ files = [] } = {}) {
  const c = loadConfig();
  if (!c) throw new ToolError("docs/foundry.json is missing; the plan stage must write it");
  const cc = cfg();
  if (!cc.verify.length) throw new ToolError("docs/foundry.json has no 'verify' commands");
  const cmds = [...cc.verify];
  const touched = Array.isArray(files) ? files : String(files).split(/[\s,]+/).filter(Boolean);
  for (const [prefix, extra] of Object.entries(cc.extraVerify)) {
    if (touched.some((f) => f.startsWith(prefix))) for (const x of extra) if (!cmds.includes(x)) cmds.push(x);
  }
  const results = cmds.map((cmd) => runShell(cmd, cc.commandTimeoutMs));
  return { ok: results.every((r) => r.ok), results };
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
  const dirty = git(["status", "--porcelain"]).out;
  if (dirty) throw new ToolError(`working tree is not clean:\n${dirty}\nCommit or discard before finishing`);

  let push = "skipped: no origin remote";
  let pr_url = null;
  if (g.hasOrigin) {
    const p = git(["push", "-u", "origin", g.branch], { allowFail: true });
    push = p.ok ? "pushed" : `failed: ${p.err}`;
    if (p.ok && spawnSync("gh", ["--version"], { encoding: "utf8" }).status === 0) {
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
  st.implemented = true; st.reviewed = false; st.verdict = null;
  saveState(st);
  const stateCommit = gitCommitIfChanged([P.state], `chore: round ${st.round} implemented`);
  const head = git(["rev-parse", "--short", "HEAD"]).out;
  return {
    branch: g.branch, base: g.base, head, handoffCommit, stateCommit, push, pr: pr_url, counts: cnt, round: st.round,
    readyLine: `READY FOR REVIEW — branch ${g.branch}, head ${head}, ${cnt.done} done / ${cnt.blocked} blocked / ${cnt.skipped} skipped of ${cnt.total}`,
  };
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

function reviewSubmit({ verdict, tasks = [], unblock = [] }) {
  verdict = String(verdict || "").toUpperCase().trim();
  if (!["APPROVED", "CHANGES REQUESTED"].includes(verdict)) throw new ToolError("verdict must be APPROVED or CHANGES REQUESTED");
  if (!exists(P.review)) throw new ToolError("docs/REVIEW.md does not exist; write it before submitting");
  const st = loadState();
  if (!st.implemented) throw new ToolError("no implementation handoff recorded for this round; nothing to review");
  const c = cfg();

  if (verdict === "APPROVED") {
    if (tasks.length || unblock.length) throw new ToolError("an APPROVED verdict cannot carry fix tasks or unblocks");
    st.reviewed = true; st.verdict = "APPROVED";
    saveState(st);
    const sha = gitCommitIfChanged([P.review, P.state], "review: approved");
    return { verdict, round: st.round, commit: sha };
  }

  if (!tasks.length && !unblock.length) throw new ToolError("CHANGES REQUESTED requires at least one fix task or unblock");
  const N = st.round + 1;
  const pr = parseProgress();
  for (const t of tasks) {
    for (const k of ["title", "goal", "files", "tests"]) if (!t[k] || (Array.isArray(t[k]) && !t[k].length)) throw new ToolError(`fix task '${t.title || "?"}' is missing '${k}'`);
  }
  const ids = tasks.map((_, i) => `R${N}-${String(i + 1).padStart(2, "0")}`);
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
  st.round = N; st.implemented = false; st.reviewed = true; st.verdict = "CHANGES REQUESTED";
  if (N > c.maxRounds) st.halted = `review round ${N} exceeds maxRounds=${c.maxRounds}; a human must decide whether to continue (edit .foundry/state.json to clear 'halted' and raise maxRounds in docs/foundry.json)`;
  saveState(st);
  const sha = gitCommitIfChanged([P.review, P.plan, P.progress, P.state], `review: round ${N}`);
  return { verdict, round: N, fixTasks: ids, unblocked, commit: sha, halted: st.halted, counts: counts(pr.tasks) };
}

function summaryCommit() {
  if (!exists(P.summary)) throw new ToolError("docs/SUMMARY.md does not exist");
  const st = loadState();
  if (st.verdict !== "APPROVED") throw new ToolError("summary can only be committed after an APPROVED review");
  st.summarized = true;
  saveState(st);
  const sha = gitCommitIfChanged([P.summary, P.state], "chore: build summary");
  const g = gitFacts();
  return { commit: sha, branch: g.branch, base: g.base, head: g.head, rounds: st.round };
}

// ---------------------------------------------------------------- MCP plumbing

const S = (props, required = []) => ({ type: "object", properties: props, required, additionalProperties: false });
const TOOLS = [
  { name: "foundry_status", description: "Everything the pipeline knows from disk: which docs exist, task counts by state, branch/base/head, lock, round, review verdict. Read-only.", inputSchema: S({}), fn: status },
  { name: "foundry_next", description: "Deterministic stage selection: returns { stage, agent, round, reason, prompt }. stage is plan | implement | review | summarize | done | halt. Read-only.", inputSchema: S({}), fn: next },
  { name: "foundry_run_start", description: "Begin (or resume) an implementation run: create/reuse the build branch, arm the implement guard lock, stamp Branch/Started in PROGRESS.md, commit. Idempotent.", inputSchema: S({}), fn: runStart },
  { name: "foundry_task_next", description: "Select the next task (first [~], else first [ ]), auto-skip tasks whose dependencies are blocked, mark it [~], and return its PLAN.md text plus dependency log entries. Returns { done: true } when none remain.", inputSchema: S({}), fn: taskNext },
  { name: "foundry_task_done", description: "Mark a task [x] and append its log entry stamped with HEAD's sha. Requires HEAD's commit subject to start with '<id>:' and a clean tree. Commits PROGRESS.md.", inputSchema: S({ id: { type: "string" }, log: { type: "string", description: "Log entry body, under 15 lines" } }, ["id", "log"]), fn: taskDone },
  { name: "foundry_task_block", description: "Give up on a task: hard-reset uncommitted changes, mark it [!], log BLOCKED: <reason>, commit PROGRESS.md.", inputSchema: S({ id: { type: "string" }, reason: { type: "string", description: "what you tried / what fails / what you think the fix is" } }, ["id", "reason"]), fn: taskBlock },
  { name: "foundry_verify", description: "Run the verify commands from docs/foundry.json, plus extraVerify commands for any path prefix the given files fall under. Returns per-command exit status and output tails.", inputSchema: S({ files: { type: "array", items: { type: "string" }, description: "Files touched by the task (optional)" } }), fn: verify },
  { name: "foundry_run_finish", description: "End an implementation run: requires zero open tasks and docs/HANDOFF.md; commits it, pushes and opens a draft PR when possible, disarms the lock, records the round as implemented.", inputSchema: S({}), fn: runFinish },
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
        serverInfo: { name: "foundry", version: "0.1.0" },
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
