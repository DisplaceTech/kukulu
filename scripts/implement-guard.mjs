#!/usr/bin/env node
// Foundry implement guard — Stop / SubagentStop hook.
//
// While .foundry/implement.lock exists, an implementation run is in
// progress. If docs/PROGRESS.md still has open tasks ([ ] or [~]), the run
// is not finished and a stop should be pushed back into the loop — but only
// when the party actually stopping is the implementer.
//
// Through 0.2.0 this hook fired unconditionally on every Stop and
// SubagentStop in the project, which also blocked a controller session that
// was merely *waiting* on a background implementer subagent: its own Stop
// events were indistinguishable from the implementer's. Every blocked stop
// also spent a re-block from the shared counter, eating into the cap the
// implementer itself relies on (F-07).
//
// So this hook reads its JSON stdin input and decides, in order:
//
//   1. No lock, or no open tasks: allow. Nothing to guard.
//   2. `hook_event_name` is `SubagentStop`: block only when `agent_type`
//      names the implementer (`foundry-implementer` or
//      `foundry:implementer`). Any other named agent is allowed outright.
//      A missing `agent_type` falls back to rule 3's transcript check.
//   3. `hook_event_name` is `Stop`: block only when *this session's own
//      transcript* holds a `tool_use` of `foundry_run_start` — i.e. the
//      implement stage is running directly in the main session
//      (`/foundry:implement` by hand, or `claude -p`), not a flight this
//      session is merely waiting on in the background. The check parses
//      the transcript and looks for the call itself; the bare text
//      "foundry_run_start" proves nothing, because a go-flight controller's
//      transcript always contains it (the implement prompt it relays
//      says "Call foundry_run_start") and was blocked on every turn end
//      (0.3.1 flight feedback F-01).
//   4. Any other event, unreadable or empty input, or an unreadable
//      transcript: allow. A guard that cannot identify the stopping party
//      must never guess block.
//
// Parallel streams (0.4.0) refine the block decision for the implementer:
//
//   5. `paused` in the lock: a serial implementer whose next open task belongs
//      to a parallel wave was told, by foundry_task_next, to stop and let the
//      flight controller hand the wave out. The MCP set the flag; the guard
//      just honours it and allows the stop.
//   6. A SubagentStop for the implementer whose transcript's *last*
//      `foundry_run_start` call passed a `stream` is one stream's
//      implementer: block only while *that stream* has open tasks
//      (`{stream: <s>}` tags on the PROGRESS.md lines), never because another
//      stream's tasks are open — a finished stream must not be held hostage
//      by its siblings.
//   7. If the stream cannot be determined (no `foundry_run_start` call in the
//      transcript, or an unreadable one) and stream worktrees exist, a wave is
//      in flight: allow. The controller's next foundry_next re-hands out any
//      stream that stopped early, so this is an optimisation, not the only
//      safety net. With no worktrees, the rules above apply unchanged.
//
// A hard cap on re-blocks (default 60, see FOUNDRY_GUARD_CAP or
// docs/foundry.json's guardCap) still prevents a runaway. The counter
// resets to zero on every task state change, so the cap bounds re-blocks
// since the last time work actually moved, not over the whole run — a
// 76-task plan making normal progress cannot exhaust it. Exit 0 with no
// output = allow the stop.

import fs from "node:fs";
import path from "node:path";

const IMPLEMENTER_AGENT_TYPES = new Set(["foundry-implementer", "foundry:implementer"]);

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function parseInput(raw) {
  if (!raw || !raw.trim()) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

const RUN_START_TOOL = /^(?:mcp__.+__)?foundry_run_start$/;

/**
 * The `input` of every assistant `tool_use` of foundry_run_start in the
 * transcript at `transcriptPath`, in order. The transcript is JSONL; a line
 * that does not parse is skipped, and an unreadable file yields none.
 * `includeSidechain` says whether entries logged inline for a subagent
 * (`isSidechain: true`) count: they do for a SubagentStop, where the
 * subagent's calls are the point, and do not for a Stop, where they belong to
 * someone else.
 */
function runStartCalls(transcriptPath, { includeSidechain }) {
  if (!transcriptPath) return [];
  let raw;
  try {
    raw = fs.readFileSync(transcriptPath, "utf8");
  } catch {
    return [];
  }
  const calls = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!includeSidechain && entry?.isSidechain === true) continue;
    const content = entry?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const item of content) {
      if (item?.type === "tool_use" && typeof item.name === "string" && RUN_START_TOOL.test(item.name)) calls.push(item.input && typeof item.input === "object" ? item.input : {});
    }
  }
  return calls;
}

const transcriptCalledRunStart = (transcriptPath, opts) => runStartCalls(transcriptPath, opts).length > 0;

/** Whether this stop belongs to the implementer, per the decision rule above. */
function isImplementerStop(input) {
  if (!input) return false;
  const event = input.hook_event_name;
  if (event === "SubagentStop") {
    if (input.agent_type) return IMPLEMENTER_AGENT_TYPES.has(input.agent_type);
    return transcriptCalledRunStart(input.agent_transcript_path || input.transcript_path, { includeSidechain: true });
  }
  if (event === "Stop") return transcriptCalledRunStart(input.transcript_path, { includeSidechain: false });
  return false;
}

const projectRoot = (input) => process.env.CLAUDE_PROJECT_DIR || input?.cwd || process.cwd();

/**
 * Read the lock's re-block counter, tolerating both the legacy bare-number
 * form and the JSON object form foundry_run_start writes from 0.3.0. `json`
 * is the parsed object to preserve on rewrite, or null for the legacy form.
 */
function readLock(lockPath) {
  const raw = fs.readFileSync(lockPath, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return { json: parsed, count: Number.isInteger(parsed.count) ? parsed.count : 0 };
  }
  const digits = raw.replace(/[^0-9]/g, "");
  return { json: null, count: digits ? Number(digits) : 0 };
}

function writeLock(lockPath, lock, count) {
  const text = lock.json ? JSON.stringify({ ...lock.json, count }) : String(count);
  fs.writeFileSync(lockPath, `${text}\n`);
}

/**
 * Open-task count and the id to resume with, scanning only the `## Tasks`
 * section, plus the same per stream: a PROGRESS.md line may end in a
 * `{stream: <slug>}` tag.
 */
function openTasks(progressPath) {
  let inTasks = false;
  let open = 0;
  let inProgress = null;
  let todo = null;
  const byStream = {};
  for (const line of fs.readFileSync(progressPath, "utf8").split("\n")) {
    if (/^## Tasks/.test(line)) {
      inTasks = true;
      continue;
    }
    if (/^## /.test(line)) {
      inTasks = false;
      continue;
    }
    if (!inTasks) continue;
    const m = line.match(/^- \[([ ~])\] (\S+)(.*)$/);
    if (!m) continue;
    open++;
    if (m[1] === "~" && inProgress === null) inProgress = m[2];
    if (m[1] === " " && todo === null) todo = m[2];
    const tag = m[3].match(/\{stream:\s*([a-z][a-z0-9-]{0,23})\}\s*$/);
    if (tag) {
      const st = (byStream[tag[1]] = byStream[tag[1]] || { open: 0, inProgress: null, todo: null });
      st.open++;
      if (m[1] === "~" && st.inProgress === null) st.inProgress = m[2];
      if (m[1] === " " && st.todo === null) st.todo = m[2];
    }
  }
  return { open, next: inProgress || todo, stalled: inProgress, byStream };
}

/** Does any stream worktree exist under `.foundry/worktrees/`? A wave is in flight when one does. */
function streamWorktreesExist(root) {
  try {
    return fs.readdirSync(path.join(root, ".foundry", "worktrees"), { withFileTypes: true }).some((d) => d.isDirectory());
  } catch {
    return false;
  }
}

function main() {
  const input = parseInput(readStdin());
  const root = projectRoot(input);
  const lockPath = path.join(root, ".foundry", "implement.lock");
  const progressPath = path.join(root, "docs", "PROGRESS.md");

  if (!fs.existsSync(lockPath) || !fs.existsSync(progressPath)) return;

  const { open, next, stalled, byStream } = openTasks(progressPath);
  if (open === 0) return;

  if (!isImplementerStop(input)) return;

  const lock = readLock(lockPath);
  // Rule 5: parked at a wave boundary by foundry_task_next.
  if (lock.json?.paused) return;

  // Rules 6 and 7: a stream's implementer answers only for its own stream.
  let stream = null;
  if (input.hook_event_name === "SubagentStop") {
    const calls = runStartCalls(input.agent_transcript_path || input.transcript_path, { includeSidechain: true });
    if (calls.length) {
      const last = calls[calls.length - 1];
      stream = typeof last.stream === "string" && last.stream ? last.stream : null;
    } else if (streamWorktreesExist(root)) {
      return;
    }
  }
  let scope = { open, next, stalled, label: "" };
  if (stream) {
    const mine = byStream[stream];
    if (!mine || mine.open === 0) return;
    scope = { open: mine.open, next: mine.inProgress || mine.todo, stalled: mine.inProgress, label: ` stream '${stream}'` };
  }
  // The effective cap bounds re-blocks *since the last task state change*
  // (foundry_task_done / foundry_task_block / foundry_run_start all reset
  // the counter to zero), not the whole run — so a per-run cap set in
  // docs/foundry.json's guardCap, carried in the lock, wins over the
  // process-wide FOUNDRY_GUARD_CAP env var, which wins over the default.
  const cap = Number.isInteger(lock.json?.cap) ? lock.json.cap : Number(process.env.FOUNDRY_GUARD_CAP || 60);
  const count = lock.count + 1;
  writeLock(lockPath, lock, count);

  if (count > cap) {
    // Give up rather than loop forever; leave the lock so the orchestrator
    // sees it. Name the stalled task, if there is one in progress, so a
    // human knows exactly where to look.
    const stuckOn = scope.stalled ? ` stuck on ${scope.stalled}` : "";
    const recover = "block it by hand with foundry_task_block, or resume the flight and it will pick up where it stalled";
    process.stdout.write(
      `${JSON.stringify({ systemMessage: `foundry: implement guard cap (${cap}) reached with ${scope.open} open tasks${scope.label}${stuckOn}; run halted — ${recover}` })}\n`,
    );
    return;
  }

  const reason = stream
    ? `foundry: stream '${stream}' is not finished — ${scope.open} task(s) of its still open in docs/PROGRESS.md (next: ${scope.next}). ` +
      `Do not stop. Call foundry_task_next with stream: "${stream}" and continue; call foundry_stream_finish only when it reports done.`
    : `foundry: implementation run is not finished — ${scope.open} task(s) still open in docs/PROGRESS.md (next: ${scope.next}). ` +
      "Do not stop. Call foundry_task_next and continue; call foundry_run_finish only when foundry_status reports zero open tasks.";
  process.stdout.write(`${JSON.stringify({ decision: "block", reason })}\n`);
}

main();
